# Bifrost 计费系统 — 双轨制设计

> 版本: v3.0 | 状态: 设计中 | 最后更新: 2026-05

---

## 1. 核心洞察：治理 ≠ 计费

Bifrost 的 governance 模块提供的是**治理能力**（预算上限、速率限制），不是计费能力。两者的本质区别：

| 维度 | 治理 (Governance) | 计费 (Billing) |
|------|-------------------|----------------|
| 目的 | 限制用量，防止超额 | 扣费付费，商业化运营 |
| 语义 | 没有 Budget = 不限量 | 没有 Budget = 不让用 |
| 检查逻辑 | AND（任一超额即拒绝） | OR（混合扣费，余额补足） |
| 管理者 | 管理员设置限额 | 用户/组织充值 |
| 场景 | API 网关治理、企业成本管控 | SaaS 商业化、个人付费使用 |

**设计决策**：在 `TableBudget` 上新增 `BudgetType` 字段，按 type 分流到不同的检查逻辑，双轨运行。

---

## 2. BudgetType 双轨制

### 2.1 类型定义

```go
type BudgetType string

const (
    BudgetTypeGovernance BudgetType = "governance"  // 治理限额：AND 逻辑
    BudgetTypeBilling    BudgetType = "billing"     // 计费额度：OR 逻辑
)
```

- 默认值 `"governance"`，现有数据零迁移
- 计费系统创建的 Budget 设为 `"billing"`

### 2.2 收集链

收集逻辑复用现有 `collectBudgetsFromHierarchy`，收集后按 type 分流：

```
governance Budgets (AND 检查，不变):
  ProviderConfig → VK → User → Team → Customer

billing Budgets (找最近层级，OR 混合扣费):
  个人VK: → User
  组织VK: → Team → Customer

RateLimits (AND 检查，与 governance Budgets 同层级):
  ProviderConfig → VK → User → Team → Customer
```

RateLimit 收集链与 governance Budget 收集链保持一致，User 层级位于 VK 和 Team 之间。实现改动点：
- `TableUser` 新增 `RateLimitID` + `RateLimit` 关联（1:1，与 Team/Customer 同模式）
- `collectRateLimitsFromHierarchy` 在 VK 之后、Team 之前插入 User 层级收集
- `CheckUserRateLimit` 从 no-op 改为实际检查
- `UpdateVirtualKeyRateLimitUsageInMemory` 增加 User 层级用量更新

**collectBudgetsFromHierarchy 改动**：必须按 type 过滤，否则治理检查会把 billing Budget 纳入 AND，计费检查会把 governance Budget 纳入 OR，两边都错。

```go
// 改后
allBudgetsWithCategories := gs.collectBudgetsFromHierarchy(ctx, vk, provider)
governanceBudgets := filterByType(allBudgetsWithCategories, BudgetTypeGovernance)
billingBudgets := filterByType(allBudgetsWithCategories, BudgetTypeBilling)
```

### 2.3 BudgetChecker 接口

按 type 分流到不同的 checker 实现，放在 `plugins/governance/checker.go`：

```go
// BudgetChecker defines how a budget type is evaluated and deducted
type BudgetChecker interface {
    // Check decides whether the request is allowed
    Check(ctx context.Context, budgets []*TableBudget, baselines map[string]float64) (Decision, error)

    // Deduct updates usage after a successful request
    // Returns which budget IDs were actually charged and by how much
    Deduct(ctx context.Context, budgets []*TableBudget, cost float64) (map[string]float64, error)
}
```

两个实现：

- **GovernanceBudgetChecker** — AND 逻辑（现有行为），Deduct 全部扣
- **BillingBudgetChecker** — OR 逻辑（混合扣费），Deduct 按优先级部分扣

### 2.4 计费路径：找最近层级

BillingBudgetChecker 在检查时，从 VK 向上找**第一个**有 billing Budget 的层级，在那层做混合扣费：

**个人 VK**（`UserID != nil, TeamID == nil, CustomerID == nil`）：
```
VK 无 billing Budget → 找 User → User.Budgets(billing) → 混合扣费
User 也没有 → 不让用（429 budget_exceeded）
```

**组织 VK**（`TeamID != nil || CustomerID != nil`）：
```
VK 无 billing Budget → 找 Team → Team.Budgets(billing) → 混合扣费
Team 也没有 → 找 Customer → Customer.Budgets(billing) → 混合扣费
Customer 也没有 → 不让用（429 budget_exceeded）
注意：组织 VK 不看 User 的 billing Budget
```

### 2.5 "没有 billing Budget = 不让用"的实现

**判断依据**：TableUser 是否存在。TableUser 存在 = 该用户在 Platform 计费体系里，必须有 billing Budget 才能使用。

- 个人 VK：`vk.UserID` → 查 TableUser → 存在 → 要求必须有 billing Budget
- 组织 VK：`vk.CustomerID` → Customer 必须有 billing Budget
- TableUser 不存在 = 走纯治理模式（和现有行为一致）

VK 创建时不校验计费 Budget，请求时自然拒绝。

---

## 3. VK 分类与 Budget 挂载

### 3.1 VK 分两类

| 类型 | 条件 | 计费路径 | 治理路径 |
|------|------|---------|---------|
| 个人 VK | `UserID != nil, TeamID == nil, CustomerID == nil` | User 的 billing Budget | VK → User → Team → Customer |
| 组织 VK | `TeamID != nil \|\| CustomerID != nil` | Team → Customer 的 billing Budget（不看 User） | VK → User → Team → Customer |

### 3.2 Budget 挂载规则

| BudgetType | 挂在哪层 | 谁创建 | 作用 |
|---|---|---|---|
| governance | VK | 团队管理员 | 限制个人用量 |
| governance | Team | 组织管理员 | 限制团队用量 |
| governance | Customer | 组织管理员 | 限制组织总量 |
| governance | User | 团队/组织管理员 | 限制某用户在特定 Team/Customer 下的用量 |
| billing | User | 用户充值时 | 个人计费 |
| billing | Customer | 组织管理员充值时 | 组织计费 |

**VK 不再挂 billing Budget**。VK 只挂 governance Budget。

---

## 4. TableUser 新实体

### 4.1 结构

```go
// framework/configstore/tables/user.go
// 表名: governance_users

type TableUser struct {
    ID          string          `gorm:"primaryKey;type:varchar(255)" json:"id"`
    Name        string          `gorm:"type:varchar(255);not null" json:"name"`
    
    RateLimitID *string         `gorm:"type:varchar(255);index" json:"rate_limit_id,omitempty"`

    // Relationships
    Budgets     []TableBudget   `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"budgets,omitempty"`
    RateLimit   *TableRateLimit `gorm:"foreignKey:RateLimitID" json:"rate_limit,omitempty"`

    CreatedAt   time.Time       `gorm:"index;not null" json:"created_at"`
    UpdatedAt   time.Time       `gorm:"index;not null" json:"updated_at"`
}
```

### 4.2 与 VK 的关系

VK 已有 `UserID *string` 字段，直接关联到 `governance_users.id`。

### 4.3 设计意图

- **计费载体**：个人用户的 billing Budget 挂在 User 上
- **治理预留**：未来 enterprise 版可实现 `CheckUserBudget`，加个人级治理
- **计费模式标记**：TableUser 存在 = 该用户在计费体系里

---

## 5. TableBudget 变更

### 5.1 新增字段

```go
// 现有 owner FK（五选一，billing 类型排除 VK/PC）
TeamID           *string  `gorm:"type:varchar(255);index" json:"team_id,omitempty"`           // 治理/计费
VirtualKeyID     *string  `gorm:"type:varchar(255);index" json:"virtual_key_id,omitempty"`   // 仅治理
ProviderConfigID *uint    `gorm:"index" json:"provider_config_id,omitempty"`                 // 仅治理
CustomerID       *string  `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`      // 治理/计费（新增）
UserID           *string  `gorm:"type:varchar(255);index" json:"user_id,omitempty"`          // 治理/计费（新增）

// User scope FK（仅当 UserID != nil 时有效）
UserScopeTeamID     *string `gorm:"type:varchar(255);index" json:"user_scope_team_id,omitempty"`
UserScopeCustomerID *string `gorm:"type:varchar(255);index" json:"user_scope_customer_id,omitempty"`

// 类型字段
Type BudgetType `gorm:"type:varchar(20);default:'governance';not null" json:"type"`

// 一次性套餐到期时间
ExpiresAt *time.Time `gorm:"index" json:"expires_at,omitempty"`
```

### 5.2 BeforeSave 校验

```go
func (b *TableBudget) BeforeSave(tx *gorm.DB) error {
    // 1. Owners: 五选一
    owners := 0
    if b.TeamID != nil { owners++ }
    if b.VirtualKeyID != nil { owners++ }
    if b.ProviderConfigID != nil { owners++ }
    if b.CustomerID != nil { owners++ }
    if b.UserID != nil { owners++ }
    if owners > 1 {
        return fmt.Errorf("budget cannot have more than one owner")
    }

    // 2. billing 类型不允许挂 VK 或 ProviderConfig
    if b.Type == BudgetTypeBilling && (b.VirtualKeyID != nil || b.ProviderConfigID != nil) {
        return fmt.Errorf("billing budget cannot be attached to virtual key or provider config")
    }

    // 3. User scope 校验
    if b.UserID != nil {
        if b.UserScopeTeamID != nil && b.UserScopeCustomerID != nil {
            return fmt.Errorf("user budget scope cannot have both team_id and customer_id")
        }
    } else {
        if b.UserScopeTeamID != nil || b.UserScopeCustomerID != nil {
            return fmt.Errorf("user scope fields require user_id to be set")
        }
    }

    // 4. ResetDuration 校验（d == 0 允许，用于余额型和一次性套餐）
    if d, err := ParseDuration(b.ResetDuration); err != nil {
        return fmt.Errorf("invalid reset duration format: %s", b.ResetDuration)
    } else if d < 0 {
        return fmt.Errorf("reset duration cannot be negative: %s", b.ResetDuration)
    }

    // 5. MaxLimit 校验
    if b.MaxLimit < 0 {
        return fmt.Errorf("budget max_limit cannot be negative: %.2f", b.MaxLimit)
    }

    return nil
}
```

### 5.3 User Scope 语义

当 `UserID != nil` 时，`UserScopeTeamID` 和 `UserScopeCustomerID` 互斥，定义 Budget 的作用域：

| UserScopeTeamID | UserScopeCustomerID | 含义 | 对哪种 VK 生效 |
|---|---|---|---|
| nil | nil | 个人 User Budget | 个人 VK |
| 非空 | nil | 用户在特定 Team 下的 Budget | TeamID 匹配的组织 VK |
| nil | 非空 | 用户在特定 Customer 下的 Budget | CustomerID 匹配的组织 VK |

`collectBudgetsFromHierarchy` 中 User 层的收集逻辑：

```go
if vk.UserID != nil {
    userBudgets := gs.loadUserBudgets(*vk.UserID)
    for _, b := range userBudgets {
        if vk.TeamID == nil && vk.CustomerID == nil {
            // 个人 VK：只收集无 scope 的 Budget
            if b.UserScopeTeamID == nil && b.UserScopeCustomerID == nil {
                // 加入收集
            }
        }
        if vk.TeamID != nil && b.UserScopeTeamID != nil && *b.UserScopeTeamID == *vk.TeamID {
            // 组织 VK（Team）：收集匹配 TeamID 的 Budget
        }
        if vk.CustomerID != nil && b.UserScopeCustomerID != nil && *b.UserScopeCustomerID == *vk.CustomerID {
            // 组织 VK（Customer）：收集匹配 CustomerID 的 Budget
        }
    }
}
```

---

## 6. TableCustomer 变更

### 6.1 从单 Budget 改为多 Budget

```go
// 现在
BudgetID *string `gorm:"type:varchar(255);index" json:"budget_id,omitempty"`

// 改后
Budgets []TableBudget `gorm:"foreignKey:CustomerID;constraint:OnDelete:CASCADE" json:"budgets,omitempty"`
```

`collectBudgetsFromHierarchy` 中 Customer 部分的收集逻辑改为遍历 `vk.Customer.Budgets`，和 Team 一致。

不需要做数据迁移。

---

## 7. BillingBudgetChecker 混合扣费算法

### 7.1 排序规则

同一层级多个 billing Budget 时，按以下优先级排序：

```
1. 套餐型（ResetDuration != "0"）优先于余额型（ResetDuration="0"）
2. 套餐中，ResetDuration 短的优先：日度 > 月度 > 年度（快过期先用）
3. 同 ResetDuration，剩余额度少的优先（先用完再换下一个）
4. 一次性套餐（ExpiresAt 非空）按到期时间排序，快过期优先
```

### 7.2 Check 算法

和治理 Budget 保持一致 — **不估算本次请求费用**（无法预估），只检查历史累计是否超额。

```
输入: budgets []*TableBudget, baselines map[string]float64
输出: DecisionAllow / DecisionBudgetExceeded

1. 过滤已失效的 Budget（ExpiresAt != nil && time.Now().After(*ExpiresAt)）
2. 按 sortRules 排序 budgets
3. 计算总可用额 = Σ max(budget.MaxLimit - budget.CurrentUsage - baseline, 0)
4. 总可用额 > 0 → Allow
5. 总可用额 <= 0 → BudgetExceeded
```

### 7.3 Deduct 算法

支持折扣，Budget 上加 OffPeakDiscount 字段，购买套餐时从模板复制过来，Deduct 时直接读取，零额外查询。

更新 Budget 结构和 Deduct 流程：

```go
    // TableBudget 新增
    OffPeakDiscount string gorm:"type:text" json:"off_peak_discount,omitempty"
    // JSON: 折扣规则，从套餐模板复制，Deduct 时使用
    // 余额型 Budget 此字段为空
```

Deduct 流程更新：

```python
    Deduct(ctx, budgets, cost):
      1. 过滤已失效的 Budget（ExpiresAt 检查）
      2. 按 sortRules 排序 budgets
      3. remaining := cost
      4. for each budget in sorted:
           discount = evaluateOffPeak(budget.OffPeakDiscount, time.Now())
           if discount == 0: discount = 1.0  // 防止除零
           adjustedCost = remaining * discount
           available := budget.MaxLimit - budget.CurrentUsage
           if available >= adjustedCost:
             deduct = adjustedCost
             remaining = 0
           else:
             deduct = available
             remaining = (adjustedCost - available) / discount  // 还原原价
           if deduct > 0:
             BumpBudgetUsage(budget.ID, deduct)
             charged[budget.ID] = deduct
           if remaining <= 0: break
      5. if remaining > 0: 返回 error（零透支）
      6. return charged
```

折扣跟着 Budget 走，关键是 remaining 要还原成原价再交给下一个 Budget 计算，因为下一个 Budget 可能没有折扣。
推演一下：

```
    cost = $6
    套餐 Budget (discount=0.5, available=$2):
      adjustedCost = $6 * 0.5 = $3
      available < adjustedCost → deduct = $2
      remaining = ($3 - $2) / 0.5 = $2  （还原原价）

    余额 Budget (无折扣, available=$5):
      discount = 1.0
      adjustedCost = $2 * 1.0 = $2
      available >= adjustedCost → deduct = $2
      remaining = 0 → 结束

    总扣费: 套餐 $2 + 余额 $2 = $4
    用户实际消费 $6 的 API，但非高峰套餐部分打 5 折，付 $4


    再验证一个场景 — 两个套餐 Budget 折扣不同：


    cost = $6
    套餐A (discount=0.5, available=$1):
      adjustedCost = $6 * 0.5 = $3
      available < adjustedCost → deduct = $1
      remaining = ($3 - $1) / 0.5 = $4

    套餐B (discount=0.8, available=$3):
      adjustedCost = $4 * 0.8 = $3.2
      available < adjustedCost → deduct = $3
      remaining = ($3.2 - $3) / 0.8 = $0.25

    余额 (discount=1.0, available=$1):
      adjustedCost = $0.25 * 1.0 = $0.25
      deduct = $0.25
      remaining = 0

    总扣费: $1 + $3 + $0.25 = $4.25
    验证: $6 中 $2 走套餐A(5折=$1), $3.75 走套餐B(8折=$3), $0.25 走余额(原价=$0.25)
    = $1 + $3 + $0.25 = $4.25 ✓
```

### 7.4 Streaming 场景

和治理 Budget 行为一致：

```go
shouldUpdateBudget := !update.IsStreaming || (update.IsStreaming && update.HasUsageData)
```

- 非 Streaming：PostHook 时一次性 Deduct
- Streaming：每个带 usage data 的 chunk 扣一点

---

## 8. 充值流程

### 8.1 余额充值

个人用户充 $50 → 查找 User 上 `Type=billing && ResetDuration="0" && ExpiresAt=nil` 的 Budget：
- 找到 → `MaxLimit += 50`（累加）
- 没找到 → 创建新 Budget（首次充值）

组织管理员充 $1000 → 同理，操作 Customer 上的 Budget。

### 8.2 订阅型套餐购买

购买"月度 $100 套餐" → 创建新 Budget：
```
Type:           billing
UserID/CustomerID: 对应 owner
MaxLimit:       100
ResetDuration:  "1M"
ExpiresAt:      nil（永不过期，靠 ResetDuration 重置续用）
```

到期后 ResetDuration 触发 CurrentUsage 归零，Budget 继续生效。

### 8.3 一次性套餐购买

购买"30 天 $50 套餐" → 创建新 Budget：
```
Type:           billing
UserID/CustomerID: 对应 owner
MaxLimit:       50
ResetDuration:  "0"（永不重置）
ExpiresAt:      now + 30d
```

到期后 Check/Deduct 跳过此 Budget（等同于失效）。

### 8.4 充值类型汇总

| 充值类型 | 操作 | Budget 特征 |
|---|---|---|
| 余额充值 | 首次创建 / 后续累加 MaxLimit | ResetDuration="0", ExpiresAt=nil |
| 订阅型套餐 | 创建新 Budget | ResetDuration="1M"/"1y", ExpiresAt=nil |
| 一次性套餐 | 创建新 Budget | ResetDuration="0", ExpiresAt=到期时间 |

---

## 9. 已知 Bug：ResetDuration="0"

`BumpBudgetUsage` 和 `CheckBudget` 中，`ResetDuration="0"` 导致 `ParseDuration("0")` 返回 `0`，`time.Since(LastReset) >= 0` 永远为 true，**每次调用清零 CurrentUsage**。

**修复**：两处加 `&& duration > 0` 保护。

---

## 10. 完整示例

### 10.1 个人用户

```
User alice:
  Budget-1 (billing): 余额 $20  (ResetDuration="0", ExpiresAt=nil)
  Budget-2 (billing): 月度套餐 $50  (ResetDuration="1M")

VK-1 (UserID=alice, 无 TeamID/CustomerID):
  Budget-3 (governance): 日限 $10  (ResetDuration="1d")

请求 $6 →
  治理检查: Budget-3 AND → CurrentUsage < $10 → Allow
  计费检查: Budget-2(月度,优先) + Budget-1(余额,兜底) → 总可用 > 0 → Allow
  扣费: Budget-2 扣 $6, charged = {Budget-2: 6}
```

### 10.2 组织用户

```
Customer org-1:
  Budget-C1 (billing): 余额 $1000  (ResetDuration="0")

Team A:
  Budget-T1 (governance): 月限 $800

VK-2 (UserID=bob, TeamID=teamA):
  Budget-V1 (governance): 日限 $200

User bob:
  Budget-U1 (governance, UserScopeTeamID=teamA): 月限 $300

请求 $5 →
  治理检查 (AND):
    VK-2: Budget-V1 → $200 日限 → OK
    User: Budget-U1 (scope=teamA) → $300 月限 → OK
    Team: Budget-T1 → $800 月限 → OK
    Customer: 无 governance Budget → OK
    → Allow
  计费检查:
    VK 无 billing → Team 无 billing → Customer Budget-C1 → 余额 $1000 → Allow
  扣费: Budget-C1 扣 $5
```

---

## 11. Credits 货币体系

### 11.1 设计定位

Credits 是用户侧的货币单位，Budget 内部始终用美元。

- **1 Credit = $0.01（1 美分）**
- 充值/套餐定价用 Credits，Budget 的 MaxLimit 存美元
- Credits 层可以做充值优惠、多区域定价，不影响治理/计费逻辑

### 11.2 换算流程

```
充值: 用户付 $10 → 得 1100 Credits（有赠送）→ Budget.MaxLimit += $11
套餐: $20 买 Quota=2500 Credits 的套餐 → Budget.MaxLimit = $25
扣费: tokens * price_per_token = $0.03 → Deduct $0.03 from Budget
展示: 用户看到 "已消费 3 Credits"（$0.03 * 100）
```

### 11.3 为什么不在 Budget 里存 Credits

- 治理 Budget 已经用美元，计费 Budget 也用美元，逻辑统一
- Credits 换算只在充值/展示层，运行时零开销
- 避免治理和计费两套单位转换

---

## 12. 套餐体系

### 12.1 套餐 = 多权益包

套餐不是单个 Budget，而是多种权益的组合：

```
套餐 = {
  Budget:            额度上限（$50/月）
  RateLimit:         调用频率限制（100 RPM）
  AllowedModels:     可用厂商和模型（如只允许 GPT-4o, Claude 3.5）
  OffPeakDiscount:   非高峰折扣（如 22:00-06:00 半价）
  AutoRenew:         到期是否自动续费
}
```

购买套餐 = 创建多个子资源（Budget + RateLimit + UserProviderConfig + 折扣规则）。

### 12.2 计费 Budget 的生命周期

计费层面使用 `ExpiresAt`，不使用 `ResetDuration`（ResetDuration 仅用于治理层面）。

| 场景 | ResetDuration | ExpiresAt | 行为 |
|---|---|---|---|
| 余额 | "0" | nil | 永不过期，充值累加 MaxLimit |
| 一次性套餐 | "0" | now + duration | 到期失效，Check/Deduct 跳过 |
| 月度订阅 | "0" | now + 30d | 到期失效，续费时创建新 Budget |

连续订阅 = 到期后创建新 Budget，而不是重置旧 Budget。每个订阅周期有独立的 Budget，消费记录清晰。

### 12.3 TablePlatformPackage — 套餐商品模板

```go
// framework/configstore/tables/platform_package.go
// 表名: platform_packages

type TablePlatformPackage struct {
    ID          string  `gorm:"type:varchar(36);primaryKey" json:"id"`
    Name        string  `gorm:"type:varchar(100);not null" json:"name"`
    Description string  `gorm:"type:text" json:"description,omitempty"`

    // 定价（Credits，1 Credit = $0.01）
    Price       float64 `gorm:"type:decimal(10,2);not null" json:"price"`
    // 售价（Credits）
    Quota       float64 `gorm:"type:decimal(20,6);not null" json:"quota"`
    // 包含的额度（Credits），购买后转为 Budget 的 MaxLimit（美元 = Quota / 100）

    // 有效期（天数）
    Duration    int     `gorm:"not null" json:"duration"`
    // 30 = 30天, 365 = 1年

    // 权益内容（模板，购买时复制到 entity_package 和子资源）
    RateLimitConfig  string  `gorm:"type:text" json:"rate_limit_config,omitempty"`
    // JSON: RateLimit 配置模板，购买时创建 RateLimit 记录
    AllowedModels    string  `gorm:"type:text" json:"allowed_models,omitempty"`
    // JSON: 允许的厂商和模型列表，购买时创建 UserProviderConfig
    OffPeakDiscount  string  `gorm:"type:text" json:"off_peak_discount,omitempty"`
    // JSON: 非高峰折扣规则，如 {"start":"22:00","end":"06:00","discount":0.5}
    AutoRenew        bool    `gorm:"default:false" json:"auto_renew"`
    // 到期是否自动续费

    // 销售范围
    TargetType  string  `gorm:"type:varchar(20);not null;default:'both'" json:"target_type"`
    // "user" / "customer" / "both"

    // 限购
    MaxPurchasePerUser int `gorm:"default:0" json:"max_purchase_per_user"`
    // 0 = 不限

    // 状态
    IsActive    bool    `gorm:"default:true;index" json:"is_active"`
    SortOrder   int     `gorm:"default:0" json:"sort_order"`

    // Stripe 集成（可选）
    StripePriceID *string `gorm:"type:varchar(128)" json:"stripe_price_id,omitempty"`

    CreatedAt   time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt   time.Time `gorm:"index;not null" json:"updated_at"`
}
```

### 12.4 TableEntityPackage — 套餐购买实例

```go
// framework/configstore/tables/platform_entity_package.go
// 表名: platform_entity_packages

type TableEntityPackage struct {
    ID          string  `gorm:"type:varchar(36);primaryKey" json:"id"`

    // 归属（二选一）
    UserID      *string `gorm:"type:varchar(255);index" json:"user_id,omitempty"`
    CustomerID  *string `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`

    // 关联套餐模板
    PackageID   string  `gorm:"type:varchar(36);not null;index" json:"package_id"`

    // 权益实例（购买时从模板创建的子资源）
    BudgetID            *string `gorm:"type:varchar(255);index" json:"budget_id,omitempty"`
    // 购买时创建的 billing Budget
    RateLimitID         *string `gorm:"type:varchar(255);index" json:"rate_limit_id,omitempty"`
    // 购买时创建的 RateLimit（如果套餐包含）
    UserProviderConfigID *string `gorm:"type:varchar(255);index" json:"user_provider_config_id,omitempty"`
    // 购买时创建的 UserProviderConfig（如果套餐包含 AllowedModels）
    OffPeakDiscount     string  `gorm:"type:text" json:"off_peak_discount,omitempty"`
    // 从模板复制，Deduct 时根据时间段乘折扣系数

    // 续费
    AutoRenew       bool    `gorm:"default:false" json:"auto_renew"`
    RenewedFromID   *string `gorm:"type:varchar(36);index" json:"renewed_from_id,omitempty"`
    // 续费自哪个 entity_package

    // 有效期
    StartedAt   time.Time `gorm:"not null;index" json:"started_at"`
    ExpiresAt   time.Time `gorm:"not null;index" json:"expires_at"`

    // 来源
    Source      string  `gorm:"type:varchar(20);not null;default:'order'" json:"source"`
    // "order" / "admin" / "redemption"
    OrderID     *string `gorm:"type:varchar(64)" json:"order_id,omitempty"`

    // 状态
    Status      string  `gorm:"type:varchar(20);not null;default:'active';index" json:"status"`
    // active / expired / cancelled

    CreatedAt   time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt   time.Time `gorm:"index;not null" json:"updated_at"`

    // 关联
    Package     TablePlatformPackage `gorm:"foreignKey:PackageID" json:"package,omitempty"`
}
```

**复合索引**：
- `idx_user_active` ON (user_id, status, expires_at)
- `idx_customer_active` ON (customer_id, status, expires_at)

### 12.5 TableUserProviderConfig — 用户级 Provider 配置

AllowedModels 是用户维度的权益，结构对齐 `TableVirtualKeyProviderConfig`：User 1:N UserProviderConfig，每个 provider 一行。

设计考量：
- 多套餐并存场景少，以升级为主，升级后模型列表是超集
- 每个 provider 一行，便于未来扩展每模型单独限制（token 配额、价格倍率等）
- 和 VK ProviderConfig 同构，降低认知成本

```go
// framework/configstore/tables/user_provider_config.go
// 表名: governance_user_provider_configs

type TableUserProviderConfig struct {
    ID        uint              `gorm:"primaryKey;autoIncrement" json:"id"`
    UserID    string            `gorm:"type:varchar(255);not null;index:idx_user_provider" json:"user_id"`
    // FK → governance_users.id

    Provider  string            `gorm:"type:varchar(50);not null;index:idx_user_provider" json:"provider"`
    // 同 VK ProviderConfig，每个 provider 一行

    AllowedModels schemas.WhiteList `gorm:"type:text;serializer:json" json:"allowed_models"`
    // ["*"] = 该 provider 下所有模型；空 = 该 provider 不允许
    // 同 TableVirtualKeyProviderConfig.AllowedModels

    // 来源套餐（可选，管理员手动配置时为 nil）
    EntityPackageID *string `gorm:"type:varchar(36);index" json:"entity_package_id,omitempty"`
    // FK → platform_entity_packages.id

    // 扩展预留：每模型单独限制
    ModelConfig string `gorm:"type:text" json:"model_config,omitempty"`
    // JSON: {"gpt-4o": {"token_limit": 100000, "price_multiplier": 0.8}, ...}

    CreatedAt time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt time.Time `gorm:"index;not null" json:"updated_at"`
}
```

**复合唯一索引**：`idx_user_provider` ON (user_id, provider) — 同一 User 同一 Provider 只有一行。

**PreHook 检查**：请求进入时，查 `WHERE user_id = ? AND provider = ?`，如果存在且 model 不在 AllowedModels 中 → 拒绝（403 forbidden_model）。

#### 12.5.1 购买套餐时的合并算法

```
购买套餐（AllowedModels = {openai: [gpt-4o], anthropic: [claude-3.5]}）:
  for each provider in AllowedModels:
    upsert UserProviderConfig(user_id, provider):
      exists → AllowedModels = union(old, new)
      not exists → create with new
```

#### 12.5.2 套餐到期/降级时的重建算法

```
套餐到期:
  for each provider in expiredPkg.AllowedModels:
    activeModels = query all active EntityPackages for this user, this provider
    if activeModels is empty → delete this row
    else → update AllowedModels = union of all activeModels
```

#### 12.5.3 和 VK ProviderConfig 的对比

| | VK ProviderConfig | User ProviderConfig |
|---|---|---|
| 归属 | VK 1:N | User 1:N |
| 粒度 | per provider | per provider |
| AllowedModels | WhiteList | WhiteList（同结构） |
| 额外字段 | Weight, Keys, RateLimit | EntityPackageID, ModelConfig |
| 来源 | 管理员配置 | 套餐购买 / 管理员配置 |

### 12.6 购买套餐的完整流程

```
用户购买套餐 → 创建 platform_orders 记录
             → 支付成功后:
               1. 创建 billing Budget (MaxLimit = Quota / 100 美元, ExpiresAt = now + Duration)
               2. 创建 RateLimit (如果套餐包含)
               3. Upsert UserProviderConfig (per provider, UNION AllowedModels，见 12.5.1)
               4. 创建 platform_entity_packages (关联以上子资源)
               5. 保存 OffPeakDiscount 到 entity_package

续费时:
  1. 创建新的 billing Budget (新周期)
  2. 创建新的 RateLimit (新周期)
  3. UserProviderConfig per provider upsert（UNION 合并，见 12.5.1）
  4. 创建新的 entity_package (RenewedFromID 指向旧记录)
  5. 旧 Budget 到期后自然失效（ExpiresAt 检查）
```

---

## 13. 订单与支付

### 13.1 订单场景

| 场景 | 付款方 | 获得 | 创建的子资源 |
|---|---|---|---|
| 余额充值 | User/Customer | Credits → Budget MaxLimit 累加 | 更新 billing Budget |
| 套餐购买 | User/Customer | 套餐权益包 | Budget + RateLimit + UserProviderConfig + EntityPackage |

兑换码兑换不走订单表，兑换码表自身记录 UsedBy/UsedAt。

### 13.2 TablePlatformOrder — 统一订单表

充值和套餐购买共用一张订单表，差异字段用 nullable。

```go
// framework/configstore/tables/platform_order.go
// 表名: platform_orders

type TablePlatformOrder struct {
    ID        uint   `gorm:"primaryKey;autoIncrement" json:"id"`
    OrderNo   string `gorm:"type:varchar(64);uniqueIndex;not null" json:"order_no"`
    // 订单号前缀区分类型：
    //   "RCH-" + UUID → 充值订单
    //   "PKG-" + UUID → 套餐购买订单

    // 归属
    UserID     *string `gorm:"type:varchar(255);index" json:"user_id,omitempty"`
    // 操作者（组织充值时填管理员）/ 个人用户
    CustomerID *string `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`
    // 组织（组织充值/购买时）

    // 订单类型
    Type       string `gorm:"type:varchar(20);not null;index" json:"type"`
    // "recharge" / "package_purchase"

    // 金额
    Amount     float64 `gorm:"type:decimal(10,2);not null" json:"amount"`
    // 实付金额（美元）
    Credits    float64 `gorm:"type:decimal(20,6);default:0" json:"credits"`
    // 获得的 Credits（1 Credit = $0.01）
    // Credits / 100 = Budget 增加的美元额度
    // Credits / 100 - Amount = 赠送部分

    // 关联（套餐购买时）
    PackageID       *string `gorm:"type:varchar(36);index" json:"package_id,omitempty"`
    // 关联 platform_packages.id
    EntityPackageID *string `gorm:"type:varchar(36);index" json:"entity_package_id,omitempty"`
    // 关联 platform_entity_packages.id

    // 支付信息
    PaymentMethod   string   `gorm:"type:varchar(20)" json:"payment_method"`
    // "stripe" / "admin"
    PaymentID       string   `gorm:"type:varchar(200)" json:"payment_id,omitempty"`
    // 支付平台交易 ID
    PaidAt          *time.Time `json:"paid_at,omitempty"`

    // 状态
    Status          string `gorm:"type:varchar(20);not null;default:'pending';index" json:"status"`
    // pending / success / failed / expired / cancelled

    // 支付平台原始数据（对账用）
    ProviderPayload string `gorm:"type:text" json:"provider_payload,omitempty"`

    CreatedAt time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt time.Time `gorm:"index;not null" json:"updated_at"`
}
```

### 13.3 订单状态机

```
pending → success  (支付回调成功)
pending → failed   (支付回调失败)
pending → expired  (超时未支付)
pending → cancelled (用户取消)
```

### 13.4 充值订单流程

```
1. 用户发起充值（选择金额/Credits）
2. 创建订单 (status=pending, type=recharge)
3. 调用支付平台（Stripe）创建 PaymentIntent
4. 用户完成支付
5. 支付回调 → 更新订单 (status=success, paid_at, payment_id)
6. 业务逻辑：
   a. 查找 User/Customer 上的余额型 billing Budget
   b. 找到 → Budget.MaxLimit += Credits / 100
   c. 没找到 → 创建新 Budget (Type=billing, ResetDuration="0", ExpiresAt=nil)
```

### 13.5 套餐购买订单流程

```
1. 用户选择套餐
2. 创建订单 (status=pending, type=package_purchase, package_id=X)
3. 调用支付平台
4. 用户完成支付
5. 支付回调 → 更新订单 (status=success)
6. 业务逻辑（见 12.6 购买套餐完整流程）：
   a. 创建 billing Budget
   b. 创建 RateLimit（如果有）
   c. 创建/更新 UserProviderConfig（如果有）
   d. 创建 EntityPackage（关联子资源）
   e. 保存 OffPeakDiscount
```

---

## 14. Payment 模块

### 14.1 项目定位

`plugins/payment/` — Bifrost Go workspace 下的独立模块，与 governance 平级。

- 有自己的 `go.mod`，通过 workspace 引用 `core/`、`framework/`
- 注册为 Bifrost HTTP handler，通过 Bifrost 端口暴露端点
- 函数内调用 governance store（不走 HTTP API），共享数据库
- 不直接操作 Bifrost DB，通过 governance store 方法调用

### 14.2 架构

```
┌──────────────────────────────────────────────┐
│  plugins/payment/                            │
│                                              │
│  handler.go       → HTTP 端点注册 + 请求处理   │
│  service.go       → 业务编排（订单/充值/购买） │
│  gateway.go       → PaymentGateway interface  │
│  stripe.go        → StripeGateway 实现        │
│  manual.go        → ManualGateway 实现        │
│  webhook.go       → Webhook 处理 + 签名验证    │
└──────────┬───────────────────────────────────┘
           │ 函数调用
           ▼
┌──────────────────────────────────────────────┐
│  plugins/governance/                         │
│                                              │
│  store.go         → Budget/User/Customer CRUD │
│  checker.go       → BudgetChecker interface   │
└──────────────────────────────────────────────┘
```

### 14.3 PaymentGateway 接口

```go
// plugins/payment/gateway.go

type PaymentGateway interface {
    // CreatePayment 创建支付意图，返回跳转 URL 或支付凭证
    CreatePayment(ctx context.Context, order *tables.TablePlatformOrder, opts PaymentOptions) (*PaymentResult, error)

    // HandleWebhook 处理支付平台回调
    HandleWebhook(ctx context.Context, payload []byte, sig string) (*WebhookResult, error)

    // VerifyPayment 查询支付状态（用于主动对账）
    VerifyPayment(ctx context.Context, paymentID string) (*PaymentStatus, error)
}

type PaymentOptions struct {
    PreferredCurrency string            // "usd"/"jpy"/"eur"，用户偏好的展示货币
    ReturnURL         string            // 支付完成后跳回的 URL
    Metadata          map[string]string // 附加数据（order_no 等）
}

type PaymentResult struct {
    PaymentID   string // 支付平台交易 ID
    CheckoutURL string // Checkout Session 跳转 URL（Stripe 专用）
    Status      string // "pending"
}

type WebhookResult struct {
    OrderNo    string  // 匹配到订单号
    Status     string  // "success" / "failed"
    PaymentID  string  // 支付平台交易 ID
    PaidAmount float64 // 实付金额（USD）
}

type PaymentStatus struct {
    Status     string
    PaidAmount float64
}
```

### 14.4 两个实现

**StripeGateway** — 生产环境，使用 Stripe Checkout Session：

```go
// plugins/payment/stripe.go

type StripeGateway struct {
    apiKey        string // sk_live_xxx / sk_test_xxx
    webhookSecret string // whsec_xxx
    currency      string // 基础货币，"usd"
}

// CreatePayment:
//   1. 调 stripe.CheckoutSession.Create()
//      - amount = order.Amount * 100 (cents)
//      - currency = PaymentOptions.PreferredCurrency（MVP 阶段 Stripe 自动换算汇率）
//      - metadata = { "order_no": order.OrderNo }
//   2. 返回 Session.URL 作为 CheckoutURL

// HandleWebhook:
//   1. 验证 Stripe 签名（webhookSecret + sig header）
//   2. 解析 event type: checkout.session.completed → success
//   3. 从 metadata 取 order_no 匹配订单

// VerifyPayment:
//   1. 调 stripe.CheckoutSession.Get(paymentID)
//   2. 返回状态和实付金额
```

**ManualGateway** — admin 手动标记，无 Stripe：

```go
// plugins/payment/manual.go

type ManualGateway struct{}

// CreatePayment → 直接返回 success（不需要跳转支付）
// HandleWebhook → 不需要
// VerifyPayment → 直接返回 success
```

### 14.5 多地区货币

定价层固定 USD，支付层按用户偏好货币展示：

- **MVP 阶段**：创建 Checkout Session 时传 `preferred_currency`，Stripe 自动换算展示金额
  - Stripe 收额外 1% 汇率手续费
  - 实际结算金额 = USD × Stripe 实时汇率
  - 订单表始终存 USD
- **后期扩展**：主动定价策略，维护 USD→当地货币价格表，创建 Session 时直接传当地货币金额

### 14.6 配置方式

```json
{
  "billing": {
    "gateway": "stripe",
    "stripe": {
      "api_key": "sk_live_xxx",
      "webhook_secret": "whsec_xxx"
    }
  }
}
```

- `"gateway": "manual"` 或不配置 `billing` 段 → ManualGateway（admin 手动充值、测试环境）
- `"gateway": "stripe"` → StripeGateway

### 14.7 HTTP 端点

遵循 Bifrost 现有风格：`/api/{domain}/{resource-name}` + RESTful + 复数 + kebab-case + 无版本号。

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| **充值** | | | |
| POST | /api/billing/recharge | 创建充值订单 + 返回 Checkout URL | 需 auth |
| **套餐购买** | | | |
| POST | /api/billing/purchases | 创建套餐购买订单 + 返回 Checkout URL | 需 auth |
| **订单** | | | |
| GET | /api/billing/orders | 查询订单列表（支持分页/过滤） | 需 auth |
| GET | /api/billing/orders/{orderId} | 查询单个订单 | 需 auth |
| **套餐商品** | | | |
| GET | /api/billing/packages | 查询可购买套餐列表 | 需 auth |
| GET | /api/billing/packages/{packageId} | 查询单个套餐详情 | 需 auth |
| POST | /api/billing/packages | 创建套餐商品 | admin |
| PUT | /api/billing/packages/{packageId} | 更新套餐商品 | admin |
| DELETE | /api/billing/packages/{packageId} | 删除套餐商品 | admin |
| **套餐实例** | | | |
| GET | /api/billing/entity-packages | 查询用户已购套餐 | 需 auth |
| GET | /api/billing/entity-packages/{epId} | 查询单个实例 | 需 auth |
| **Webhook** | | | |
| POST | /api/billing/webhook/stripe | Stripe 回调 | 无 auth（签名验证由 handler 内部做） |
| **Admin** | | | |
| POST | /api/billing/admin/recharge | 管理员手动给用户充值（跳过 Stripe） | admin |

注：
- `recharge` 和 `purchases` 是动作端点（同 `/api/platform/login` 风格）
- `entity-packages` 的写操作由 webhook 回调内部完成，不暴露写端点
- 套餐商品 CRUD 放 billing 域，因为它是计费概念

### 14.8 充值完整流程

```
1. 用户点"充值 $50"（可选偏好货币 JPY）
2. POST /api/billing/recharge { amount: 50, currency: "jpy" }
3. service 创建订单 (status=pending, type=recharge, amount=50)
4. gateway.CreatePayment(order, {preferredCurrency: "jpy"})
   → Stripe: 创建 Checkout Session (amount=5000 cents USD, preferred_currency=jpy)
   → 返回 checkout_url
5. 返回前端 { checkout_url: "https://checkout.stripe.com/..." }
6. 前端跳转 checkout_url → 用户在 Stripe 页面付款（看到 JPY 金额）
7. Stripe webhook → POST /api/billing/webhook/stripe
   → gateway.HandleWebhook() 验签 + 解析
   → 匹配 order_no → 更新订单 (status=success, paid_at, payment_id)
   → 调 governance store 执行充值逻辑：
     a. 查找 User/Customer 上的余额型 billing Budget
     b. 找到 → Budget.MaxLimit += Credits / 100
     c. 没找到 → 创建新 Budget (Type=billing, ResetDuration="0", ExpiresAt=nil)
```

### 14.9 套餐购买完整流程

```
1. 用户选择套餐
2. POST /api/billing/purchases { package_id: "xxx" }
3. service 创建订单 (status=pending, type=package_purchase, package_id=X)
4. gateway.CreatePayment(order, {preferredCurrency: ...})
   → 返回 checkout_url
5. Stripe webhook → 更新订单 status=success
6. 调 governance store 执行购买逻辑（见 12.6）：
   a. 创建 billing Budget (MaxLimit = Quota / 100, ExpiresAt = now + Duration)
   b. 创建 RateLimit（如果套餐包含）
   c. Upsert UserProviderConfig per provider（见 12.5.1）
   d. 创建 EntityPackage（关联子资源）
   e. 保存 OffPeakDiscount 到 EntityPackage 和 Budget
```

---

## 15. 待后续讨论

- [ ] 兑换码设计
- [ ] 前端 UI 交互
- [ ] admin console 治理 Budget 管理 UI 适配
