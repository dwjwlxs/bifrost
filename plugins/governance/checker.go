// Package governance provides the budget evaluation and decision engine
package governance

import (
	"context"
	"fmt"
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


