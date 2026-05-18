package store

import (
	"context"

	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
)

// BudgetData 表示一个 billing budget 的完整数据
// 存储在 Redis Hash 或内存 map 中
type BudgetData configstoreTables.TableBudget

// EntityType returns the entity type ("team", "customer", "user") for a budget
func (b BudgetData) EntityType() string {
	if b.UserID != nil && *b.UserID != "" {
		return "user"
	}
	if b.TeamID != nil && *b.TeamID != "" {
		return "team"
	}
	if b.CustomerID != nil && *b.CustomerID != "" {
		return "customer"
	}
	return "unknown"
}

// budgetEntityTypeForVK determines the entity type of a budget within a VK's hierarchy.
// Returns the key for EntityWiseBudgets, or "" if the budget does not belong to this VK.
func budgetEntityTypeForVK(budget *BudgetData, vk *VKHierarchyData) string {
	hasUserBudget := budget.UserID != nil && *budget.UserID != ""

	// user budgets: must match the VK's team_id or customer_id
	if hasUserBudget {
		if vk.TeamID != nil && *vk.TeamID != "" {
			if budget.TeamID != nil && *budget.TeamID == *vk.TeamID {
				return "user"
			}
		}
		if vk.CustomerID != nil && *vk.CustomerID != "" {
			if budget.CustomerID != nil && *budget.CustomerID == *vk.CustomerID {
				return "user"
			}
		}
		// personal VK: no team_id and no customer_id → only budgets with no team/customer
		if vk.TeamID == nil && vk.CustomerID == nil {
			if budget.TeamID == nil && budget.CustomerID == nil {
				return "user"
			}
		}
		return ""
	}

	// team budgets: user_id=nil, team_id matches
	if budget.TeamID != nil && *budget.TeamID != "" {
		if vk.TeamID != nil && *budget.TeamID == *vk.TeamID {
			return "team"
		}
		return ""
	}

	// customer budgets: user_id=nil, team_id=nil, customer_id matches
	if budget.CustomerID != nil && *budget.CustomerID != "" {
		if vk.CustomerID != nil && *budget.CustomerID == *vk.CustomerID {
			return "customer"
		}
		return ""
	}

	return ""
}

type EntityWiseBudgets map[string][]*BudgetData

// VKHierarchyData 表示 VK 的层级关系（从 DB 加载到 Redis 缓存）
type VKHierarchyData struct {
	ID         string  `json:"id"`
	TeamID     *string `json:"team_id,omitempty"`
	CustomerID *string `json:"customer_id,omitempty"`
	UserID     *string `json:"user_id,omitempty"`
}

// DeductResult 是 Deduct 的返回值
type DeductResult struct {
	Allowed      bool    `json:"allowed"`       // 是否允许（check+deduct合一）
	CurrentUsage float64 `json:"current_usage"` // 扣费后的 usage
	MaxLimit     float64 `json:"max_limit"`     // budget 限额
}

// BudgetStore 是 billing 插件的存储抽象
// Redis 实现保证 check+deduct 的原子性（Lua 脚本）
// 内存实现用于测试和单实例 fallback
type BudgetStore interface {
	// Check 检查是否存在有余额的budget不扣费）
	Check(ctx context.Context, budgetID string, cost float64) (bool, float64, error)

	// Deduct 不检查直接扣除
	Deduct(ctx context.Context, budgetID string, cost float64) (*DeductResult, error)

	// Get 获取 budget 数据
	Get(ctx context.Context, budgetID string) (*BudgetData, error)

	// MGet 批量获取 budget 数据
	MGet(ctx context.Context, budgetIDs []string) (map[string]*BudgetData, error)

	// Set 更新 budget 配置（admin 改 max_limit 等）
	Set(ctx context.Context, budgetID string, data *configstoreTables.TableBudget) error

	// Delete 删除 budget
	Delete(ctx context.Context, budgetID string) error

	// Reset 重置 budget usage（周期重置）
	Reset(ctx context.Context, budgetID string) error

	// SetVKHierarchy 设置 VK 层级缓存
	SetVKHierarchy(ctx context.Context, vkToken string, data *VKHierarchyData) error

	// GetVKHierarchy 获取 VK 层级缓存
	GetVKHierarchy(ctx context.Context, vkToken string) (*VKHierarchyData, error)

	// SetBudgetIDsByEntity 设置实体（VK/Team/Customer/User）关联的 billing budget ID 列表
	SetBudgetIDsByEntity(ctx context.Context, entityType string, entityID string, budgetIDs []string) error

	// GetBudgetIDsByEntity 获取实体关联的 billing budget ID 列表
	GetBudgetIDsByEntity(ctx context.Context, entityType string, entityID string) ([]string, error)

	// CollectBillingBudgets 收集 VK 层级的所有 billing budget 数据
	// 通过 VK → Team/Customer/User → Budget 层级关系收集
	CollectBillingBudgets(ctx context.Context, vk *VKHierarchyData) (EntityWiseBudgets, error)

	// GetAllBudgetIDs 获取所有 billing budget ID（用于后台 worker 遍历）
	GetAllBudgetIDs(ctx context.Context) ([]string, error)

	// Ping 检查存储是否可用
	Ping(ctx context.Context) error

	// Close 关闭存储连接
	Close() error
}
