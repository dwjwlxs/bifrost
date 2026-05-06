// Package governance provides the budget evaluation and decision engine
package governance

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
)

// BudgetChecker defines how a budget type is evaluated and deducted
type BudgetChecker interface {
	// Check decides whether the request is allowed
	Check(ctx context.Context, budgets EntityWiseBudgets, baselines map[string]float64) (Decision, error)

	// Deduct updates usage after a successful request
	// Returns which budget IDs were actually charged and by how much
	Deduct(ctx context.Context, budgets EntityWiseBudgets, cost float64) (map[string]float64, error)
}

// GovernanceBudgetChecker implements AND logic for governance budgets (existing behavior)
type GovernanceBudgetChecker struct {
	logger schemas.Logger
	store  *LocalGovernanceStore
}

// NewGovernanceBudgetChecker creates a new GovernanceBudgetChecker
func NewGovernanceBudgetChecker(store *LocalGovernanceStore, logger schemas.Logger) *GovernanceBudgetChecker {
	return &GovernanceBudgetChecker{
		logger: logger,
		store:  store,
	}
}

// Check implements AND logic: ALL budgets must have sufficient capacity
func (c *GovernanceBudgetChecker) Check(ctx context.Context, entityWiseBudgets EntityWiseBudgets, baselines map[string]float64) (Decision, error) {
	// Check each budget in hierarchy order using in-memory data
	for entity, budgets := range entityWiseBudgets {
		for _, budget := range budgets {
			// Check if budget needs reset (in-memory check)
			if budget.ResetDuration != "" {
				if duration, err := configstoreTables.ParseDuration(budget.ResetDuration); err == nil {
					// Only check reset if duration > 0 (ResetDuration="0" means no reset, for balance type)
					if duration > 0 && time.Since(budget.LastReset) >= duration {
						// Budget expired but hasn't been reset yet - treat as reset
						// Note: actual reset will happen in post-hook via AtomicBudgetUpdate
						c.logger.Debug("GovernanceBudgetChecker Check: Budget %s (%s) expired, skipping check", budget.ID, entity)
						continue // Skip budget check for expired budgets
					}
				}
			}

			baseline, exists := baselines[budget.ID]
			if !exists {
				baseline = 0
			}

			c.logger.Debug("GovernanceBudgetChecker Check: Checking %s budget %s: local=%.4f, remote=%.4f, total=%.4f limit=%.4f",
				entity, budget.ID, budget.CurrentUsage, baseline, budget.CurrentUsage+baseline, budget.MaxLimit)

			// Check if current usage (local + remote baseline) exceeds budget limit
			if budget.CurrentUsage+baseline >= budget.MaxLimit {
				c.logger.Debug("GovernanceBudgetChecker Check: Budget %s EXCEEDED", budget.ID)
				return DecisionBudgetExceeded, fmt.Errorf("%s budget exceeded: %.4f >= %.4f dollars",
					entity, budget.CurrentUsage+baseline, budget.MaxLimit)
			}
		}
	}
	return DecisionAllow, nil
}

// Deduct updates ALL budgets (AND logic) - each gets the full cost
func (c *GovernanceBudgetChecker) Deduct(ctx context.Context, entityWiseBudgets EntityWiseBudgets, cost float64) (map[string]float64, error) {
	charged := make(map[string]float64)

	// For governance budgets, we deduct from all budgets in hierarchy
	for _, budgets := range entityWiseBudgets {
		for _, budget := range budgets {
			if err := c.store.BumpBudgetUsage(ctx, budget.ID, cost); err != nil {
				return charged, err
			}
			charged[budget.ID] = cost
		}
	}

	return charged, nil
}

// BillingBudgetChecker implements OR logic for billing budgets (hybrid deduction)
type BillingBudgetChecker struct {
	logger schemas.Logger
	store  *LocalGovernanceStore
}

// NewBillingBudgetChecker creates a new BillingBudgetChecker
func NewBillingBudgetChecker(store *LocalGovernanceStore, logger schemas.Logger) *BillingBudgetChecker {
	return &BillingBudgetChecker{
		logger: logger,
		store:  store,
	}
}

// OffPeakDiscountRule represents the discount rule structure
type OffPeakDiscountRule struct {
	StartHour int     `json:"start_hour"` // 0-23
	EndHour   int     `json:"end_hour"`   // 0-23
	Discount  float64 `json:"discount"`   // 0.0-1.0 (e.g., 0.5 means 50% off)
}

// evaluateOffPeak calculates the discount multiplier for the current time
func evaluateOffPeak(discountJSON string, t time.Time) float64 {
	if discountJSON == "" {
		return 1.0 // No discount
	}

	var rule OffPeakDiscountRule
	if err := json.Unmarshal([]byte(discountJSON), &rule); err != nil {
		return 1.0
	}

	hour := t.Hour()

	// Check if current hour is within off-peak window
	if rule.StartHour <= rule.EndHour {
		// Same-day window (e.g., 22-6 wouldn't use this form)
		if hour >= rule.StartHour && hour < rule.EndHour {
			return rule.Discount
		}
	} else {
		// Wrap-around window (e.g., 22-6)
		if hour >= rule.StartHour || hour < rule.EndHour {
			return rule.Discount
		}
	}

	return 1.0 // No discount applicable
}

// budgetWithInfo wraps a budget with calculated info for sorting
type budgetWithInfo struct {
	budget       *configstoreTables.TableBudget
	baseline     float64
	isPackage    bool    // ResetDuration != "0"
	durationSecs float64 // duration in seconds for comparison
	remaining    float64 // MaxLimit - CurrentUsage - baseline
}

// flattenAndFilterBudgets takes EntityWiseBudgets and returns a flat list of valid budgets with info
func (c *BillingBudgetChecker) flattenAndFilterBudgets(budgets EntityWiseBudgets, baselines map[string]float64) ([]budgetWithInfo, error) {
	var flat []budgetWithInfo

	// Flatten budgets from all entities
	for _, entityBudgets := range budgets {
		for _, budget := range entityBudgets {
			// Skip expired budgets (ExpiresAt in past)
			if budget.ExpiresAt != nil && time.Now().After(*budget.ExpiresAt) {
				c.logger.Debug("BillingBudgetChecker: Skipping expired budget %s", budget.ID)
				continue
			}

			baseline, exists := baselines[budget.ID]
			if !exists {
				baseline = 0
			}

			isPackage := budget.ResetDuration != "0"

			// Calculate duration in seconds for sorting
			var durationSecs float64
			if isPackage && budget.ResetDuration != "" {
				if duration, err := configstoreTables.ParseDuration(budget.ResetDuration); err == nil {
					durationSecs = duration.Seconds()
				}
			}

			remaining := budget.MaxLimit - budget.CurrentUsage - baseline
			if remaining < 0 {
				remaining = 0
			}

			flat = append(flat, budgetWithInfo{
				budget:       budget,
				baseline:     baseline,
				isPackage:    isPackage,
				durationSecs: durationSecs,
				remaining:    remaining,
			})
		}
	}

	// Sort according to priority rules
	sort.Slice(flat, func(i, j int) bool {
		a := flat[i]
		b := flat[j]

		// Rule 1: Package (isPackage=true) comes before balance type
		if a.isPackage != b.isPackage {
			return a.isPackage
		}

		// Both are packages or both are balance
		if a.isPackage {
			// Rule 2: Shorter duration first
			if a.durationSecs != b.durationSecs {
				return a.durationSecs < b.durationSecs
			}
		}

		// Rule 3: Less remaining first
		if a.remaining != b.remaining {
			return a.remaining < b.remaining
		}

		// Rule 4: ExpiresAt sooner first (for one-time packages)
		if a.budget.ExpiresAt != nil && b.budget.ExpiresAt != nil {
			return a.budget.ExpiresAt.Before(*b.budget.ExpiresAt)
		}
		if a.budget.ExpiresAt != nil {
			return true
		}
		if b.budget.ExpiresAt != nil {
			return false
		}

		// Final tiebreaker: ID for determinism
		return a.budget.ID < b.budget.ID
	})

	return flat, nil
}

// Check implements OR logic: ANY budget with sufficient capacity allows the request
func (c *BillingBudgetChecker) Check(ctx context.Context, budgets EntityWiseBudgets, baselines map[string]float64) (Decision, error) {
	// Flatten, filter, and sort budgets
	flatBudgets, err := c.flattenAndFilterBudgets(budgets, baselines)
	if err != nil {
		return DecisionAllow, err
	}

	// Calculate total available
	var totalAvailable float64
	for _, bwi := range flatBudgets {
		totalAvailable += bwi.remaining
		c.logger.Debug("BillingBudgetChecker Check: Budget %s available: %.4f", bwi.budget.ID, bwi.remaining)
	}

	c.logger.Debug("BillingBudgetChecker Check: Total available across all billing budgets: %.4f", totalAvailable)

	// OR logic: if ANY budget (or combination) has capacity, allow
	// We just need total > 0 (we don't estimate request cost in Check per design)
	if totalAvailable > 0 {
		return DecisionAllow, nil
	}

	return DecisionBudgetExceeded, fmt.Errorf("billing budget exceeded: total available %.4f", totalAvailable)
}

// Deduct implements hybrid deduction logic with off-peak discounts
func (c *BillingBudgetChecker) Deduct(ctx context.Context, budgets EntityWiseBudgets, cost float64) (map[string]float64, error) {
	charged := make(map[string]float64)
	if cost <= 0 {
		return charged, nil
	}

	// Flatten, filter, and sort budgets
	flatBudgets, err := c.flattenAndFilterBudgets(budgets, nil)
	if err != nil {
		return charged, err
	}

	remainingToCharge := cost
	now := time.Now()

	for _, bwi := range flatBudgets {
		if remainingToCharge <= 0 {
			break
		}

		budget := bwi.budget

		// Calculate discount for this budget
		discount := evaluateOffPeak(budget.OffPeakDiscount, now)
		if discount == 0 {
			discount = 1.0
		}

		// Calculate how much we can take from this budget
		availableInBudget := budget.MaxLimit - budget.CurrentUsage
		if availableInBudget <= 0 {
			continue
		}

		// Adjust amount for discount
		adjustedRemaining := remainingToCharge * discount

		var deductThisRound float64
		var newRemaining float64

		if availableInBudget >= adjustedRemaining {
			// This budget can fully cover the adjusted remaining
			deductThisRound = adjustedRemaining
			newRemaining = 0
		} else {
			// Take all available from this budget
			deductThisRound = availableInBudget
			// Calculate remaining for next budget - convert back to original currency
			newRemaining = (adjustedRemaining - availableInBudget) / discount
		}

		// Do the actual deduction (rounded to reasonable precision)
		deductThisRound = roundToCents(deductThisRound)
		if deductThisRound > 0 {
			if err := c.store.BumpBudgetUsage(ctx, budget.ID, deductThisRound); err != nil {
				return charged, err
			}
			charged[budget.ID] = deductThisRound
			c.logger.Debug("BillingBudgetChecker Deduct: Charged %.4f from budget %s (discount %.2f)", deductThisRound, budget.ID, discount)
		}

		remainingToCharge = roundToCents(newRemaining)
	}

	// Check for zero overdraft
	if remainingToCharge > 0.0001 {
		return charged, fmt.Errorf("insufficient billing budget capacity: still need %.4f", remainingToCharge)
	}

	return charged, nil
}

// roundToCents rounds to 2 decimal places (dollars)
func roundToCents(amount float64) float64 {
	return float64(int64(amount*100+0.5)) / 100
}
