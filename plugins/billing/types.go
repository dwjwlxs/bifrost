package billing

import (
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/plugins/billing/store"
)

// Decision 表示 billing 评估结果
type Decision string

const (
	DecisionAllow          Decision = "allow"
	DecisionBudgetExceeded Decision = "budget_exceeded"
)

// BillingCheckRequest 包含 billing check 的上下文
type BillingCheckRequest struct {
	VirtualKey string                `json:"virtual_key"`
	Provider   schemas.ModelProvider `json:"provider"`
	Model      string                `json:"model"`
	UserID     string                `json:"user_id,omitempty"`
}

// BillingCheckResult 包含 billing check 的结果
type BillingCheckResult struct {
	Decision     Decision            `json:"decision"`
	Reason       string              `json:"reason,omitempty"`
	BudgetInfos  []*store.BudgetData `json:"budget_infos,omitempty"`
	TotalBalance float64             `json:"total_balance,omitempty"`
}

// BudgetWithInfo 扁平化的 budget + 计算信息（用于 checker 排序）
type BudgetWithInfo struct {
	Budget       *store.BudgetData
	IsPackage    bool    // 是否为套餐类型（有 ExpiresAt）
	DurationSecs float64 // 套餐时长（秒），用于排序
	Remaining    float64 // 剩余额度
}

// OffPeakDiscount 表示折扣规则（从 EntityPackage/Package JSON 解析）
type OffPeakDiscount struct {
	Percentage float64 `json:"percentage"`
	StartHour  int     `json:"start_hour,omitempty"`
	EndHour    int     `json:"end_hour,omitempty"`
	Days       []int   `json:"days,omitempty"`
	Timezone   string  `json:"timezone,omitempty"`
}
