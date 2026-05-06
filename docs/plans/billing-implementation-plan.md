# Bifrost 计费系统 — 开发计划

> Epic/Story 拆分，4 个迭代，每个 Story 可由 LLM 在单次上下文窗口内完成。

---

## 迭代总览

| 迭代 | 主题 | 交付价值 | 预计 Story 数 |
|---|---|---|---|
| I | 双轨基础 + 手动充值 | 内部可充值、扣费、admin 手动操作，零支付依赖 | 10 |
| II | 套餐体系 | 支持套餐商品管理 + 购买（admin 手动标记支付） | 8 |
| III | Stripe 集成 | 真实在线支付 + Webhook 回调 | 5 |
| IV | 前端 UI | 用户自助充值/购买/查看订单 | 6 |

每个迭代结束时系统可独立运行、端到端可测。

---

## 迭代 I：双轨基础 + 手动充值

> 目标：governance 零改动，billing Budget 可创建/检查/扣费，admin 可手动充值。

### Epic I-A：Table 变更 + BudgetType 双轨

**Story I-A-1：TableBudget 新增字段 + BeforeSave 校验**

- 文件：`framework/configstore/tables/budget.go`
- 新增字段：`Type`(BudgetType, default "governance"), `UserID`, `CustomerID`, `UserScopeTeamID`, `UserScopeCustomerID`, `ExpiresAt`, `OffPeakDiscount`
- 更新 `BeforeSave`：五选一 owner 校验、billing 不挂 VK/PC、User scope 互斥、ResetDuration>=0
- 验证：现有测试不 break（Type 默认 governance）、新字段全部 nullable

**Story I-A-2：TableUser 新实体**

- 新文件：`framework/configstore/tables/user.go`
- 表名 `governance_users`，字段：ID, Name, Budgets(has-many), RateLimit(has-one), CreatedAt, UpdatedAt
- AutoMigrate 注册
- 验证：建表成功、CRUD 可用

**Story I-A-3：TableCustomer 改多 Budget**

- 文件：`framework/configstore/tables/customer.go`
- `BudgetID *string` → `Budgets []TableBudget`（has-many, foreignKey=CustomerID）
- 更新 GovernanceStore 中引用 `Customer.BudgetID` 的地方改为遍历 `Customer.Budgets`
- 更新 `collectBudgetsFromHierarchy` 中 Customer 部分收集逻辑
- 验证：现有治理测试不 break

**Story I-A-4：collectBudgetsFromHierarchy 按 Type 过滤**

- 文件：`plugins/governance/store.go` 或 `resolver.go`
- 收集函数返回全部 Budget 后，按 Type 分流
- 新增 `filterBudgetsByType(budgets, budgetType)` 工具函数
- 治理路径只取 governance Budget（现有行为不变）
- 计费路径预留取 billing Budget 的调用点
- 验证：现有治理测试不 break

### Epic I-B：BudgetChecker 接口 + BillingBudgetChecker

**Story I-B-1：BudgetChecker 接口定义 + GovernanceBudgetChecker 提取**

- 新文件：`plugins/governance/checker.go`
- 定义 `BudgetChecker` 接口（Check + Deduct）
- 把现有 governance Budget 检查/扣费逻辑提取为 `GovernanceBudgetChecker`，实现该接口
- 更新 PreHook/PostHook 调用点：按 type 选 checker
- 验证：现有治理测试不 break（行为不变，只是重构）

**Story I-B-2：BillingBudgetChecker — Check 算法**

- 文件：`plugins/governance/checker.go`（追加）
- 实现 `BillingBudgetChecker.Check`：
  - 过滤已失效 Budget（ExpiresAt 检查）
  - 排序：套餐型优先、短周期优先、少余额优先、快过期优先
  - 总可用额 > 0 → Allow
- 验证：单元测试覆盖排序规则 + 过期跳过

**Story I-B-3：BillingBudgetChecker — Deduct 算法（含 OffPeakDiscount）**

- 文件：`plugins/governance/checker.go`（追加）
- 实现 `BillingBudgetChecker.Deduct`：
  - 排序后逐 Budget 扣费
  - OffPeakDiscount 折扣计算（adjustedCost = remaining * discount）
  - 不足时 remaining 还原原价交给下一个 Budget
  - 零透支：remaining > 0 返回 error
- 实现 `evaluateOffPeak(discountJSON, time.Time) float64`
- 验证：单元测试覆盖文档中的推演场景（单折扣、双折扣不同系数、余额兜底）

**Story I-B-4：计费路径集成 — PreHook/PostHook 走 BillingBudgetChecker**

- 文件：`plugins/governance/main.go`, `resolver.go`
- 判断 TableUser 是否存在 → 计费模式 vs 治理模式
- 计费模式：个人 VK → User billing Budget；组织 VK → Team → Customer
- 治理模式：现有行为不变
- 两套 checker 并行运行：先治理 AND 检查，再计费 OR 检查
- 验证：集成测试覆盖个人 VK + 组织 VK 场景

**Story I-B-5：修复 ResetDuration="0" Bug**

- 文件：`plugins/governance/store.go`（BumpBudgetUsage + CheckBudget）
- 加 `&& duration > 0` 保护
- 验证：余额型 Budget 的 CurrentUsage 不再被误清零

**Story I-B-6：RateLimit治理增加User层级**

- 文件：`plugins/governance/store.go` 或 `resolver.go`
- `collectRateLimitsFromHierarchy` 在 VK 之后、Team 之前插入 User 层级收集
- `CheckUserRateLimit` 从 no-op 改为实际检查
- `UpdateUserRateLimitUsageInMemory` 增加 User 层级用量更新
- 验证：现有治理测试不 break


### Epic I-C：Payment 模块骨架 + 手动充值

**Story I-C-1：plugins/payment/ 模块初始化 + PaymentGateway 接口 + ManualGateway**

- 新建 `plugins/payment/` 目录 + `go.mod`
- `gateway.go`：PaymentGateway 接口 + Options/Result 类型
- `manual.go`：ManualGateway 实现（CreatePayment 直接返回 success，HandleWebhook/VerifyPayment 空实现）
- `handler.go`：注册路由骨架（先注册 health 端点验证模块加载）
- 更新 `go.work` 加入 payment 模块
- 验证：`go build` 通过、Bifrost 启动后 `/api/billing/` 路由可达

**Story I-C-2：TablePlatformOrder 订单表**

- 新文件：`framework/configstore/tables/platform_order.go`
- 表名 `platform_orders`，字段见设计文档 13.2
- AutoMigrate 注册
- 验证：建表成功

**Story I-C-3：充值 API + Service（仅 ManualGateway）**

- `service.go`：BillingService — CreateRechargeOrder, HandleRechargeSuccess
- `handler.go`：POST /api/billing/recharge, POST /api/billing/admin/recharge
- 余额充值逻辑：查找/创建余额型 billing Budget，累加 MaxLimit
- ManualGateway：admin/recharge 直接创建 success 订单 + 执行充值
- 普通用户 /recharge：创建 pending 订单 + ManualGateway 返回（MVP 阶段由 admin 后台手动确认）
- 验证：admin 手动充值 → User 的 billing Budget MaxLimit 增加

**Story I-C-4：订单查询 API**

- `handler.go`：GET /api/billing/orders, GET /api/billing/orders/{orderId}
- 分页 + 过滤（type, status, date range）
- 验证：充值后可查到订单

---

## 迭代 II：套餐体系

> 目标：admin 可创建套餐商品，用户可购买（admin 手动标记支付），购买后自动创建 Budget/RateLimit/UserProviderConfig/EntityPackage。

### Epic II-A：套餐数据模型

**Story II-A-1：TablePlatformPackage 套餐商品模板**

- 新文件：`framework/configstore/tables/platform_package.go`
- 字段见设计文档 12.3
- 验证：建表成功

**Story II-A-2：TableEntityPackage 套餐购买实例**

- 新文件：`framework/configstore/tables/platform_entity_package.go`
- 字段见设计文档 12.4，含复合索引
- 验证：建表成功

**Story II-A-3：TableUserProviderConfig 用户级 Provider 配置**

- 新文件：`framework/configstore/tables/user_provider_config.go`
- 字段见设计文档 12.5，含复合唯一索引 idx_user_provider
- 验证：建表成功

### Epic II-B：套餐 CRUD + 购买流程

**Story II-B-1：套餐商品 CRUD API**

- handler: GET/POST/PUT/DELETE /api/billing/packages, GET /api/billing/packages/{packageId}
- 仅 admin 可写，所有 auth 可读
- 验证：创建/查询/更新/删除套餐商品

**Story II-B-2：套餐购买 Service — 购买逻辑（见 12.6）**

- service.go: BillingService.CreatePurchaseOrder, HandlePurchaseSuccess
- HandlePurchaseSuccess 核心流程：
  1. 创建 billing Budget (MaxLimit = Quota/100, ExpiresAt = now + Duration)
  2. 创建 RateLimit（如果套餐包含）
  3. Upsert UserProviderConfig per provider（UNION 合并，见 12.5.1）
  4. 创建 EntityPackage（关联子资源）
  5. 保存 OffPeakDiscount 到 EntityPackage 和 Budget
- 验证：购买后 User 有 Budget + UserProviderConfig + EntityPackage

**Story II-B-3：套餐购买 API + 订单关联**

- handler: POST /api/billing/purchases
- 创建 pending 订单 → ManualGateway（MVP 由 admin 确认）→ HandlePurchaseSuccess
- 验证：购买后可查到订单 + EntityPackage

**Story II-B-4：UserProviderConfig PreHook 检查 — 模型访问控制**

- 文件：`plugins/governance/resolver.go`
- 请求进入时查 UserProviderConfig，模型不在 AllowedModels → 403 forbidden_model
- 没有 UserProviderConfig → 放行（治理模式下无限制）
- 验证：购买限制模型的套餐后，只允许访问 AllowedModels 中的模型

**Story II-B-5：套餐到期/降级 — UserProviderConfig 重建算法**

- service.go: HandlePackageExpiry
- 到期时按 12.5.2 重建：查所有 active EntityPackage → 重新 UNION AllowedModels
- 无 active EP → 删除该 provider 行
- 可由定时任务或请求时 lazy check 触发
- 验证：套餐到期后 AllowedModels 正确收缩

---

## 迭代 III：Stripe 集成

> 目标：真实在线支付，用户自助完成充值/购买。

### Epic III-A：StripeGateway 实现

**Story III-A-1：StripeGateway — CreatePayment**

- 新文件：`plugins/payment/stripe.go`
- 依赖：`github.com/stripe/stripe-go/v82`
- 实现 CreatePayment：创建 Checkout Session，返回跳转 URL
- 支持 preferred_currency（MVP 用 Stripe 自动换算）
- 验证：测试环境创建 Session 成功

**Story III-A-2：StripeGateway — HandleWebhook**

- 文件：`plugins/payment/stripe.go`（追加）+ `webhook.go`
- 验证 Stripe 签名（webhookSecret + sig header）
- 解析 event type：checkout.session.completed → success
- 从 metadata 取 order_no 匹配订单
- 验证：stripe-cli trigger 事件 → 订单更新

**Story III-A-3：StripeGateway — VerifyPayment + 对账**

- 文件：`plugins/payment/stripe.go`（追加）
- 实现 VerifyPayment：查询 Checkout Session 状态
- 可用于主动对账（订单 status 长时间 pending 时）
- 验证：传入 paymentID 返回正确状态

### Epic III-B：Webhook 端点 + 配置化切换

**Story III-B-1：Webhook HTTP 端点 + 端到端集成**

- handler: POST /api/billing/webhook/stripe（无 auth）
- 读取 raw body + Stripe-Signature header
- 调 gateway.HandleWebhook → 匹配订单 → 调 service 充值/购买逻辑
- 验证：stripe-cli trigger → 用户 Budget 增加

**Story III-B-2：配置化 Gateway 切换 + /recharge 端点适配 Stripe**

- 读取 config.json 的 `billing.gateway` 字段
- `"stripe"` → StripeGateway；`"manual"` 或空 → ManualGateway
- POST /api/billing/recharge 适配：Stripe 时返回 checkout_url，前端跳转
- 验证：切换配置后充值流程走不同 gateway

**Story III-B-3：订单超时/取消处理**

- pending 订单超时（如 30 分钟）→ expired
- 用户取消 → cancelled
- 定时任务或 lazy check
- 验证：超时订单状态正确

---

## 迭代 IV：前端 UI

> 目标：用户自助操作，无需 admin 中转。

### Epic IV-A：充值 + 套餐购买

**Story IV-A-1：充值页面**

- 新路由：`ui/app/billing/recharge/`
- 金额选择 + 偏好货币选择
- 调 POST /api/billing/recharge → 跳转 Stripe Checkout
- 返回后显示结果
- 验证：端到端充值成功

**Story IV-A-2：套餐商城页面**

- 新路由：`ui/app/billing/packages/`
- 展示可购买套餐列表（GET /api/billing/packages）
- 套餐卡片：名称、价格、额度、有效期、权益明细
- 购买按钮 → 调 POST /api/billing/purchases
- 验证：展示 + 购买流程

### Epic IV-B：订单 + 套餐管理

**Story IV-B-1：订单历史页面**

- 新路由：`ui/app/billing/orders/`
- 分页表格：订单号、类型、金额、状态、时间
- 状态筛选
- 验证：充值/购买后可查到记录

**Story IV-B-2：已购套餐页面**

- 新路由：`ui/app/billing/entity-packages/`
- 套餐实例卡片：名称、额度进度条、到期倒计时、权益详情
- 验证：购买后可查看

**Story IV-B-3：余额 + 套餐概览组件**

- 通用组件：`ui/components/billing/`
- 余额展示（Credits + 美元）
- 活跃套餐数量/总额度
- 嵌入到 workspace 侧边栏或 dashboard
- 验证：各页面可看到余额信息

**Story IV-B-4：admin 套餐商品管理页面**

- 新路由：`ui/app/admin/packages/`（需 admin 权限）
- 套餐列表 + 创建/编辑/删除
- 表单：名称、价格、额度、有效期、AllowedModels 配置、OffPeakDiscount 配置
- 验证：admin CRUD 操作

---

## 依赖关系图

```
迭代 I:
  I-A-1 → I-A-3, I-A-4
  I-A-2 → I-B-4
  I-A-4 → I-B-1
  I-B-1 → I-B-2 → I-B-3 → I-B-4
  I-B-5 (独立, 可并行)
  I-C-1 → I-C-2 → I-C-3 → I-C-4

迭代 II (依赖迭代 I 全部完成):
  II-A-1, II-A-2, II-A-3 (可并行)
  II-A-* → II-B-1
  II-B-2 → II-B-3
  II-A-3 + II-B-2 → II-B-4
  II-B-2 → II-B-5

迭代 III (依赖迭代 II):
  III-A-1 → III-A-2 → III-A-3
  III-A-* → III-B-1
  I-C-1 → III-B-2
  III-B-1 → III-B-3

迭代 IV (依赖迭代 III):
  IV-A-1, IV-A-2 (可并行, 依赖 III-B-2)
  IV-B-1, IV-B-2 (可并行)
  IV-B-3 (依赖 IV-B-1, IV-B-2 的数据)
  IV-B-4 (依赖 II-B-1 的 API)
```

---

## Story 模板

每个 Story 实现时建议包含：

```
### Story [ID]: [标题]

**目标**：一句话

**涉及文件**：
- 修改：...
- 新增：...

**实现步骤**：
1. ...
2. ...

**验收标准**：
- [ ] ...
- [ ] 现有测试不 break

**依赖**：[前置 Story ID]
```

---

## 风险与注意事项

| 风险 | 缓解 |
|---|---|
| Budget BeforeSave 改动影响现有治理 | Story I-A-1 所有新字段 nullable + default "governance"，零迁移 |
| collectBudgetsFromHierarchy 改动破坏治理 | Story I-A-4 先加 filter 函数，不改现有调用，验证现有测试全过 |
| BillingBudgetChecker Deduct 浮点精度 | Story I-B-3 用 decimal 或 math.Round 到 6 位小数 |
| Stripe Webhook 幂等性 | Story III-B-1 订单 status=pending 才执行充值逻辑，已 success 的跳过 |
| UserProviderConfig UNION 合并竞态 | Story II-B-2 用数据库 upsert + 事务，避免并发购买覆盖 |
| 套餐到期 lazy check 延迟 | Story II-B-5 请求时 ExpiresAt 检查兜底，定时任务为辅 |
