package billing

import (
	"context"
	"sync"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/billing/store"
	"gorm.io/gorm"
)

// UsageTracker 管理 billing budget 的后台 worker
// 负责：定期 reset 过期 budget、dump 到 DB、刷新 VK/Team/Customer 缓存
type UsageTracker struct {
	budgetStore  store.BudgetStore
	configStore  configstore.ConfigStore
	logger       schemas.Logger
	dumpInterval time.Duration

	resetTicker *time.Ticker
	done        chan struct{}
	wg          sync.WaitGroup
}

// NewUsageTracker 创建 UsageTracker
func NewUsageTracker(budgetStore store.BudgetStore, configStore configstore.ConfigStore, logger schemas.Logger, dumpInterval time.Duration) *UsageTracker {
	return &UsageTracker{
		budgetStore:  budgetStore,
		configStore:  configStore,
		logger:       logger,
		dumpInterval: dumpInterval,
		done:         make(chan struct{}),
	}
}

// Start 启动后台 worker
func (t *UsageTracker) Start(ctx context.Context) {
	t.resetTicker = time.NewTicker(t.dumpInterval)
	t.wg.Add(1)
	go t.worker(ctx)
}

// Stop 停止后台 worker
func (t *UsageTracker) Stop() {
	close(t.done)
	t.wg.Wait()
	if t.resetTicker != nil {
		t.resetTicker.Stop()
	}
}

// worker 后台循环
func (t *UsageTracker) worker(ctx context.Context) {
	defer t.wg.Done()

	for {
		select {
		case <-t.resetTicker.C:
			t.tick(ctx)
		case <-t.done:
			return
		case <-ctx.Done():
			return
		}
	}
}

// tick 每个周期执行
func (t *UsageTracker) tick(ctx context.Context) {
	// 1. Reset 过期 budget
	t.resetExpiredBudgets(ctx)

	// 2. Dump 到 DB
	if err := t.DumpBudgets(ctx); err != nil {
		t.logger.Error("billing tracker: failed to dump budgets: %v", err)
	}

	// 3. 刷新 VK 层级缓存
	t.refreshVKHierarchy(ctx)
}

// resetExpiredBudgets 检查并重置过期 budget
func (t *UsageTracker) resetExpiredBudgets(ctx context.Context) {
	budgetIDs, err := t.budgetStore.GetAllBudgetIDs(ctx)
	if err != nil {
		t.logger.Error("billing tracker: failed to get all budget IDs: %v", err)
		return
	}

	now := time.Now()
	for _, id := range budgetIDs {
		data, err := t.budgetStore.Get(ctx, id)
		if err != nil || data == nil {
			continue
		}

		// 只处理 billing 类型
		if data.Type != "billing" {
			continue
		}

		// 检查是否需要重置
		if !t.shouldReset(data, now) {
			continue
		}

		if err := t.budgetStore.Reset(ctx, id); err != nil {
			t.logger.Error("billing tracker: failed to reset budget %s: %v", id, err)
		} else {
			t.logger.Debug("billing tracker: reset budget %s", id)
		}
	}
}

// shouldReset 判断 budget 是否需要重置
func (t *UsageTracker) shouldReset(data *store.BudgetData, now time.Time) bool {
	if data.Type == configstoreTables.BudgetTypeBilling {
		// billing 类型，不重置
		return false
	}

	if data.CalendarAligned {
		// 日历对齐重置逻辑
		periodStart := getCalendarPeriodStart(data.ResetDuration, now)
		return periodStart.After(data.LastReset)
	}

	// 非日历对齐
	if data.ResetDuration == "" || data.ResetDuration == "0" {
		// balance 类型，不重置
		return false
	}

	duration, err := parseDuration(data.ResetDuration)
	if err != nil || duration <= 0 {
		return false
	}

	return now.Sub(data.LastReset) >= duration
}

// getCalendarPeriodStart 获取日历周期起始时间
func getCalendarPeriodStart(resetDuration string, now time.Time) time.Time {
	duration, err := parseDuration(resetDuration)
	if err != nil || duration <= 0 {
		return now
	}

	// 简化实现：按天/周/月/年计算
	days := int(duration.Hours() / 24)
	switch {
	case days >= 365:
		return time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
	case days >= 30:
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	case days >= 7:
		// 周一
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		return time.Date(now.Year(), now.Month(), now.Day()-weekday+1, 0, 0, 0, 0, now.Location())
	default:
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	}
}

// DumpBudgets 将 Redis 中的 budget 数据增量写入 DB
func (t *UsageTracker) DumpBudgets(ctx context.Context) error {
	if t.configStore == nil {
		return nil
	}

	budgetIDs, err := t.budgetStore.GetAllBudgetIDs(ctx)
	if err != nil {
		return err
	}

	if len(budgetIDs) == 0 {
		return nil
	}

	// 批量获取
	budgets, err := t.budgetStore.MGet(ctx, budgetIDs)
	if err != nil {
		return err
	}

	// 增量写入 DB
	// TODO: 如果budgets非常多，这里会成为风险
	return t.configStore.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		for id, data := range budgets {
			if data == nil {
				continue
			}
			if data.CurrentUsage <= 0 {
				continue
			}
			// 增量更新 current_usage
			query := tx.WithContext(ctx).Model(&configstoreTables.TableBudget{}).
				Session(&gorm.Session{SkipHooks: true}).
				Where("type = 'billing' AND id = ?", id)
			if err := query.Updates(map[string]any{
				"current_usage": data.CurrentUsage,
				"updated_at":    time.Now(),
			}).Error; err != nil {
				t.logger.Error("billing tracker: failed to dump budget %s: %v", id, err)
				return err
			}
		}
		return nil
	})
}

// refreshVKHierarchy 定期刷新 VK 层级缓存
func (t *UsageTracker) refreshVKHierarchy(ctx context.Context) {
	if t.configStore == nil {
		return
	}

	// TODO: 大规模数据场景，分页获取
	vks, err := t.configStore.GetVirtualKeys(ctx)
	if err != nil {
		t.logger.Error("billing tracker: failed to refresh VK hierarchy: %v", err)
		return
	}

	for _, vk := range vks {
		data := &store.VKHierarchyData{
			ID:         vk.ID,
			TeamID:     vk.TeamID,
			CustomerID: vk.CustomerID,
			UserID:     vk.UserID,
		}
		if err := t.budgetStore.SetVKHierarchy(ctx, vk.ID, data); err != nil {
			t.logger.Error("billing tracker: failed to refresh VK %s: %v", vk.ID, err)
		}
	}
}
