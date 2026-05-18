package store

import (
	"context"
	"crypto/sha256"
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/redis/go-redis/v9"
	"github.com/spf13/cast"
)

// Redis key prefixes
const (
	redisKeyBudgetPrefix = "billing:budget:"
	redisKeyVKPrefix     = "billing:vk:"
	redisKeyEntityPrefix = "billing:entity:"
	redisKeyAllBudgets   = "billing:budgets"
)

// Lua script for atomic check-and-deduct.
// KEYS[1] = budget hash key
// ARGV[1] = cost to deduct (float as string)
// Returns: [allowed (0/1), current_usage_after, max_limit, error_msg]
//   - allowed=1: deduction succeeded
//   - allowed=0 with empty error: budget not found
//   - allowed=0 with non-empty error: operation failed
var deductScript = redis.NewScript(`
local key = KEYS[1]
local cost = tonumber(ARGV[1])

local current_usage = redis.call("HGET", key, "current_usage")
if current_usage == false then
	return {0, 0, 0, "budget not found"}
end
current_usage = tonumber(current_usage)

local max_limit = redis.call("HGET", key, "max_limit")
if max_limit == false then
	return {0, current_usage, 0, "max_limit field missing"}
end
max_limit = tonumber(max_limit)

local new_usage = redis.call("HINCRBYFLOAT", key, "current_usage", cost)
return {1, tonumber(new_usage), max_limit, ""}
`)

// RedisConfig holds Redis connection configuration.
type RedisConfig struct {
	Addr     string
	Password string
	DB       int
}

// RedisBudgetStore implements BudgetStore using Redis.
type RedisBudgetStore struct {
	client redis.Cmdable
	logger schemas.Logger
}

// NewRedisBudgetStore creates a new Redis-backed BudgetStore.
func NewRedisBudgetStore(ctx context.Context, logger schemas.Logger, redisCli redis.Cmdable) (*RedisBudgetStore, error) {
	if err := redisCli.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping failed: %w", err)
	}
	return &RedisBudgetStore{client: redisCli, logger: logger}, nil
}

// budgetKey returns the Redis key for a budget hash.
func budgetKey(id string) string {
	return redisKeyBudgetPrefix + id
}

// vkKey returns the Redis key for a VK hierarchy hash.
func vkKey(vkToken string) string {
	h := sha256.Sum256([]byte(vkToken))
	return redisKeyVKPrefix + fmt.Sprintf("%x", h)
}

// entityKey returns the Redis key for an entity's budget ID set.
func entityKey(entityType, entityID string) string {
	return redisKeyEntityPrefix + entityType + ":" + entityID
}

// Check checks if the budget has enough capacity without deducting.
func (s *RedisBudgetStore) Check(ctx context.Context, budgetID string, cost float64) (bool, float64, error) {
	key := budgetKey(budgetID)
	result, err := s.client.HMGet(ctx, key, "current_usage", "max_limit").Result()
	if err != nil {
		return false, 0, fmt.Errorf("check: get current_usage and max_limit for %s: %w", budgetID, err)
	}
	current := cast.ToFloat64(result[0])
	limit := cast.ToFloat64(result[1])
	return current+cost <= limit, current, nil
}

// Deduct atomically checks and deducts budget usage via Lua script.
// Returns DeductResult with Allowed=true if deduction succeeded,
// Allowed=false if over limit (not an error), and error only on Redis failures.
func (s *RedisBudgetStore) Deduct(ctx context.Context, budgetID string, cost float64) (*DeductResult, error) {
	key := budgetKey(budgetID)

	res, err := deductScript.Run(ctx, s.client, []string{key}, cost).Slice()
	if err != nil {
		return nil, fmt.Errorf("deduct lua script: %w", err)
	}

	allowed := res[0].(int64) == 1
	currentUsage, _ := res[1].(float64)
	maxLimit, _ := res[2].(float64)
	errMsg, _ := res[3].(string)

	if errMsg != "" {
		// errMsg is only set on internal errors (e.g. field missing), not on "not allowed"
		return &DeductResult{Allowed: false, CurrentUsage: currentUsage, MaxLimit: maxLimit},
			fmt.Errorf("deduct: %s", errMsg)
	}

	return &DeductResult{
		Allowed:      allowed,
		CurrentUsage: currentUsage,
		MaxLimit:     maxLimit,
	}, nil
}

// hashToBudgetData converts a Redis HGETALL map to BudgetData.
func hashToBudgetData(m map[string]string) (*BudgetData, error) {
	data := &BudgetData{}

	if v, ok := m["id"]; ok {
		data.ID = v
	}
	if v, ok := m["max_limit"]; ok {
		data.MaxLimit = cast.ToFloat64(v)
	}
	if v, ok := m["current_usage"]; ok {
		data.CurrentUsage = cast.ToFloat64(v)
	}
	if v, ok := m["reset_duration"]; ok {
		data.ResetDuration = v
	}
	if v, ok := m["last_reset"]; ok {
		t, err := time.Parse(time.RFC3339Nano, v)
		if err != nil {
			return nil, fmt.Errorf("parse last_reset: %w", err)
		}
		data.LastReset = t
	}
	if v, ok := m["type"]; ok {
		data.Type = configstoreTables.BudgetType(v)
	}
	if v, ok := m["expires_at"]; ok && v != "" {
		t, err := time.Parse(time.RFC3339Nano, v)
		if err != nil {
			return nil, fmt.Errorf("parse expires_at: %w", err)
		}
		data.ExpiresAt = &t
	}
	if v, ok := m["off_peak_discount"]; ok {
		data.OffPeakDiscount = v
	}
	if v, ok := m["team_id"]; ok && v != "" {
		data.TeamID = &v
	}
	if v, ok := m["customer_id"]; ok && v != "" {
		data.CustomerID = &v
	}
	if v, ok := m["user_id"]; ok && v != "" {
		data.UserID = &v
	}
	if v, ok := m["user_scope_team_id"]; ok && v != "" {
		data.UserScopeTeamID = &v
	}
	if v, ok := m["user_scope_customer_id"]; ok && v != "" {
		data.UserScopeCustomerID = &v
	}
	if v, ok := m["calendar_aligned"]; ok {
		data.CalendarAligned = cast.ToBool(v)
	}
	if v, ok := m["virtual_key_id"]; ok && v != "" {
		data.VirtualKeyID = &v
	}
	if v, ok := m["provider_config_id"]; ok && v != "" {
		id := cast.ToUint(v)
		data.ProviderConfigID = &id
	}
	if v, ok := m["config_hash"]; ok {
		data.ConfigHash = v
	}
	if v, ok := m["created_at"]; ok {
		t, err := time.Parse(time.RFC3339Nano, v)
		if err != nil {
			return nil, fmt.Errorf("parse created_at: %w", err)
		}
		data.CreatedAt = t
	}
	if v, ok := m["updated_at"]; ok {
		t, err := time.Parse(time.RFC3339Nano, v)
		if err != nil {
			return nil, fmt.Errorf("parse updated_at: %w", err)
		}
		data.UpdatedAt = t
	}

	return data, nil
}

// budgetDataToHash converts BudgetData to a flat map for Redis HSET.
//
// Unlike hashToBudgetData (which reads string values directly from Redis),
// this function builds the map explicitly so that:
//   - nil pointer fields are never stored (they are simply omitted from the map).
//     This avoids go-redis HSET storing nil interface{} as the literal string
//     "<nil>", which would otherwise happen if you put a nil interface{} value
//     into map[string]any and passed it to HSet.
//   - All fields are always named explicitly, making the stored schema self-evident.
func budgetDataToHash(data *BudgetData) map[string]any {
	fields := make(map[string]any, 16)

	fields["id"] = data.ID
	fields["max_limit"] = data.MaxLimit
	fields["current_usage"] = data.CurrentUsage
	fields["reset_duration"] = data.ResetDuration
	fields["last_reset"] = data.LastReset.Format(time.RFC3339Nano)
	fields["type"] = string(data.Type)
	fields["calendar_aligned"] = data.CalendarAligned
	fields["off_peak_discount"] = data.OffPeakDiscount
	fields["config_hash"] = data.ConfigHash
	fields["created_at"] = data.CreatedAt.Format(time.RFC3339Nano)
	fields["updated_at"] = data.UpdatedAt.Format(time.RFC3339Nano)

	if data.TeamID != nil {
		fields["team_id"] = *data.TeamID
	}
	if data.CustomerID != nil {
		fields["customer_id"] = *data.CustomerID
	}
	if data.UserID != nil {
		fields["user_id"] = *data.UserID
	}
	if data.VirtualKeyID != nil {
		fields["virtual_key_id"] = *data.VirtualKeyID
	}
	if data.ProviderConfigID != nil {
		fields["provider_config_id"] = fmt.Sprintf("%d", *data.ProviderConfigID)
	}
	if data.ExpiresAt != nil {
		fields["expires_at"] = data.ExpiresAt.Format(time.RFC3339Nano)
	}
	if data.UserScopeTeamID != nil {
		fields["user_scope_team_id"] = *data.UserScopeTeamID
	}
	if data.UserScopeCustomerID != nil {
		fields["user_scope_customer_id"] = *data.UserScopeCustomerID
	}

	return fields
}

// Get retrieves a single budget by ID.
func (s *RedisBudgetStore) Get(ctx context.Context, budgetID string) (*BudgetData, error) {
	key := budgetKey(budgetID)
	result, err := s.client.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("get budget %s: %w", budgetID, err)
	}
	if len(result) == 0 {
		return nil, nil
	}

	data, err := hashToBudgetData(result)
	if err != nil {
		return nil, fmt.Errorf("parse budget %s: %w", budgetID, err)
	}
	return data, nil
}

// MGet retrieves multiple budgets by IDs using a pipeline.
func (s *RedisBudgetStore) MGet(ctx context.Context, budgetIDs []string) (map[string]*BudgetData, error) {
	if len(budgetIDs) == 0 {
		return make(map[string]*BudgetData), nil
	}

	// Use pipeline for batch HGETALL
	pipe := s.client.Pipeline()
	cmds := make(map[string]*redis.MapStringStringCmd, len(budgetIDs))
	for _, id := range budgetIDs {
		cmds[id] = pipe.HGetAll(ctx, budgetKey(id))
	}

	_, err := pipe.Exec(ctx)
	if err != nil {
		return nil, fmt.Errorf("mget pipeline exec: %w", err)
	}

	result := make(map[string]*BudgetData, len(budgetIDs))
	for id, cmd := range cmds {
		m, err := cmd.Result()
		if err != nil {
			s.logger.Warn("mget: failed to get budget %s: %v", id, err)
			continue
		}
		if len(m) == 0 {
			continue
		}
		data, err := hashToBudgetData(m)
		if err != nil {
			s.logger.Warn("mget: failed to parse budget %s: %v", id, err)
			continue
		}
		result[id] = data
	}

	return result, nil
}

// Set stores budget data in Redis.
func (s *RedisBudgetStore) Set(ctx context.Context, budgetID string, data *configstoreTables.TableBudget) error {
	key := budgetKey(budgetID)
	budgetData := BudgetData(*data)
	fields := budgetDataToHash(&budgetData)

	// Use a transaction to set budget data and add to the all-budgets set
	pipe := s.client.Pipeline()
	pipe.HSet(ctx, key, fields)
	pipe.SAdd(ctx, redisKeyAllBudgets, budgetID)

	// Add to entity sets based on the budget's entity associations
	if data.TeamID != nil && *data.TeamID != "" {
		pipe.SAdd(ctx, entityKey("team", *data.TeamID), budgetID)
	}
	if data.CustomerID != nil && *data.CustomerID != "" {
		pipe.SAdd(ctx, entityKey("customer", *data.CustomerID), budgetID)
	}
	if data.UserID != nil && *data.UserID != "" {
		pipe.SAdd(ctx, entityKey("user", *data.UserID), budgetID)
	}

	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("set budget %s: %w", budgetID, err)
	}
	return nil
}

// Delete removes a budget from Redis.
func (s *RedisBudgetStore) Delete(ctx context.Context, budgetID string) error {
	key := budgetKey(budgetID)

	// First, get the budget data to know which entity sets to clean up
	data, err := s.Get(ctx, budgetID)
	if err != nil {
		return fmt.Errorf("delete: get budget %s for cleanup: %w", budgetID, err)
	}

	pipe := s.client.Pipeline()
	pipe.Del(ctx, key)
	pipe.SRem(ctx, redisKeyAllBudgets, budgetID)

	// Remove from entity sets
	if data != nil {
		if data.TeamID != nil && *data.TeamID != "" {
			pipe.SRem(ctx, entityKey("team", *data.TeamID), budgetID)
		}
		if data.CustomerID != nil && *data.CustomerID != "" {
			pipe.SRem(ctx, entityKey("customer", *data.CustomerID), budgetID)
		}
		if data.UserID != nil && *data.UserID != "" {
			pipe.SRem(ctx, entityKey("user", *data.UserID), budgetID)
		}
	}

	_, err = pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("delete budget %s: %w", budgetID, err)
	}
	return nil
}

// Reset resets a budget's current usage to zero.
func (s *RedisBudgetStore) Reset(ctx context.Context, budgetID string) error {
	key := budgetKey(budgetID)
	now := time.Now().Format(time.RFC3339Nano)

	pipe := s.client.Pipeline()
	pipe.HSet(ctx, key, "current_usage", "0")
	pipe.HSet(ctx, key, "last_reset", now)

	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("reset budget %s: %w", budgetID, err)
	}
	return nil
}

// SetVKHierarchy caches VK hierarchy data in Redis.
func (s *RedisBudgetStore) SetVKHierarchy(ctx context.Context, vkToken string, data *VKHierarchyData) error {
	key := vkKey(vkToken)

	fields := map[string]interface{}{
		"id": data.ID,
	}
	if data.TeamID != nil {
		fields["team_id"] = *data.TeamID
	} else {
		fields["team_id"] = ""
	}
	if data.CustomerID != nil {
		fields["customer_id"] = *data.CustomerID
	} else {
		fields["customer_id"] = ""
	}
	if data.UserID != nil {
		fields["user_id"] = *data.UserID
	} else {
		fields["user_id"] = ""
	}

	if err := s.client.HSet(ctx, key, fields).Err(); err != nil {
		return fmt.Errorf("set vk hierarchy: %w", err)
	}
	return nil
}

// GetVKHierarchy retrieves cached VK hierarchy data from Redis.
func (s *RedisBudgetStore) GetVKHierarchy(ctx context.Context, vkToken string) (*VKHierarchyData, error) {
	key := vkKey(vkToken)
	result, err := s.client.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("get vk hierarchy: %w", err)
	}
	if len(result) == 0 {
		return nil, nil
	}

	data := &VKHierarchyData{}
	if v, ok := result["id"]; ok {
		data.ID = v
	}
	if v, ok := result["team_id"]; ok && v != "" {
		data.TeamID = &v
	}
	if v, ok := result["customer_id"]; ok && v != "" {
		data.CustomerID = &v
	}
	if v, ok := result["user_id"]; ok && v != "" {
		data.UserID = &v
	}

	return data, nil
}

// SetBudgetIDsByEntity sets the list of budget IDs associated with an entity.
func (s *RedisBudgetStore) SetBudgetIDsByEntity(ctx context.Context, entityType string, entityID string, budgetIDs []string) error {
	key := entityKey(entityType, entityID)

	// Replace the entire set: delete old, add new
	pipe := s.client.Pipeline()
	pipe.Del(ctx, key)
	if len(budgetIDs) > 0 {
		members := make([]interface{}, len(budgetIDs))
		for i, id := range budgetIDs {
			members[i] = id
		}
		pipe.SAdd(ctx, key, members...)
	}

	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("set budget ids by entity %s/%s: %w", entityType, entityID, err)
	}
	return nil
}

// GetBudgetIDsByEntity retrieves the list of budget IDs associated with an entity.
func (s *RedisBudgetStore) GetBudgetIDsByEntity(ctx context.Context, entityType string, entityID string) ([]string, error) {
	key := entityKey(entityType, entityID)
	result, err := s.client.SMembers(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("get budget ids by entity %s/%s: %w", entityType, entityID, err)
	}
	return result, nil
}

// CollectBillingBudgets collects all billing budgets for a VK hierarchy.
// Budgets are filtered by entity ownership:
//   - user budgets: only budgets whose (team_id or customer_id) matches the VK's context
//   - team budgets: budgets owned by the VK's team
//   - customer budgets: budgets owned by the VK's customer
func (s *RedisBudgetStore) CollectBillingBudgets(ctx context.Context, vk *VKHierarchyData) (EntityWiseBudgets, error) {
	if vk == nil {
		return make(EntityWiseBudgets), nil
	}

	pipe := s.client.Pipeline()
	var teamCmd, customerCmd, userCmd *redis.StringSliceCmd

	if vk.TeamID != nil && *vk.TeamID != "" {
		teamCmd = pipe.SMembers(ctx, entityKey("team", *vk.TeamID))
	}
	if vk.CustomerID != nil && *vk.CustomerID != "" {
		customerCmd = pipe.SMembers(ctx, entityKey("customer", *vk.CustomerID))
	}
	if vk.UserID != nil && *vk.UserID != "" {
		userCmd = pipe.SMembers(ctx, entityKey("user", *vk.UserID))
	}

	if teamCmd == nil && customerCmd == nil && userCmd == nil {
		return make(EntityWiseBudgets), nil
	}

	_, err := pipe.Exec(ctx)
	if err != nil {
		return nil, fmt.Errorf("collect billing budgets: pipeline exec: %w", err)
	}

	// Merge budget IDs from all reachable entity sets
	budgetIDSet := make(map[string]struct{})
	if teamCmd != nil {
		if ids, err := teamCmd.Result(); err == nil {
			for _, id := range ids {
				budgetIDSet[id] = struct{}{}
			}
		}
	}
	if customerCmd != nil {
		if ids, err := customerCmd.Result(); err == nil {
			for _, id := range ids {
				budgetIDSet[id] = struct{}{}
			}
		}
	}
	if userCmd != nil {
		if ids, err := userCmd.Result(); err == nil {
			for _, id := range ids {
				budgetIDSet[id] = struct{}{}
			}
		}
	}

	if len(budgetIDSet) == 0 {
		return make(EntityWiseBudgets), nil
	}

	budgetIDs := slices.Collect(maps.Keys(budgetIDSet))
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

// GetAllBudgetIDs returns all billing budget IDs.
func (s *RedisBudgetStore) GetAllBudgetIDs(ctx context.Context) ([]string, error) {
	result, err := s.client.SMembers(ctx, redisKeyAllBudgets).Result()
	if err != nil {
		return nil, fmt.Errorf("get all budget ids: %w", err)
	}
	return result, nil
}

// Ping checks if the Redis connection is alive.
func (s *RedisBudgetStore) Ping(ctx context.Context) error {
	if err := s.client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis ping: %w", err)
	}
	return nil
}

// Close closes the Redis connection.
func (s *RedisBudgetStore) Close() error {
	if c, ok := s.client.(*redis.Client); ok {
		return c.Close()
	}
	return nil
}

// Ensure RedisBudgetStore implements BudgetStore at compile time.
var _ BudgetStore = (*RedisBudgetStore)(nil)
