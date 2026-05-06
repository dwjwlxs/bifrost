# Bifrost 计费系统 — 数据模型设计

> 版本: v2.0 | 状态: 设计中 | 依赖: [billing-overview.md](./billing-overview.md)

---

## 1. 设计原则

1. **复用优先**：扩展现有表而非新建，减少迁移成本和代码重复
2. **单一职责**：每张表只服务一个核心概念，通过外键关联
3. ** Nullable 扩展**：新增字段全部 nullable 或有默认值，保证向后兼容
4. **原子操作**：余额变更高并发场景下使用 `gorm.Expr()` 避免 read-modify-write 竞态
5. **多态归属**：余额表使用 `entity_type + entity_id` 模式，统一 user/customer

---

## 2. 现有表变更

### 2.1 `governance_budgets` — 扩展归属字段

**现状**：仅支持 `TeamID *string`、`VirtualKeyID *string`、`ProviderConfigID *uint` 三选一归属。

**变更**：新增 3 个冗余元数据字段，用于管理查询/审计/报表。运行时计费路径不依赖这些字段，计费 Budget 通过 `VirtualKeyID` 挂载到 VK，走现有 `collectBudgetsFromHierarchy` 链路。

```go
// framework/configstore/tables/budget.go — 新增字段

type TableBudget struct {
    // ... 现有字段保持不变 ...

    // ↓ 新增字段（冗余元数据，运行时不用于查找 Budget） ↓

    // UserID 冗余字段：仅用于管理查询（如"用户维度账单"），运行时不依赖此字段查找 Budget。
    // 运行时路径：请求 → VK → collectBudgetsFromHierarchy → VK.Budgets → 扣费
    UserID *string `gorm:"type:varchar(36);index" json:"user_id,omitempty"`

    // CustomerID 冗余字段：仅用于组织维度审计和报表，运行时不依赖此字段查找 Budget。
    CustomerID *string `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`

    // PackageID 冗余字段：仅用于标识 Budget 来源套餐，以及批量操作（如套餐过期清理）。
    // 不计入 BeforeSave 的 owners 互斥校验（它是元数据 FK，不是归属 FK）。
    PackageID *string `gorm:"type:varchar(36);index" json:"package_id,omitempty"`
}
```

**索引**：
- `idx_budget_user` ON (user_id) — 查询用户所有 Budget
- `idx_budget_customer` ON (customer_id) — 查询组织所有 Budget
- `idx_budget_package` ON (package_id) — 查询套餐关联的 Budget

**语义约定**：
- `UserID` 非空 + `PackageID` 为空 → 按量付费 Budget
- `UserID` 非空 + `PackageID` 非空 → 用户级套餐 Budget
- `CustomerID` 非空 + `PackageID` 非空 → 组织级套餐 Budget
- `ResetDuration = "0"` → 永不重置（用于预付费套餐"用完为止"语义）

**运行时计费路径**（与归属字段无关）：
```
请求 → VK → collectBudgetsFromHierarchy → VK.Budgets（含计费Budget）→ BumpBudgetUsage 扣费
                                              ↑
                              计费Budget通过VirtualKeyID挂载到VK上
                              挂载时机：充值/购买套餐时自动创建并关联
```
- 新增的 `UserID`/`CustomerID`/`PackageID` 不参与运行时查找
- 不需要新建 `userBillingBudgets sync.Map`
- 不需要改 `CheckUserBudget` / `UpdateUserBudgetUsageInMemory`
- 唯一改动点：`BeforeSave` 中 owners 计数从 3 个 FK 扩展到 5 个 FK（`PackageID` 不计入）

### 2.2 `governance_rate_limits` — 扩展归属字段（预留）

当前 `TableRateLimit` 无归属字段，挂在 VK 上。后续如需支持"套餐调用次数限制"，需新增 `UserID`、`CustomerID`、`PackageID` 字段，结构与 Budget 扩展一致。

**当前阶段暂不实施**，仅记录为 TODO。

---

## 3. 新建表

### 3.1 `governance_balances` — 余额表

**职责**：存储用户和组织的 Credits 余额，是整个计费系统的"钱包"。

```go
// framework/configstore/tables/balance.go

type TableBalance struct {
    ID         uint   `gorm:"primaryKey;autoIncrement" json:"id"`
    EntityType string `gorm:"type:varchar(20);not null;uniqueIndex:idx_entity" json:"entity_type"`
    // "user" 或 "customer"
    EntityID   string `gorm:"type:varchar(36);not null;uniqueIndex:idx_entity" json:"entity_id"`
    // auth_users.id 或 customers.id

    Balance           float64 `gorm:"type:decimal(20,6);default:0;not null" json:"balance"`
    // 当前可用余额（Credits）
    TotalRecharge     float64 `gorm:"type:decimal(20,6);default:0;not null" json:"total_recharge"`
    // 累计充值总额（Credits）
    TotalConsumption  float64 `gorm:"type:decimal(20,6);default:0;not null" json:"total_consumption"`
    // 累计消费总额（Credits）

    CreatedAt time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt time.Time `gorm:"index;not null" json:"updated_at"`
}
```

**唯一索引**：`idx_entity` ON (entity_type, entity_id) — 每个 user/customer 恰好一条余额记录。

**并发安全**：
- 余额增加：`gorm.Expr("balance + ?", amount)`
- 余额扣减：`gorm.Expr("balance - ?", amount)` + WHERE balance >= amount
- 扣减时检查影响行数 = 0 → 余额不足

### 3.2 `platform_packages` — 套餐商品表

**职责**：管理员定义的套餐商品模板，属于平台运营层。

```go
// framework/configstore/tables/platform_package.go

type TablePlatformPackage struct {
    ID          string  `gorm:"type:varchar(36);primaryKey" json:"id"`
    // UUID，便于跨系统引用
    Name        string  `gorm:"type:varchar(100);not null" json:"name"`
    // 套餐名称，如 "Pro Monthly"
    Description string  `gorm:"type:text" json:"description,omitempty"`
    // 套餐描述

    // 定价
    Price       float64 `gorm:"type:decimal(10,2);not null" json:"price"`
    // 售价（Credits）
    Credits     float64 `gorm:"type:decimal(20,6);not null" json:"credits"`
    // 包含的 Credits 额度

    // 有效期
    DurationUnit  string `gorm:"type:varchar(16);not null;default:'month'" json:"duration_unit"`
    // year / month / day / custom
    DurationValue int    `gorm:"not null;default:1" json:"duration_value"`
    // 有效期数量（如 duration_unit=month, duration_value=3 → 3个月）

    // 状态
    IsActive    bool    `gorm:"default:true;index" json:"is_active"`
    SortOrder   int     `gorm:"default:0" json:"sort_order"`
    // 展示排序

    // Stripe 集成（可选）
    StripePriceID *string `gorm:"type:varchar(128)" json:"stripe_price_id,omitempty"`

    // 限购
    MaxPurchasePerUser int `gorm:"default:0" json:"max_purchase_per_user"`
    // 0 = 不限

    CreatedAt   time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt   time.Time `gorm:"index;not null" json:"updated_at"`
}
```

### 3.3 `platform_entity_packages` — 实体套餐表

**职责**：用户/组织购买的套餐实例，记录归属、额度、有效期。

```go
// framework/configstore/tables/platform_entity_package.go

type TableEntityPackage struct {
    ID          string  `gorm:"type:varchar(36);primaryKey" json:"id"`
    // UUID
    PackageID   string  `gorm:"type:varchar(36);not null;index" json:"package_id"`
    // 关联 platform_packages.id

    // 归属（二选一，至少一个非空）
    UserID      *string `gorm:"type:varchar(36);index" json:"user_id,omitempty"`
    // platform user (auth_users.id)
    CustomerID  *string `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`
    // governance customer

    // 额度
    CreditsTotal    float64 `gorm:"type:decimal(20,6);not null" json:"credits_total"`
    // 套餐总额度
    CreditsUsed     float64 `gorm:"type:decimal(20,6);default:0;not null" json:"credits_used"`
    // 已使用额度（冗余，主数据在 governance_budgets.CurrentUsage）

    // 有效期
    StartedAt   time.Time `gorm:"not null;index" json:"started_at"`
    ExpiresAt   time.Time `gorm:"not null;index" json:"expires_at"`

    // 来源
    Source      string  `gorm:"type:varchar(20);not null;default:'order'" json:"source"`
    // "order" = 在线购买, "admin" = 管理员手动绑定, "redemption" = 兑换码
    OrderID     *string `gorm:"type:varchar(64)" json:"order_id,omitempty"`
    // 关联 platform_orders.id

    // 状态
    Status      string  `gorm:"type:varchar(20);not null;default:'active';index" json:"status"`
    // active / expired / cancelled / exhausted

    CreatedAt   time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt   time.Time `gorm:"index;not null" json:"updated_at"`

    // 关联
    Package     TablePlatformPackage `gorm:"foreignKey:PackageID" json:"package,omitempty"`
}
```

**复合索引**：`idx_user_active` ON (user_id, status, expires_at) — 快速查询用户活跃套餐。
**复合索引**：`idx_customer_active` ON (customer_id, status, expires_at) — 同理。

### 3.4 `platform_orders` — 订单表

**职责**：充值和套餐购买的统一订单记录。

```go
// framework/configstore/tables/platform_order.go

type TablePlatformOrder struct {
    ID              uint    `gorm:"primaryKey;autoIncrement" json:"id"`
    OrderNo         string  `gorm:"type:varchar(64);uniqueIndex;not null" json:"order_no"`
    // 订单号，前缀区分类型：
    //   "RCH-" + UUID → 充值订单
    //   "PKG-" + UUID → 套餐购买订单

    UserID          string  `gorm:"type:varchar(36);not null;index" json:"user_id"`
    // platform user (auth_users.id)

    // 订单类型
    Type            string  `gorm:"type:varchar(20);not null;index" json:"type"`
    // "recharge" 或 "package_purchase"

    // 金额
    Amount          float64 `gorm:"type:decimal(10,2);not null" json:"amount"`
    // 实付金额（USD）
    Credits         float64 `gorm:"type:decimal(20,6);default:0" json:"credits"`
    // 获得的 Credits

    // 关联
    PackageID       *string `gorm:"type:varchar(36);index" json:"package_id,omitempty"`
    // 关联 platform_packages.id（套餐购买时）
    EntityPackageID *string `gorm:"type:varchar(36);index" json:"entity_package_id,omitempty"`
    // 关联 platform_entity_packages.id（套餐购买时）
    CustomerID      *string `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`
    // 组织充值/购买时

    // 支付信息
    PaymentMethod   string  `gorm:"type:varchar(20)" json:"payment_method"`
    // stripe / redemption / admin
    PaymentID       string  `gorm:"type:varchar(200)" json:"payment_id,omitempty"`
    // 支付平台交易 ID
    PaidAt          *time.Time `json:"paid_at,omitempty"`

    // 状态
    Status          string  `gorm:"type:varchar(20);not null;default:'pending';index" json:"status"`
    // pending / success / failed / expired / cancelled

    // 支付平台原始数据（用于对账）
    ProviderPayload string  `gorm:"type:text" json:"provider_payload,omitempty"`

    CreatedAt       time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt       time.Time `gorm:"index;not null" json:"updated_at"`
}
```

### 3.5 `governance_redemptions` — 兑换码表

**职责**：管理员预生成的充值码，用户兑换后直接获得 Credits。

```go
// framework/configstore/tables/redemption.go

type TableRedemption struct {
    ID            uint    `gorm:"primaryKey;autoIncrement" json:"id"`
    Key           string  `gorm:"type:char(32);uniqueIndex;not null" json:"key"`
    // 兑换码（32位随机字符串）
    Name          string  `gorm:"type:varchar(100)" json:"name"`
    // 兑换码名称/备注

    Credits       float64 `gorm:"type:decimal(20,6);not null" json:"credits"`
    // 可兑换的 Credits 数量

    Status        int     `gorm:"not null;default:1;index" json:"status"`
    // 1=启用, 2=已使用, 3=禁用

    CreatedBy     string  `gorm:"type:varchar(36);not null" json:"created_by"`
    // 创建者 user ID
    UsedBy        *string `gorm:"type:varchar(36)" json:"used_by,omitempty"`
    // 使用者 user ID
    UsedAt        *time.Time `json:"used_at,omitempty"`

    ExpiresAt     *time.Time `gorm:"index" json:"expires_at,omitempty"`
    // 过期时间（nil=永不过期）

    CreatedAt     time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt     time.Time `gorm:"index;not null" json:"updated_at"`
}
```

### 3.6 `governance_pre_consume_records` — 预扣记录表

**职责**：API 调用时的额度预扣幂等记录，保证并发安全和可退款。借鉴 subscription-module 的 `SubscriptionPreConsumeRecord`。

```go
// framework/configstore/tables/pre_consume_record.go

type TablePreConsumeRecord struct {
    ID                 uint    `gorm:"primaryKey;autoIncrement" json:"id"`
    RequestID          string  `gorm:"type:varchar(64);uniqueIndex;not null" json:"request_id"`
    // 请求 ID，幂等键
    UserID             string  `gorm:"type:varchar(36);not null;index" json:"user_id"`
    BudgetID           uint    `gorm:"not null;index" json:"budget_id"`
    // 预扣的 Budget 记录 ID

    PreConsumedCredits float64 `gorm:"type:decimal(20,6);not null" json:"pre_consumed_credits"`
    // 预扣的 Credits 量
    SettledCredits     float64 `gorm:"type:decimal(20,6);default:0" json:"settled_credits"`
    // 结算后的实际 Credits（0=未结算）

    Status             string  `gorm:"type:varchar(20);not null;default:'pre_consumed';index" json:"status"`
    // pre_consumed / settled / refunded

    CreatedAt          time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt          time.Time `gorm:"index;not null" json:"updated_at"`
}
```

---

## 4. 表关系图

```
┌──────────────────────┐       ┌───────────────────────┐
│   platform_packages  │       │   governance_balances  │
│   (套餐商品模板)      │◄──┐   │   entity_type+entity_id│
│   id, name, price,   │   │   │   balance, total_rech. │
│   credits, duration  │   │   └───────────┬───────────┘
└──────────┬───────────┘   │               │
           │               │               │ 充值时创建/更新
           │ package_id    │               ▼
           ▼               │   ┌───────────────────────┐
┌──────────────────────┐   │   │  governance_budgets   │
│ platform_entity_     │   │   │  (扩展: UserID,       │
│ packages             │───┤   │   CustomerID,         │
│ (套餐实例)           │   │   │   PackageID)           │
│ user_id/customer_id  │   │   │                       │
│ credits_total/used   │   │   │  按量付费:             │
│ expires_at           │   │   │    UserID=X, PkgID=nil│
└──────────┬───────────┘   │   │  套餐:                │
           │               │   │    UserID=X, PkgID=ep │
           │ order_id      │   └───────────────────────┘
           ▼               │
┌──────────────────────┐   │   ┌───────────────────────┐
│  platform_orders     │   │   │ governance_pre_consume│
│  (统一订单)          │───┘   │ _records              │
│  order_no (RCH-/PKG-)│       │ request_id (幂等)     │
│  type: recharge/     │       │ budget_id, credits    │
│       package_purchase│      │ status: pre_consumed/ │
│  status: pending/    │       │   settled/refunded    │
│          success/... │       └───────────────────────┘
└──────────────────────┘
                               ┌───────────────────────┐
┌──────────────────────┐       │ governance_redemptions│
│  governance_model_   │       │ key, credits, status  │
│  pricing (已有)      │       │ used_by, expires_at   │
│  InputCostPerToken,  │       └───────────────────────┘
│  OutputCostPerToken, │
│  CacheRead/Write,    │
│  Image/Audio/Batch   │
└──────────────────────┘
```

---

## 5. 迁移策略

### 5.1 自动迁移（GORM AutoMigrate）

所有新表和字段扩展通过 GORM AutoMigrate 自动处理，无需手写 SQL 迁移脚本。

**在 `framework/configstore/tables/platform_migrate.go` 中注册**：

```go
func MigratePlatformTables(db *gorm.DB) error {
    // 现有 4 张表 ...
    
    // 新增计费相关表
    return db.AutoMigrate(
        &TableBalance{},           // 新建
        &TablePlatformPackage{},   // 新建
        &TableEntityPackage{},     // 新建
        &TablePlatformOrder{},     // 新建
        &TableRedemption{},        // 新建
        &TablePreConsumeRecord{},  // 新建
        &TableBudget{},            // 扩展（AutoMigrate 自动加列）
    )
}
```

### 5.2 向后兼容保证

| 变更类型 | 兼容性 | 说明 |
|---------|-------|------|
| 新建表 | ✅ 完全兼容 | 新表不影响现有功能 |
| Budget 新增字段 | ✅ 完全兼容 | nullable + 默认值，旧记录自动为 nil |
| 现有 Budget 逻辑 | ✅ 完全兼容 | 新字段为 nil 时，行为与之前一致 |

### 5.3 数据初始化

- 无需迁移历史数据（新功能，从零开始）
- 管理员需通过 Admin API 创建套餐商品
- 用户首次充值时自动创建 `governance_balances` 记录和按量付费 Budget

---

## 6. Credits 换算规则

### 6.1 基本单位

```
1 Credit = $0.01 (1 美分)
1 USD = 100 Credits
```

### 6.2 API 调用 Credits 计算

复用 `governance_model_pricing` 表的精确定价：

```go
func CalculateCredits(pricing *configstoreTables.TableModelPricing, inputTokens, outputTokens int) float64 {
    inputCost := float64(inputTokens) * pricing.InputCostPerToken
    outputCost := float64(outputTokens) * pricing.OutputCostPerToken
    totalUSD := inputCost + outputCost
    credits := totalUSD / 0.01  // USD → Credits
    return credits
}
```

扩展维度（后续迭代）：
- Cache read/write tokens → `CacheReadCostPerToken` / `CacheCreationCostPerToken`
- Image generation → `ImageCostPerImage`
- Audio → `AudioCostPerMinute`
- Batch → `BatchInputCostPerToken` / `BatchOutputCostPerToken`

### 6.3 充值换算

```
充值 $10 → 1,000 Credits
充值 $50 → 5,000 Credits（+10% 赠送 ≥$100）
充值 $100 → 11,000 Credits（+10% 赠送）
```

赠送规则通过 `platform_packages` 配置或 Admin 设置，不在换算公式中硬编码。
