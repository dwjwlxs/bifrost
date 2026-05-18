package store

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
)

// MemoryBudgetStore implements BudgetStore using in-memory data structures.
// It is intended for testing and as a fallback when Redis is unavailable.
// Atomicity is achieved via per-budget fine-grained mutexes (CAS-style).
type MemoryBudgetStore struct {
	logger   schemas.Logger
	budgets  sync.Map // string -> *BudgetData
	vkCache  sync.Map // string -> *VKHierarchyData (key: vk token)
	entities sync.Map // string -> map[string]bool (key: "entityType:entityID", value: set of budgetIDs)

	allIDs    sync.RWMutex
	budgetIDs map[string]bool // all budget IDs

	// per-budget mutex for atomic check+deduct
	budgetMu sync.Map // string -> *sync.Mutex
}

// NewMemoryBudgetStore creates a new in-memory BudgetStore.
func NewMemoryBudgetStore(logger schemas.Logger) *MemoryBudgetStore {
	return &MemoryBudgetStore{
		logger:    logger,
		budgetIDs: make(map[string]bool),
	}
}

// getBudgetMutex returns (or creates) a per-budget mutex for fine-grained locking.
func (s *MemoryBudgetStore) getBudgetMutex(budgetID string) *sync.Mutex {
	val, _ := s.budgetMu.LoadOrStore(budgetID, &sync.Mutex{})
	return val.(*sync.Mutex)
}

// entityKey builds the key used in the entities map: "entityType:entityID".
func entityKeyMem(entityType, entityID string) string {
	return entityType + ":" + entityID
}

// Ensure MemoryBudgetStore implements BudgetStore at compile time.
var _ BudgetStore = (*MemoryBudgetStore)(nil)

// Check checks whether the budget has enough remaining capacity (no deduction).
func (s *MemoryBudgetStore) Check(ctx context.Context, budgetID string, cost float64) (bool, float64, error) {
	val, ok := s.budgets.Load(budgetID)
	if !ok {
		return false, 0, fmt.Errorf("budget %s not found", budgetID)
	}
	data := val.(*BudgetData)
	remaining := data.MaxLimit - data.CurrentUsage
	return remaining >= cost, data.CurrentUsage, nil
}

// Deduct atomically checks and deducts cost from the budget.
// Uses a per-budget mutex to guarantee check+deduct atomicity.
func (s *MemoryBudgetStore) Deduct(ctx context.Context, budgetID string, cost float64) (*DeductResult, error) {
	mu := s.getBudgetMutex(budgetID)
	mu.Lock()
	defer mu.Unlock()

	val, ok := s.budgets.Load(budgetID)
	if !ok {
		return &DeductResult{Allowed: false}, fmt.Errorf("budget %s not found", budgetID)
	}
	data := val.(*BudgetData)

	remaining := data.MaxLimit - data.CurrentUsage
	if remaining < cost {
		return &DeductResult{
			Allowed:      false,
			CurrentUsage: data.CurrentUsage,
			MaxLimit:     data.MaxLimit,
		}, nil
	}

	data.CurrentUsage += cost
	return &DeductResult{
		Allowed:      true,
		CurrentUsage: data.CurrentUsage,
		MaxLimit:     data.MaxLimit,
	}, nil
}

// Get retrieves a single budget by ID.
func (s *MemoryBudgetStore) Get(ctx context.Context, budgetID string) (*BudgetData, error) {
	val, ok := s.budgets.Load(budgetID)
	if !ok {
		return nil, nil
	}
	return val.(*BudgetData), nil
}

// MGet retrieves multiple budgets by ID.
func (s *MemoryBudgetStore) MGet(ctx context.Context, budgetIDs []string) (map[string]*BudgetData, error) {
	result := make(map[string]*BudgetData, len(budgetIDs))
	for _, id := range budgetIDs {
		val, ok := s.budgets.Load(id)
		if ok {
			result[id] = val.(*BudgetData)
		}
	}
	return result, nil
}

// Set stores or updates a budget. It also registers the budget ID and entity associations.
func (s *MemoryBudgetStore) Set(ctx context.Context, budgetID string, budget *configstoreTables.TableBudget) error {
	if budget == nil {
		return fmt.Errorf("budget data cannot be nil")
	}

	budgetData := BudgetData(*budget)
	data := &budgetData

	s.budgets.Store(budgetID, data)

	// Register budget ID in the global set
	s.allIDs.Lock()
	s.budgetIDs[budgetID] = true
	s.allIDs.Unlock()

	// Register entity associations from the budget data fields
	entityEntries := []struct {
		entityType string
		entityID   *string
	}{
		{"team", data.TeamID},
		{"customer", data.CustomerID},
		{"user", data.UserID},
		{"user_scope_team", data.UserScopeTeamID},
		{"user_scope_customer", data.UserScopeCustomerID},
	}

	for _, entry := range entityEntries {
		if entry.entityID != nil && *entry.entityID != "" {
			key := entityKeyMem(entry.entityType, *entry.entityID)
			for {
				existing, loaded := s.entities.LoadOrStore(key, map[string]bool{budgetID: true})
				if !loaded {
					break
				}
				// Loaded existing set — copy, add, CAS
				oldSet := existing.(map[string]bool)
				if oldSet[budgetID] {
					break // already present
				}
				newSet := make(map[string]bool, len(oldSet)+1)
				for k := range oldSet {
					newSet[k] = true
				}
				newSet[budgetID] = true
				if s.entities.CompareAndSwap(key, oldSet, newSet) {
					break
				}
				// CAS failed, retry
			}
		}
	}

	return nil
}

// Delete removes a budget and cleans up entity associations and the global ID set.
func (s *MemoryBudgetStore) Delete(ctx context.Context, budgetID string) error {
	// Remove from budgets map
	s.budgets.Delete(budgetID)

	// Remove from global ID set
	s.allIDs.Lock()
	delete(s.budgetIDs, budgetID)
	s.allIDs.Unlock()

	// Remove from all entity sets
	s.entities.Range(func(key, value interface{}) bool {
		set := value.(map[string]bool)
		if set[budgetID] {
			newSet := make(map[string]bool, len(set))
			for k := range set {
				if k != budgetID {
					newSet[k] = true
				}
			}
			if len(newSet) == 0 {
				s.entities.Delete(key)
			} else {
				s.entities.Store(key, newSet)
			}
		}
		return true
	})

	// Clean up per-budget mutex
	s.budgetMu.Delete(budgetID)

	return nil
}

// Reset resets the budget's current usage to zero and updates LastReset.
func (s *MemoryBudgetStore) Reset(ctx context.Context, budgetID string) error {
	mu := s.getBudgetMutex(budgetID)
	mu.Lock()
	defer mu.Unlock()

	val, ok := s.budgets.Load(budgetID)
	if !ok {
		return fmt.Errorf("budget %s not found", budgetID)
	}
	data := val.(*BudgetData)
	data.CurrentUsage = 0
	data.LastReset = time.Now()
	return nil
}

// SetVKHierarchy caches VK hierarchy data for a given VK token.
func (s *MemoryBudgetStore) SetVKHierarchy(ctx context.Context, vkToken string, data *VKHierarchyData) error {
	s.vkCache.Store(vkToken, data)
	return nil
}

// GetVKHierarchy retrieves cached VK hierarchy data for a given VK token.
func (s *MemoryBudgetStore) GetVKHierarchy(ctx context.Context, vkToken string) (*VKHierarchyData, error) {
	val, ok := s.vkCache.Load(vkToken)
	if !ok {
		return nil, nil
	}
	return val.(*VKHierarchyData), nil
}

// SetBudgetIDsByEntity associates a set of budget IDs with an entity (e.g., team, customer, user).
func (s *MemoryBudgetStore) SetBudgetIDsByEntity(ctx context.Context, entityType string, entityID string, budgetIDs []string) error {
	key := entityKeyMem(entityType, entityID)
	newSet := make(map[string]bool, len(budgetIDs))
	for _, id := range budgetIDs {
		newSet[id] = true
	}
	s.entities.Store(key, newSet)
	return nil
}

// GetBudgetIDsByEntity retrieves the budget IDs associated with an entity.
func (s *MemoryBudgetStore) GetBudgetIDsByEntity(ctx context.Context, entityType string, entityID string) ([]string, error) {
	key := entityKeyMem(entityType, entityID)
	val, ok := s.entities.Load(key)
	if !ok {
		return nil, nil
	}
	set := val.(map[string]bool)
	ids := make([]string, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	return ids, nil
}

// CollectBillingBudgets collects all billing budgets for a VK hierarchy.
// Budgets are filtered by entity ownership:
//   - user budgets: only budgets whose (team_id or customer_id) matches the VK's context
//   - team budgets: budgets owned by the VK's team
//   - customer budgets: budgets owned by the VK's customer
func (s *MemoryBudgetStore) CollectBillingBudgets(ctx context.Context, vk *VKHierarchyData) (EntityWiseBudgets, error) {
	if vk == nil {
		return make(EntityWiseBudgets), nil
	}

	// Collect budget IDs from all entity levels
	budgetIDSet := make(map[string]struct{})

	entityLookups := []struct {
		entityType string
		entityID   *string
	}{
		{"team", vk.TeamID},
		{"customer", vk.CustomerID},
		{"user", vk.UserID},
	}

	for _, lookup := range entityLookups {
		if lookup.entityID != nil && *lookup.entityID != "" {
			key := entityKeyMem(lookup.entityType, *lookup.entityID)
			val, ok := s.entities.Load(key)
			if !ok {
				continue
			}
			set := val.(map[string]bool)
			for id := range set {
				budgetIDSet[id] = struct{}{}
			}
		}
	}

	if len(budgetIDSet) == 0 {
		return make(EntityWiseBudgets), nil
	}

	budgetIDs := make([]string, 0, len(budgetIDSet))
	for id := range budgetIDSet {
		budgetIDs = append(budgetIDs, id)
	}

	budgetMap, err := s.MGet(ctx, budgetIDs)
	if err != nil {
		return nil, fmt.Errorf("collect billing budgets: mget: %w", err)
	}

	// Filter and group budgets by entity type, respecting VK hierarchy.
	// user budgets must match the VK's team_id or customer_id to be included.
	result := make(EntityWiseBudgets, 3)
	for _, budget := range budgetMap {
		if budget.Type != configstoreTables.BudgetTypeBilling {
			continue
		}
		entityType := budgetEntityTypeForVK(budget, vk)
		if entityType == "" {
			continue // budget not relevant for this VK context
		}
		result[entityType] = append(result[entityType], budget)
	}
	return result, nil
}

// GetAllBudgetIDs returns all known billing budget IDs.
func (s *MemoryBudgetStore) GetAllBudgetIDs(ctx context.Context) ([]string, error) {
	s.allIDs.RLock()
	defer s.allIDs.RUnlock()
	ids := make([]string, 0, len(s.budgetIDs))
	for id := range s.budgetIDs {
		ids = append(ids, id)
	}
	return ids, nil
}

// Ping checks if the store is available (always nil for in-memory store).
func (s *MemoryBudgetStore) Ping(ctx context.Context) error {
	return nil
}

// Close releases resources (no-op for in-memory store).
func (s *MemoryBudgetStore) Close() error {
	return nil
}
