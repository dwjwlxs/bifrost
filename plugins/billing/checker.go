package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/dwjwlxs/bifrost/plugins/billing/store"
	"github.com/maximhq/bifrost/core/schemas"
)

// BudgetChecker defines how a budget type is evaluated and deducted
type BudgetChecker interface {
	// Check decides whether the request is allowed
	Check(ctx context.Context, entityWiseBudgets store.EntityWiseBudgets, baselines map[string]float64) (Decision, error)

	// Deduct updates usage after a successful request
	// Returns which budget IDs were actually charged and by how much
	Deduct(ctx context.Context, entityWiseBudgets store.EntityWiseBudgets, cost float64) (map[string]float64, error)
}

// BillingBudgetChecker 实现 OR 逻辑的 billing budget 检查和扣费
type BillingBudgetChecker struct {
	logger      schemas.Logger
	budgetStore store.BudgetStore
}

// NewBillingBudgetChecker 创建新的 BillingBudgetChecker
func NewBillingBudgetChecker(budgetStore store.BudgetStore, logger schemas.Logger) *BillingBudgetChecker {
	return &BillingBudgetChecker{
		logger:      logger,
		budgetStore: budgetStore,
	}
}

// OffPeakDiscountRule 表示折扣规则
type OffPeakDiscountRule struct {
	StartHour int     `json:"start_hour"` // 0-23
	EndHour   int     `json:"end_hour"`   // 0-23
	Discount  float64 `json:"discount"`   // 0.0-1.0 (e.g., 0.5 means 50% off)
}

// evaluateOffPeak 计算当前时间的折扣乘数
func evaluateOffPeak(discountJSON string, t time.Time) float64 {
	if discountJSON == "" {
		return 1.0
	}

	var rule OffPeakDiscountRule
	if err := json.Unmarshal([]byte(discountJSON), &rule); err != nil {
		return 1.0
	}

	hour := t.Hour()

	if rule.StartHour <= rule.EndHour {
		if hour >= rule.StartHour && hour < rule.EndHour {
			return rule.Discount
		}
	} else {
		// 跨日窗口 (e.g., 22-6)
		if hour >= rule.StartHour || hour < rule.EndHour {
			return rule.Discount
		}
	}

	return 1.0
}

// flattenAndFilterBudgets 扁平化、过滤、排序 billing budgets
func (c *BillingBudgetChecker) flattenAndFilterBudgets(budgets []*store.BudgetData) []BudgetWithInfo {
	var flat []BudgetWithInfo

	for _, budget := range budgets {
		if budget == nil {
			continue
		}

		// 跳过过期的 budget
		if budget.ExpiresAt != nil && time.Now().After(*budget.ExpiresAt) {
			c.logger.Debug("BillingBudgetChecker: Skipping expired budget %s", budget.ID)
			continue
		}

		isPackage := budget.ExpiresAt != nil

		// 计算排序用的时长
		var durationSecs float64
		if isPackage && budget.ResetDuration != "" && budget.ResetDuration != "0" {
			if duration, err := parseDuration(budget.ResetDuration); err == nil {
				durationSecs = duration.Seconds()
			}
		}

		remaining := budget.MaxLimit - budget.CurrentUsage
		if remaining < 0 {
			remaining = 0
		}

		flat = append(flat, BudgetWithInfo{
			Budget:       budget,
			IsPackage:    isPackage,
			DurationSecs: durationSecs,
			Remaining:    remaining,
		})
	}

	// 按优先级排序
	sort.Slice(flat, func(i, j int) bool {
		a := flat[i]
		b := flat[j]

		// Rule 1: 套餐优先于余额
		if a.IsPackage != b.IsPackage {
			return a.IsPackage
		}

		// Rule 2: 套餐中短时长优先
		if a.IsPackage {
			if a.DurationSecs != b.DurationSecs {
				return a.DurationSecs < b.DurationSecs
			}
		}

		// Rule 3: 剩余少的优先
		if a.Remaining != b.Remaining {
			return a.Remaining < b.Remaining
		}

		// Rule 4: 先到期的优先
		if a.Budget.ExpiresAt != nil && b.Budget.ExpiresAt != nil {
			return a.Budget.ExpiresAt.Before(*b.Budget.ExpiresAt)
		}
		if a.Budget.ExpiresAt != nil {
			return true
		}
		if b.Budget.ExpiresAt != nil {
			return false
		}

		// Final: ID 排序保证确定性
		return a.Budget.ID < b.Budget.ID
	})

	return flat
}

func (c *BillingBudgetChecker) orderedEntityTypes() []string {
	return []string{"user", "team", "customer"}
}

// Check 实现 OR 逻辑：任意 budget 有余额则允许
func (c *BillingBudgetChecker) Check(ctx context.Context, entityWiseBudgets store.EntityWiseBudgets, baselines map[string]float64) (Decision, error) {
	count := 0
	for _, b := range entityWiseBudgets {
		count += len(b)
	}
	sorted := make([]BudgetWithInfo, 0, count)
	for _, entityType := range c.orderedEntityTypes() {
		bs := entityWiseBudgets[entityType]
		sorted = append(sorted, c.flattenAndFilterBudgets(bs)...)
	}

	flatBudgets := sorted
	var totalAvailable float64
	for _, bwi := range flatBudgets {
		totalAvailable += bwi.Remaining
		c.logger.Debug("BillingBudgetChecker Check: Budget %s available: %.4f", bwi.Budget.ID, bwi.Remaining)
	}

	c.logger.Debug("BillingBudgetChecker Check: Total available across all billing budgets: %.4f", totalAvailable)
	if totalAvailable > 0 {
		return DecisionAllow, nil
	}

	return DecisionBudgetExceeded, nil
}

// Deduct 实现混合扣费逻辑（通过 BudgetStore 原子操作）
func (c *BillingBudgetChecker) Deduct(ctx context.Context, entityWiseBudgets store.EntityWiseBudgets, cost float64) (map[string]float64, error) {
	charged := make(map[string]float64)
	if cost <= 0 {
		return charged, nil
	}

	count := 0
	for _, b := range entityWiseBudgets {
		count += len(b)
	}
	sorted := make([]BudgetWithInfo, 0, count)
	for _, entityType := range c.orderedEntityTypes() {
		bs := entityWiseBudgets[entityType]
		sorted = append(sorted, c.flattenAndFilterBudgets(bs)...)
	}
	flatBudgets := sorted

	remainingToCharge := cost
	now := time.Now()

	for _, bwi := range flatBudgets {
		if remainingToCharge <= 0 {
			break
		}

		budget := bwi.Budget

		// 计算折扣
		discount := evaluateOffPeak(budget.OffPeakDiscount, now)
		if discount == 0 {
			discount = 1.0
		}

		// 用估算值算本次扣费量（实际扣费由 BudgetStore.Deduct 保证原子性）
		estimatedAvailable := budget.MaxLimit - budget.CurrentUsage
		if estimatedAvailable <= 0 {
			continue
		}

		adjustedRemaining := remainingToCharge * discount

		var deductThisRound float64
		var newRemaining float64

		if estimatedAvailable >= adjustedRemaining {
			deductThisRound = adjustedRemaining
			newRemaining = 0
		} else {
			deductThisRound = estimatedAvailable
			newRemaining = (adjustedRemaining - estimatedAvailable) / discount
		}

		deductThisRound = roundToCents(deductThisRound)
		if deductThisRound > 0 {
			// 通过 BudgetStore 原子扣费
			result, err := c.budgetStore.Deduct(ctx, budget.ID, deductThisRound)
			if err != nil {
				// Redis 操作失败只记录 log，不返回 error——已扣的部分已持久化，
				// 未扣的部分下次请求会继续尝试扣（因为 usage 不会回滚）
				c.logger.Error("BillingBudgetChecker Deduct: Failed to deduct from budget %s: %v", budget.ID, err)
				// 不 return，继续处理下一个 budget
			} else if result.Allowed {
				charged[budget.ID] = deductThisRound
				c.logger.Debug("BillingBudgetChecker Deduct: Charged %.4f from budget %s (discount %.2f)", deductThisRound, budget.ID, discount)
			} else {
				// budget 已满（Redis 中的实际值与估算不同），跳过
				c.logger.Debug("BillingBudgetChecker Deduct: Budget %s full (usage=%.4f, limit=%.4f), skipping", budget.ID, result.CurrentUsage, result.MaxLimit)
				// 不算入 charged，继续下一个
			}
		}

		remainingToCharge = roundToCents(newRemaining)
	}

	if remainingToCharge > 0.0001 {
		// OR 逻辑下，只要成功扣到一个 budget就算成功；
		// 剩余未扣部分下次请求继续扣，不算作错误
		c.logger.Warn("BillingBudgetChecker Deduct: partial charge only, %.4f remaining (charged %v)", remainingToCharge, charged)
	}

	return charged, nil
}

// roundToCents 四舍五入到分
func roundToCents(amount float64) float64 {
	return float64(int64(amount*100+0.5)) / 100
}

// parseDuration 解析时间字符串（从 configstoreTables 迁移）
// 支持格式: "30s", "5m", "1h", "1d", "1w", "1M", "1Y", "0"
func parseDuration(s string) (time.Duration, error) {
	if s == "" || s == "0" {
		return 0, nil
	}

	// 尝试标准 Go duration
	if d, err := time.ParseDuration(s); err == nil {
		return d, nil
	}

	// 自定义: d=day, w=week, M=month, Y=year
	if len(s) < 2 {
		return 0, fmt.Errorf("invalid duration: %s", s)
	}

	unit := s[len(s)-1]
	val := s[:len(s)-1]

	var multiplier time.Duration
	switch unit {
	case 'd':
		multiplier = 24 * time.Hour
	case 'w':
		multiplier = 7 * 24 * time.Hour
	case 'M':
		multiplier = 30 * 24 * time.Hour
	case 'Y':
		multiplier = 365 * 24 * time.Hour
	default:
		return 0, fmt.Errorf("invalid duration unit: %c", unit)
	}

	// 解析数值
	var n int
	for _, c := range val {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("invalid duration value: %s", val)
		}
		n = n*10 + int(c-'0')
	}

	return time.Duration(n) * multiplier, nil
}
