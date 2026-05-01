# Bifrost 计费系统 — Implementation Plan

> **Goal:** 实现完整的计费系统，支持账户充值、多种套餐购买、灵活的扣费逻辑，
> 为个人用户和组织提供统一的 Credits 计费体系。

---

## 一句话需求

实现 Bifrost 的计费系统，支持账户充值（个人/组织）、多种套餐购买（Token包/调用次数包/Credits包/组织席位套餐）、灵活的扣费逻辑（套餐优先，余额兜底），为商业化运营提供基础。

---

## 设计理念：双轨制计费

### 核心思想

**底层统一用 Credits，前端展示多种套餐形式**：

- 底层：统一使用 Credits 作为计费单位，简化后端逻辑
- 前端：提供多种套餐形式（Token包、调用次数包、Credits包），满足不同用户需求
- 灵活性：用户可以选择最适合自己的套餐类型

### 为什么不完全统一为 Credits？

| 考虑因素 | 完全统一 Credits | 双轨制（推荐） |
|---------|-----------------|---------------|
| 后端复杂度 | 低 | 中 |
| 用户理解成本 | 高（"100 Credits 能调用多少次？"） | 低（"100万 Token 包"更直观） |
| 定价灵活性 | 低 | 高 |
| 竞品对标 | 困难 | 容易 |
| 运营分析 | 需要换算 | 直接统计 |

**结论**：采用双轨制，底层 Credits 统一，前端套餐多样。

---

## 子需求

### 1. 账户余额系统

**要求：**
- 个人用户有个人余额（User.Balance）
- 组织有组织余额（Customer.Balance）
- 支持为个人或组织充值
- 余额可用于购买套餐或直接扣费
- 记录累计充值和累计消费

### 2. 充值功能

**要求：**
- 支持多种支付方式（支付宝、微信支付、银行卡等）
- 充值到个人账户或组织账户
- 生成支付订单，支持异步回调
- 充值记录可查询

### 3. 套餐系统

**套餐类型：**
- **Token 包**：按 Token 数量售卖（如 100万 Token）
- **调用次数包**：按调用次数售卖（如 1000 次调用）
- **Credits 包**：按 Credits 售卖（如 500 Credits）
- **组织席位套餐**：按席位数售卖，团队共享额度

**套餐特性：**
- 购买后自动生效
- 有效期限制（如 30天）
- 支持叠加购买
- 优先使用快过期的套餐

### 4. 扣费逻辑

**要求：**
- 扣费优先级：套餐额度 > 账户余额
- 支持配置 VK 的扣费来源（auto/user_balance/customer_balance/package）
- 多种套餐类型并存时的扣费策略
- 扣费记录详细可查

### 5. 组织席位管理

**要求：**
- 组织可以购买席位套餐
- 席位数限制组织成员数量
- 席位费用按月/年计算
- 支持动态调整席位数

---

## 1. Credits 换算规则

### 1.1 模型定价配置

```go
// plugins/governance/pricing.go

type ModelPrice struct {
    InputTokenPrice  float64  // 每 1K 输入 Token 价格（美元）
    OutputTokenPrice float64  // 每 1K 输出 Token 价格（美元）
    CreditsPerCall   float64  // 每次调用基础 Credits
}

var ModelPricing = map[string]ModelPrice{
    "gpt-4": {
        InputTokenPrice:  0.03,
        OutputTokenPrice: 0.06,
        CreditsPerCall:   10,
    },
    "gpt-4-turbo": {
        InputTokenPrice:  0.01,
        OutputTokenPrice: 0.03,
        CreditsPerCall:   5,
    },
    "gpt-3.5-turbo": {
        InputTokenPrice:  0.0015,
        OutputTokenPrice: 0.002,
        CreditsPerCall:   1,
    },
    "claude-3-opus": {
        InputTokenPrice:  0.015,
        OutputTokenPrice: 0.075,
        CreditsPerCall:   8,
    },
    "claude-3-sonnet": {
        InputTokenPrice:  0.003,
        OutputTokenPrice: 0.015,
        CreditsPerCall:   3,
    },
}
```

### 1.2 Credits 计算函数

```go
// CalculateCredits 计算本次调用需要的 Credits
func CalculateCredits(model string, inputTokens, outputTokens int) float64 {
    price, exists := ModelPricing[model]
    if !exists {
        // 默认价格
        price = ModelPricing["gpt-3.5-turbo"]
    }
    
    // 方式1: 按 Token 计算
    tokenCredits := (float64(inputTokens) * price.InputTokenPrice + 
                     float64(outputTokens) * price.OutputTokenPrice) / 1000
    
    // 方式2: 按次计算
    callCredits := price.CreditsPerCall
    
    // 取较高值（确保最低收费）
    return math.Max(tokenCredits, callCredits)
}

// CreditsToUSD Credits 转美元
func CreditsToUSD(credits float64) float64 {
    // 1 Credit = $0.01（可配置）
    return credits * 0.01
}

// USDToCredits 美元转 Credits
func USDToCredits(usd float64) float64 {
    return usd / 0.01
}
```

---

## 2. 数据模型设计

### 2.1 套餐表 (Package)

```go
// framework/configstore/tables/package.go

type TablePackage struct {
    ID            uint      `gorm:"primaryKey;autoIncrement" json:"id"`
    Name          string    `gorm:"type:varchar(100);not null" json:"name"`
    Description   string    `gorm:"type:text" json:"description,omitempty"`
    Type          string    `gorm:"type:varchar(20);not null;index" json:"type"`
    // 类型: token_pack, call_pack, credits_pack, team_seat_pack
    
    Price         float64   `gorm:"type:decimal(10,2);not null" json:"price"`
    
    // 套餐内容
    Credits       float64   `gorm:"type:decimal(20,6);default:0" json:"credits"`
    TokenAmount   int64     `gorm:"default:0" json:"token_amount"`
    CallAmount    int       `gorm:"default:0" json:"call_amount"`
    
    // 团队套餐专用
    IsTeamPack    bool      `gorm:"default:false" json:"is_team_pack"`
    SeatPrice     float64   `gorm:"type:decimal(10,2);default:0" json:"seat_price"`
    MaxSeats      int       `gorm:"default:0" json:"max_seats"`
    
    // 有效期
    DurationDays  int       `gorm:"default:30" json:"duration_days"`
    
    // 状态
    IsActive      bool      `gorm:"default:true;index" json:"is_active"`
    SortOrder     int       `gorm:"default:0" json:"sort_order"`
    
    CreatedAt     time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt     time.Time `gorm:"index;not null" json:"updated_at"`
}
```

### 2.2 用户套餐表 (UserPackage)

```go
// framework/configstore/tables/user_package.go

type TableUserPackage struct {
    ID              uint      `gorm:"primaryKey;autoIncrement" json:"id"`
    UserID          uint      `gorm:"index;not null" json:"user_id"`
    PackageID       uint      `gorm:"not null" json:"package_id"`
    
    // 归属（可选）
    CustomerID      *string   `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`
    TeamID          *string   `gorm:"type:varchar(255);index" json:"team_id,omitempty"`
    
    // 剩余额度
    RemainingCredits  float64 `gorm:"type:decimal(20,6);default:0" json:"remaining_credits"`
    RemainingTokens   int64   `gorm:"default:0" json:"remaining_tokens"`
    RemainingCalls    int     `gorm:"default:0" json:"remaining_calls"`
    
    // 席位信息（团队套餐专用）
    Seats           int       `gorm:"default:0" json:"seats"`
    
    // 有效期
    ExpiresAt       time.Time `gorm:"index;not null" json:"expires_at"`
    
    // 状态
    Status          string    `gorm:"type:varchar(20);default:'active'" json:"status"`
    // 状态: active, expired, exhausted
    
    CreatedAt       time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt       time.Time `gorm:"index;not null" json:"updated_at"`
    
    // 关联
    Package         TablePackage `gorm:"foreignKey:PackageID" json:"package,omitempty"`
    User            TableUser    `gorm:"foreignKey:UserID" json:"user,omitempty"`
}
```

### 2.3 订单表 (Order)

```go
// framework/configstore/tables/order.go

type TableOrder struct {
    ID              uint      `gorm:"primaryKey;autoIncrement" json:"id"`
    OrderNo         string    `gorm:"type:varchar(64);uniqueIndex;not null" json:"order_no"`
    UserID          uint      `gorm:"index;not null" json:"user_id"`
    
    // 订单类型
    Type            string    `gorm:"type:varchar(20);not null;index" json:"type"`
    // 类型: recharge, package_purchase
    
    // 金额
    Amount          float64   `gorm:"type:decimal(10,2);not null" json:"amount"`
    Credits         float64   `gorm:"type:decimal(20,6);default:0" json:"credits"`
    
    // 关联
    PackageID       *uint     `gorm:"index" json:"package_id,omitempty"`
    CustomerID      *string   `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`
    
    // 支付信息
    PaymentMethod   string    `gorm:"type:varchar(20)" json:"payment_method"`
    // 支付方式: alipay, wechat, bank_transfer, balance
    
    // 状态
    Status          string    `gorm:"type:varchar(20);default:'pending';index" json:"status"`
    // 状态: pending, paid, failed, refunded, cancelled
    
    // 支付平台信息
    PaymentID       string    `gorm:"type:varchar(100)" json:"payment_id,omitempty"`
    PaidAt          *time.Time `json:"paid_at,omitempty"`
    
    // 备注
    Remark          string    `gorm:"type:text" json:"remark,omitempty"`
    
    CreatedAt       time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt       time.Time `gorm:"index;not null" json:"updated_at"`
    
    // 关联
    Package         *TablePackage `gorm:"foreignKey:PackageID" json:"package,omitempty"`
    User            TableUser     `gorm:"foreignKey:UserID" json:"user,omitempty"`
}
```

### 2.4 使用记录表 (UsageRecord)

```go
// framework/configstore/tables/usage_record.go

type TableUsageRecord struct {
    ID              uint      `gorm:"primaryKey;autoIncrement" json:"id"`
    UserID          uint      `gorm:"index;not null" json:"user_id"`
    VirtualKeyID    string    `gorm:"type:varchar(255);index;not null" json:"virtual_key_id"`
    
    // 模型信息
    Model           string    `gorm:"type:varchar(100);not null;index" json:"model"`
    Provider        string    `gorm:"type:varchar(50);not null" json:"provider"`
    
    // 用量
    InputTokens     int       `gorm:"not null" json:"input_tokens"`
    OutputTokens    int       `gorm:"not null" json:"output_tokens"`
    TotalTokens     int       `gorm:"not null" json:"total_tokens"`
    
    // 费用
    Credits         float64   `gorm:"type:decimal(20,6);not null" json:"credits"`
    USDAmount       float64   `gorm:"type:decimal(10,6);not null" json:"usd_amount"`
    
    // 扣费来源
    DeductSource    string    `gorm:"type:varchar(20);not null" json:"deduct_source"`
    // 来源: package, user_balance, customer_balance
    
    PackageID       *uint     `gorm:"index" json:"package_id,omitempty"`
    CustomerID      *string   `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`
    
    // 请求信息
    RequestID       string    `gorm:"type:varchar(100)" json:"request_id,omitempty"`
    IsStreaming     bool      `gorm:"default:false" json:"is_streaming"`
    
    // 状态
    Status          string    `gorm:"type:varchar(20);default:'success'" json:"status"`
    ErrorMessage    string    `gorm:"type:text" json:"error_message,omitempty"`
    
    CreatedAt       time.Time `gorm:"index;not null" json:"created_at"`
}
```

### 2.5 用户表扩展

```go
// 在现有 TableUser 中添加字段

type TableUser struct {
    // ... 现有字段 ...
    
    // 账户余额
    Balance           float64 `gorm:"type:decimal(20,6);default:0" json:"balance"`
    TotalRecharge     float64 `gorm:"type:decimal(20,6);default:0" json:"total_recharge"`
    TotalConsumption  float64 `gorm:"type:decimal(20,6);default:0" json:"total_consumption"`
}
```

### 2.6 Customer 表扩展

```go
// 在现有 TableCustomer 中添加字段

type TableCustomer struct {
    // ... 现有字段 ...
    
    // 组织余额
    Balance           float64 `gorm:"type:decimal(20,6);default:0" json:"balance"`
    TotalRecharge     float64 `gorm:"type:decimal(20,6);default:0" json:"total_recharge"`
    TotalConsumption  float64 `gorm:"type:decimal(20,6);default:0" json:"total_consumption"`
    
    // 席位信息
    MaxSeats          int     `gorm:"default:0" json:"max_seats"`
    UsedSeats         int     `gorm:"default:0" json:"used_seats"`
}
```

### 2.7 VK 表扩展

```go
// 在现有 TableVirtualKey 中添加字段

type TableVirtualKey struct {
    // ... 现有字段 ...
    
    // 扣费配置
    DeductFrom    string  `gorm:"type:varchar(20);default:'auto'" json:"deduct_from"`
    // 扣费来源: auto, user_balance, customer_balance, package
    
    Priority      int     `gorm:"default:0" json:"priority"`
    // 扣费优先级（同一用户多个 VK 时）
    
    PackageID     *uint   `gorm:"index" json:"package_id,omitempty"`
    // 指定使用的套餐（仅 deduct_from=package 时生效）
}
```

---

## 3. API 设计

### 3.1 套餐管理 API（管理员）

```
POST   /api/admin/packages                    — 创建套餐
GET    /api/admin/packages                    — 列出所有套餐
GET    /api/admin/packages/{id}               — 获取套餐详情
PUT    /api/admin/packages/{id}               — 更新套餐
DELETE /api/admin/packages/{id}               — 删除套餐
PUT    /api/admin/packages/{id}/status        — 启用/禁用套餐
```

### 3.2 套餐展示 API（用户）

```
GET    /api/packages                          — 列出可用套餐（公开）
GET    /api/packages/{id}                     — 获取套餐详情（公开）
GET    /api/user/packages                     — 我的套餐列表
GET    /api/user/packages/{id}                — 我的套餐详情
```

### 3.3 充值 API

```
POST   /api/recharge                          — 创建充值订单
GET    /api/recharge/orders                   — 我的充值记录
GET    /api/recharge/orders/{id}              — 充值订单详情

# 支付回调（内部使用）
POST   /api/payment/callback/alipay           — 支付宝回调
POST   /api/payment/callback/wechat           — 微信支付回调
```

### 3.4 套餐购买 API

```
POST   /api/package/purchase                  — 购买套餐
GET    /api/package/orders                    — 我的购买记录
GET    /api/package/orders/{id}               — 购买订单详情
```

### 3.5 账户信息 API

```
GET    /api/user/balance                      — 查询个人余额
GET    /api/user/consumption                  — 查询个人消费统计
GET    /api/customer/{id}/balance             — 查询组织余额（需要权限）
GET    /api/customer/{id}/consumption         — 查询组织消费统计（需要权限）
```

### 3.6 使用记录 API

```
GET    /api/user/usage                        — 个人使用记录
GET    /api/user/usage/stats                  — 个人使用统计
GET    /api/customer/{id}/usage               — 组织使用记录（需要权限）
GET    /api/customer/{id}/usage/stats         — 组织使用统计（需要权限）
```

---

## 4. 扣费逻辑设计

### 4.1 扣费流程

```
请求到达
    │
    ▼
检查 VK 配置的 DeductFrom
    │
    ├─ auto (默认)
    │   │
    │   ▼
    │   1. 查找用户可用套餐（按过期时间排序，优先用快过期的）
    │   │
    │   ├─ 有可用套餐 → 扣套餐额度
    │   │   │
    │   │   ├─ Token包 → 扣 Token（换算为 Credits）
    │   │   ├─ 调用包 → 扣调用次数
    │   │   └─ Credits包 → 扣 Credits
    │   │
    │   └─ 无可用套餐 → 扣账户余额
    │       │
    │       ├─ VK 在 Customer → 扣 Customer.Balance
    │       └─ VK 不在 Customer → 扣 User.Balance
    │
    ├─ user_balance → 直接扣 User.Balance
    ├─ customer_balance → 直接扣 Customer.Balance
    └─ package → 直接扣指定套餐
```

### 4.2 扣费实现

```go
// plugins/governance/deduction.go

type DeductionResult struct {
    Source        string  // "package", "user_balance", "customer_balance"
    PackageID     uint    // 如果从套餐扣除
    CreditsUsed   float64 // 实际扣除的 Credits
    TokensUsed    int64   // 实际扣除的 Token
    CallsUsed     int     // 实际扣除的调用次数
}

// DeductUsage 扣除使用量
func (r *BudgetResolver) DeductUsage(
    vk *TableVirtualKey, 
    userID uint,
    model string,
    inputTokens, outputTokens int,
) (*DeductionResult, error) {
    
    // 计算本次调用的 Credits
    creditsNeeded := CalculateCredits(model, inputTokens, outputTokens)
    totalTokens := int64(inputTokens + outputTokens)
    
    // 根据 VK 配置决定扣费来源
    switch vk.DeductFrom {
    case "user_balance":
        return r.deductFromUserBalance(userID, creditsNeeded)
        
    case "customer_balance":
        if vk.CustomerID == nil {
            return nil, fmt.Errorf("VK not in customer")
        }
        return r.deductFromCustomerBalance(*vk.CustomerID, creditsNeeded)
        
    case "package":
        if vk.PackageID == nil {
            return nil, fmt.Errorf("no package configured")
        }
        return r.deductFromPackage(*vk.PackageID, creditsNeeded, totalTokens, 1)
        
    case "auto":
    default:
        return r.autoDeduct(vk, userID, creditsNeeded, totalTokens, 1)
    }
}

// autoDeduct 自动扣费（套餐优先，余额兜底）
func (r *BudgetResolver) autoDeduct(
    vk *TableVirtualKey,
    userID uint,
    creditsNeeded float64,
    tokens int64,
    calls int,
) (*DeductionResult, error) {
    
    // 1. 查找用户可用套餐
    packages := r.getUserAvailablePackages(userID, vk.CustomerID, vk.TeamID)
    
    for _, pkg := range packages {
        // 优先使用 Credits
        if pkg.RemainingCredits >= creditsNeeded {
            return r.deductFromPackage(pkg.ID, creditsNeeded, tokens, calls)
        }
        
        // 尝试使用 Token
        if pkg.RemainingTokens >= tokens {
            return r.deductFromPackage(pkg.ID, creditsNeeded, tokens, calls)
        }
        
        // 尝试使用调用次数
        if pkg.RemainingCalls >= calls {
            return r.deductFromPackage(pkg.ID, creditsNeeded, tokens, calls)
        }
    }
    
    // 2. 无可用套餐，从余额扣除
    if vk.CustomerID != nil {
        return r.deductFromCustomerBalance(*vk.CustomerID, creditsNeeded)
    }
    return r.deductFromUserBalance(userID, creditsNeeded)
}

// deductFromPackage 从套餐扣除
func (r *BudgetResolver) deductFromPackage(
    packageID uint, 
    credits float64, 
    tokens int64, 
    calls int,
) (*DeductionResult, error) {
    
    var userPkg TableUserPackage
    if err := r.db.First(&userPkg, packageID).Error; err != nil {
        return nil, err
    }
    
    // 扣除 Credits
    if userPkg.RemainingCredits >= credits {
        userPkg.RemainingCredits -= credits
        r.db.Save(&userPkg)
        return &DeductionResult{
            Source:      "package",
            PackageID:   packageID,
            CreditsUsed: credits,
        }, nil
    }
    
    // 扣除 Token
    if userPkg.RemainingTokens >= tokens {
        userPkg.RemainingTokens -= tokens
        r.db.Save(&userPkg)
        return &DeductionResult{
            Source:      "package",
            PackageID:   packageID,
            TokensUsed:  tokens,
        }, nil
    }
    
    // 扣除调用次数
    if userPkg.RemainingCalls >= calls {
        userPkg.RemainingCalls -= calls
        r.db.Save(&userPkg)
        return &DeductionResult{
            Source:    "package",
            PackageID: packageID,
            CallsUsed: calls,
        }, nil
    }
    
    return nil, fmt.Errorf("package %d has insufficient balance", packageID)
}

// deductFromUserBalance 从用户余额扣除
func (r *BudgetResolver) deductFromUserBalance(
    userID uint, 
    credits float64,
) (*DeductionResult, error) {
    
    var user TableUser
    if err := r.db.First(&user, userID).Error; err != nil {
        return nil, err
    }
    
    if user.Balance < credits {
        return nil, fmt.Errorf("insufficient user balance")
    }
    
    user.Balance -= credits
    user.TotalConsumption += credits
    r.db.Save(&user)
    
    return &DeductionResult{
        Source:      "user_balance",
        CreditsUsed: credits,
    }, nil
}

// deductFromCustomerBalance 从组织余额扣除
func (r *BudgetResolver) deductFromCustomerBalance(
    customerID string, 
    credits float64,
) (*DeductionResult, error) {
    
    var customer TableCustomer
    if err := r.db.Where("id = ?", customerID).First(&customer).Error; err != nil {
        return nil, err
    }
    
    if customer.Balance < credits {
        return nil, fmt.Errorf("insufficient customer balance")
    }
    
    customer.Balance -= credits
    customer.TotalConsumption += credits
    r.db.Save(&customer)
    
    return &DeductionResult{
        Source:        "customer_balance",
        CreditsUsed:   credits,
    }, nil
}
```

---

## 5. 充值和购买流程

### 5.1 充值流程

```go
// handlers/billing.go

// createRechargeOrder 创建充值订单
func (h *BillingHandler) createRechargeOrder(ctx *fasthttp.RequestCtx) {
    var req struct {
        Amount        float64 `json:"amount"`
        PaymentMethod string  `json:"payment_method"`
        CustomerID    *string `json:"customer_id,omitempty"`
    }
    
    // 参数验证
    if req.Amount <= 0 {
        SendError(ctx, fasthttp.StatusBadRequest, "Amount must be positive")
        return
    }
    
    // 创建订单
    order := &TableOrder{
        OrderNo:       generateOrderNo(),
        UserID:        getUserID(ctx),
        Type:          "recharge",
        Amount:        req.Amount,
        Credits:       USDToCredits(req.Amount),
        CustomerID:    req.CustomerID,
        PaymentMethod: req.PaymentMethod,
        Status:        "pending",
    }
    h.db.Create(order)
    
    // 调用支付接口
    payURL, err := h.paymentService.CreatePayment(order)
    if err != nil {
        SendError(ctx, fasthttp.StatusInternalServerError, "Failed to create payment")
        return
    }
    
    SendJSON(ctx, map[string]interface{}{
        "order_id": order.ID,
        "order_no": order.OrderNo,
        "pay_url":  payURL,
    })
}

// handlePaymentCallback 处理支付回调
func (h *BillingHandler) handlePaymentCallback(ctx *fasthttp.RequestCtx) {
    // 1. 验证支付签名
    paymentResult, err := h.paymentService.VerifyCallback(ctx)
    if err != nil {
        SendError(ctx, fasthttp.StatusBadRequest, "Invalid callback")
        return
    }
    
    // 2. 查找订单
    var order TableOrder
    if err := h.db.Where("order_no = ?", paymentResult.OrderNo).First(&order).Error; err != nil {
        SendError(ctx, fasthttp.StatusNotFound, "Order not found")
        return
    }
    
    // 3. 检查订单状态
    if order.Status != "pending" {
        SendJSON(ctx, map[string]string{"status": "already_processed"})
        return
    }
    
    // 4. 更新订单状态
    now := time.Now()
    order.Status = "paid"
    order.PaymentID = paymentResult.PaymentID
    order.PaidAt = &now
    h.db.Save(&order)
    
    // 5. 增加账户余额
    if order.CustomerID != nil {
        h.db.Model(&TableCustomer{}).
            Where("id = ?", *order.CustomerID).
            Updates(map[string]interface{}{
                "balance":        gorm.Expr("balance + ?", order.Credits),
                "total_recharge": gorm.Expr("total_recharge + ?", order.Credits),
            })
    } else {
        h.db.Model(&TableUser{}).
            Where("id = ?", order.UserID).
            Updates(map[string]interface{}{
                "balance":        gorm.Expr("balance + ?", order.Credits),
                "total_recharge": gorm.Expr("total_recharge + ?", order.Credits),
            })
    }
    
    SendJSON(ctx, map[string]string{"status": "success"})
}
```

### 5.2 套餐购买流程

```go
// purchasePackage 购买套餐
func (h *BillingHandler) purchasePackage(ctx *fasthttp.RequestCtx) {
    var req struct {
        PackageID  uint    `json:"package_id"`
        Quantity   int     `json:"quantity"`
        Seats      int     `json:"seats,omitempty"`
        CustomerID *string `json:"customer_id,omitempty"`
    }
    
    userID := getUserID(ctx)
    
    // 1. 获取套餐信息
    var pkg TablePackage
    if err := h.db.First(&pkg, req.PackageID).Error; err != nil {
        SendError(ctx, fasthttp.StatusNotFound, "Package not found")
        return
    }
    
    // 2. 计算价格
    totalPrice := pkg.Price * float64(req.Quantity)
    if pkg.IsTeamPack {
        totalPrice += pkg.SeatPrice * float64(req.Seats) * float64(req.Quantity)
    }
    
    // 3. 检查余额
    var balance float64
    if req.CustomerID != nil {
        var customer TableCustomer
        h.db.Where("id = ?", *req.CustomerID).First(&customer)
        balance = customer.Balance
    } else {
        var user TableUser
        h.db.First(&user, userID)
        balance = user.Balance
    }
    
    if balance < totalPrice {
        SendError(ctx, fasthttp.StatusBadRequest, "Insufficient balance")
        return
    }
    
    // 4. 扣除余额
    if req.CustomerID != nil {
        h.db.Model(&TableCustomer{}).
            Where("id = ?", *req.CustomerID).
            Update("balance", gorm.Expr("balance - ?", totalPrice))
    } else {
        h.db.Model(&TableUser{}).
            Where("id = ?", userID).
            Update("balance", gorm.Expr("balance - ?", totalPrice))
    }
    
    // 5. 创建用户套餐
    userPkg := &TableUserPackage{
        UserID:          userID,
        PackageID:       pkg.ID,
        CustomerID:      req.CustomerID,
        RemainingCredits: pkg.Credits * float64(req.Quantity),
        RemainingTokens:  int64(pkg.TokenAmount) * int64(req.Quantity),
        RemainingCalls:   pkg.CallAmount * req.Quantity,
        Seats:           req.Seats,
        ExpiresAt:       time.Now().AddDate(0, 0, pkg.DurationDays),
        Status:          "active",
    }
    h.db.Create(userPkg)
    
    // 6. 创建订单记录
    order := &TableOrder{
        OrderNo:       generateOrderNo(),
        UserID:        userID,
        Type:          "package_purchase",
        Amount:        totalPrice,
        Credits:       pkg.Credits * float64(req.Quantity),
        PackageID:     &pkg.ID,
        CustomerID:    req.CustomerID,
        PaymentMethod: "balance",
        Status:        "paid",
        PaidAt:        &time.Time{},
    }
    h.db.Create(order)
    
    SendJSON(ctx, map[string]interface{}{
        "order_id":      order.ID,
        "user_package":  userPkg,
    })
}
```

---

## 6. 套餐设计建议

### 6.1 个人套餐

| 套餐 | 价格 | 内容 | 有效期 | 适用场景 |
|------|------|------|--------|---------|
| 体验包 | ¥9.9 | 100 Credits | 7天 | 新用户体验 |
| 基础包 | ¥49 | 500 Credits | 30天 | 个人开发者 |
| 标准包 | ¥199 | 2500 Credits | 30天 | 活跃用户 |
| 高级包 | ¥699 | 10000 Credits | 30天 | 重度用户 |
| Token包 | ¥99 | 100万 Token | 30天 | Token 敏感用户 |
| 调用包 | ¥49 | 1000 次调用 | 30天 | 调用次数敏感用户 |

### 6.2 组织套餐

| 套餐 | 价格 | 内容 | 席位费 | 适用场景 |
|------|------|------|--------|---------|
| 团队基础版 | ¥499/月 | 5000 Credits + 5席位 | ¥50/席位/月 | 小团队 |
| 团队专业版 | ¥1999/月 | 25000 Credits + 20席位 | ¥40/席位/月 | 中型团队 |
| 企业定制版 | 联系销售 | 定制额度 + 无限席位 | 协商 | 大型企业 |

---

## 7. 实施阶段

### Phase 1: 数据模型 + 基础 API（5天）

**目标**：实现数据模型和基础 CRUD API

1. **数据库扩展**
   - 新增表：Package、UserPackage、Order、UsageRecord
   - 扩展表：User、Customer、VirtualKey 添加新字段
   - 数据库迁移脚本

2. **套餐管理 API**
   - 管理员：套餐 CRUD
   - 用户：套餐列表和详情

3. **账户信息 API**
   - 余额查询
   - 消费统计

### Phase 2: 充值功能（4天）

**目标**：实现充值流程和支付集成

1. **充值订单创建**
   - 创建充值订单
   - 生成订单号

2. **支付集成**
   - 支付宝支付接口
   - 微信支付接口
   - 支付回调处理

3. **余额更新**
   - 充值成功后更新余额
   - 充值记录查询

### Phase 3: 套餐购买（3天）

**目标**：实现套餐购买流程

1. **套餐购买 API**
   - 余额检查
   - 扣除余额
   - 创建用户套餐

2. **套餐管理**
   - 我的套餐列表
   - 套餐使用情况

### Phase 4: 扣费逻辑（4天）

**目标**：实现灵活的扣费逻辑

1. **扣费引擎**
   - 自动扣费逻辑（套餐优先，余额兜底）
   - 多种套餐类型支持
   - VK 扣费配置

2. **使用记录**
   - 记录每次调用的使用量
   - 扣费来源记录

3. **统计分析**
   - 使用量统计
   - 费用分析

### Phase 5: 组织席位（3天）

**目标**：实现组织席位管理

1. **席位套餐**
   - 席位购买
   - 席位数限制

2. **成员管理**
   - 席位数检查
   - 成员加入/退出

### Phase 6: 前端集成（5天）

**目标**：完整的前端界面

1. **充值页面**
   - 充值入口
   - 支付方式选择
   - 充值记录

2. **套餐页面**
   - 套餐列表
   - 套餐购买
   - 我的套餐

3. **账户页面**
   - 余额显示
   - 消费统计
   - 使用记录

4. **管理员页面**
   - 套餐管理
   - 订单管理
   - 财务报表

---

## 8. 文件变更清单

| 文件 | 操作 | 描述 |
|------|------|------|
| `framework/configstore/tables/package.go` | 新建 | 套餐表 |
| `framework/configstore/tables/user_package.go` | 新建 | 用户套餐表 |
| `framework/configstore/tables/order.go` | 新建 | 订单表 |
| `framework/configstore/tables/usage_record.go` | 新建 | 使用记录表 |
| `framework/configstore/tables/user.go` | 修改 | 添加余额字段 |
| `framework/configstore/tables/customer.go` | 修改 | 添加余额和席位字段 |
| `framework/configstore/tables/virtualkey.go` | 修改 | 添加扣费配置字段 |
| `framework/configstore/migrations.go` | 修改 | 添加新表迁移 |
| `plugins/governance/pricing.go` | 新建 | Credits 换算逻辑 |
| `plugins/governance/deduction.go` | 新建 | 扣费引擎 |
| `plugins/governance/resolver.go` | 修改 | 集成扣费逻辑 |
| `handlers/billing.go` | 修改 | 充值和套餐购买 API |
| `handlers/package.go` | 新建 | 套餐管理 API |
| `handlers/usage.go` | 新建 | 使用记录 API |
| `server/server.go` | 修改 | 注册新路由 |
| `ui/app/workspace/billing/` | 新建 | 计费相关页面 |
| `ui/app/workspace/packages/` | 新建 | 套餐相关页面 |

---

## 9. 向后兼容性

1. **数据库**：所有新增字段 nullable，现有数据无需迁移
2. **API**：现有 API 保持不变，新 API 只新增
3. **VK 扣费**：默认 deduct_from="auto"，行为与现有逻辑兼容
4. **余额**：现有用户/组织余额默认为 0

---

## 10. 验证清单

### 充值功能
- [ ] 充值订单创建成功
- [ ] 支付回调正确处理
- [ ] 充值后余额正确增加
- [ ] 充值记录可查询

### 套餐功能
- [ ] 套餐列表正确展示
- [ ] 套餐购买成功
- [ ] 购买后套餐正确生效
- [ ] 套餐过期正确处理

### 扣费逻辑
- [ ] 自动扣费优先使用套餐
- [ ] 套餐用完后使用余额
- [ ] 扣费记录正确
- [ ] VK 扣费配置生效

### 组织席位
- [ ] 席位购买成功
- [ ] 席位数限制生效
- [ ] 成员管理正确

### 边界测试
- [ ] 余额不足时购买失败
- [ ] 套餐过期后不能使用
- [ ] 并发扣费正确处理
- [ ] 退款流程正确

---

## 11. 总估算

| 阶段 | 工作量 | 说明 |
|------|--------|------|
| Phase 1 | 5天 | 数据模型 + 基础 API |
| Phase 2 | 4天 | 充值功能 |
| Phase 3 | 3天 | 套餐购买 |
| Phase 4 | 4天 | 扣费逻辑 |
| Phase 5 | 3天 | 组织席位 |
| Phase 6 | 5天 | 前端集成 |
| **总计** | **24天** | 约 5 周 |

---

## 12. 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 支付接口对接复杂 | 高 | 预留充足时间，使用成熟 SDK |
| 并发扣费竞态条件 | 高 | 使用数据库事务和乐观锁 |
| 套餐过期处理 | 中 | 定时任务检查，异步处理 |
| 退款流程复杂 | 中 | 预留退款接口，人工审核 |
| 财务对账困难 | 中 | 详细记录，定期对账 |
