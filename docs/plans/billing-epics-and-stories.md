# Bifrost 计费系统 — Epic 与 Story 设计

> 版本: v2.0 | 状态: 设计中 | 依赖: [billing-overview.md](./billing-overview.md), [billing-data-model.md](./billing-data-model.md)

---

## Epic 总览

| Epic | 名称 | Story 数 | 优先级 |
|------|------|---------|--------|
| E1 | 余额系统 | 3 | P0 |
| E2 | 充值功能 | 4 | P0 |
| E3 | 套餐系统 | 5 | P0 |
| E4 | 扣费引擎 | 5 | P0 |
| E5 | 兑换码 | 2 | P1 |
| E6 | 前端集成 | 4 | P0 |

---

## E1: 余额系统

> 用户/组织的 Credits 钱包，是所有计费操作的基础。

### E1-S1: 创建 governance_balances 表和 CRUD

**用户故事**：作为系统，我需要一个余额存储，以便追踪用户和组织的 Credits。

**验收标准**：
- [ ] `governance_balances` 表创建成功
- [ ] 余额查询 API：GET `/api/platform/billing/balance` 返回当前用户余额
- [ ] 余额记录在首次充值时自动创建（不存在则 insert，存在则 update）
- [ ] 余额变更高并发场景下使用 `gorm.Expr("balance + ?", amount)` 原子操作
- [ ] 扣减余额时 WHERE balance >= amount，影响行数 = 0 则返回余额不足错误

**API 设计**：

```
GET /api/platform/billing/balance
→ 200 { "code": "0", "data": { "entity_type": "user", "entity_id": "xxx", "balance": 1000, "total_recharge": 5000, "total_consumption": 4000 } }
```

**技术要点**：
- 余额记录懒创建：首次充值时 `INSERT ON CONFLICT UPDATE`（upsert）
- 扣减时的 WHERE 条件保证零透支：`UPDATE balances SET balance = balance - ? WHERE entity_type = ? AND entity_id = ? AND balance >= ?`

---

### E1-S2: Budget 表扩展 — 新增归属字段

**用户故事**：作为系统，我需要 Budget 表支持用户级和组织级归属，以便套餐和按量付费可以关联到具体实体。

**验收标准**：
- [ ] `governance_budgets` 表新增 `UserID`、`CustomerID`、`PackageID` 三个 nullable 字段
- [ ] 现有 Budget 功能不受影响（新字段全部为 nil）
- [ ] AutoMigrate 可正确添加新列

**技术要点**：
- GORM AutoMigrate 只添加列，不删除、不修改
- 新字段全部 nullable + 默认 nil，旧数据完全兼容

---

### E1-S3: "按量付费" Budget 自动创建与调整

**用户故事**：作为用户，我充值后就能直接使用 API，无需手动购买套餐。

**验收标准**：
- [ ] 用户首次充值时，自动创建"按量付费" Budget（UserID=用户ID, PackageID=nil, MaxLimit=充值金额, ResetDuration="0"）
- [ ] 后续充值时，同步调整该 Budget 的 MaxLimit += 充值金额
- [ ] Budget 创建/调整与余额变更是原子操作（同一事务）
- [ ] 用户消费时，PreHook 自动找到该"按量付费" Budget 进行额度检查

**技术要点**：
- 事务内：`UPDATE balances SET balance = balance + ?` → `INSERT/UPDATE budgets SET max_limit = ?`
- ResetDuration="0" 表示永不重置，预付费"用完为止"语义
- 查找按量付费 Budget：`WHERE user_id = ? AND package_id IS NULL AND (team_id IS NULL OR team_id = '') AND (virtual_key_id IS NULL OR virtual_key_id = '')`

---

## E2: 充值功能

> 用户通过支付渠道将真实货币转换为 Credits。

### E2-S1: 创建 platform_orders 表和订单生命周期

**用户故事**：作为系统，我需要统一的订单表，以便记录充值和套餐购买的全生命周期。

**验收标准**：
- [ ] `platform_orders` 表创建成功
- [ ] 订单号自动生成：充值 `RCH-{UUID}`，套餐购买 `PKG-{UUID}`
- [ ] 订单状态机：pending → success / failed / expired / cancelled
- [ ] 订单查询 API：GET `/api/platform/billing/orders?type=recharge&status=success&page=1&limit=20`

**API 设计**：

```
GET /api/platform/billing/orders?type=recharge&page=1&limit=20
→ 200 { "code": "0", "data": { "items": [...], "total": 42 } }
```

---

### E2-S2: Stripe 支付集成

**用户故事**：作为用户，我可以通过 Stripe 支付充值 Credits。

**验收标准**：
- [ ] POST `/api/platform/billing/stripe/pay` 创建 Stripe Checkout Session 并返回支付链接
- [ ] Webhook POST `/api/platform/billing/stripe/webhook` 接收支付回调
- [ ] Webhook 验签（Stripe SDK 签名验证）
- [ ] 支付成功后：创建订单(status=success) → 增加余额 → 创建/调整按量付费 Budget
- [ ] 订单级内存锁 `LockOrder(tradeNo)` 防并发 Webhook
- [ ] 幂等：已成功的订单直接返回，不重复处理

**API 设计**：

```
POST /api/platform/billing/stripe/pay
Body: { "amount": 10.00, "currency": "usd" }
→ 200 { "code": "0", "data": { "checkout_url": "https://checkout.stripe.com/...", "order_no": "RCH-xxx" } }

POST /api/platform/billing/stripe/webhook  (无需鉴权)
→ Stripe 签名验证 → 处理 checkout.session.completed 事件
```

**技术要点**：
- 借鉴 topup-module 的 `StripeAdaptor` 模式
- 金额换算：`amount(USD) / 0.01 = credits`
- Webhook 与套餐购买共用端点，通过 `order_no` 前缀 `RCH-` / `PKG-` 区分

---

### E2-S3: 管理员手动充值

**用户故事**：作为管理员，我可以直接给用户/组织增加 Credits（用于线下转账、补偿等场景）。

**验收标准**：
- [ ] POST `/api/platform/admin/billing/recharge` 管理员给指定用户/组织充值
- [ ] 创建订单(status=success, payment_method="admin")
- [ ] 余额增加 + 按量付费 Budget 调整（原子操作）
- [ ] 记录操作者信息

**API 设计**：

```
POST /api/platform/admin/billing/recharge
Body: { "entity_type": "user", "entity_id": "uuid", "credits": 1000, "remark": "线下转账" }
→ 200 { "code": "0", "data": { "order_no": "RCH-xxx", "balance": 1000 } }
```

---

### E2-S4: 充值优惠规则

**用户故事**：作为管理员，我可以设置充值优惠（如满$100送10%），以刺激大额充值。

**验收标准**：
- [ ] Admin API 配置优惠规则：`{ "threshold_credits": 10000, "bonus_percent": 10 }`
- [ ] 充值时自动计算赠送 Credits
- [ ] 订单记录中包含赠送信息
- [ ] 前端充值页面展示优惠信息

**技术要点**：
- 优惠规则存储在 `governance_clientconfig` 或新的配置表中
- 赠送 Credits 同样增加余额和调整 Budget

---

## E3: 套餐系统

> 管理员定义套餐商品，用户购买后获得定额 Credits + 有效期。

### E3-S1: 套餐商品 CRUD

**用户故事**：作为管理员，我可以创建、编辑、上下架套餐商品。

**验收标准**：
- [ ] POST `/api/platform/admin/billing/packages` 创建套餐
- [ ] GET `/api/platform/admin/billing/packages` 列出所有套餐（含禁用）
- [ ] PUT `/api/platform/admin/billing/packages/{id}` 更新套餐
- [ ] PATCH `/api/platform/admin/billing/packages/{id}/status` 启用/禁用
- [ ] 用户端 GET `/api/platform/billing/packages` 只返回 `is_active=true` 的套餐
- [ ] 套餐缓存（借鉴 subscription-module 的 `cachex.HybridCache` 双层缓存）

**API 设计**：

```
POST /api/platform/admin/billing/packages
Body: { "name": "Pro Monthly", "description": "...", "price": 49.99, "credits": 50000, "duration_unit": "month", "duration_value": 1, "sort_order": 10 }
→ 200 { "code": "0", "data": { "id": "pkg-uuid", ... } }

GET /api/platform/billing/packages
→ 200 { "code": "0", "data": { "items": [...] } }
```

---

### E3-S2: 套餐购买 — 余额支付

**用户故事**：作为用户，我可以用余额购买套餐。

**验收标准**：
- [ ] POST `/api/platform/billing/packages/{id}/purchase` 购买套餐
- [ ] 检查：余额 >= 套餐价格
- [ ] 事务内操作：
  1. 扣减余额 `balance - price`
  2. 调整按量付费 Budget `MaxLimit -= price`
  3. 创建订单(status=success, type=package_purchase)
  4. 创建 `platform_entity_packages` 记录
  5. 创建套餐 Budget（MaxLimit=套餐额度, PackageID=ep-x, UserID/CustomerID, ResetDuration="0"）
- [ ] 购买后返回套餐实例详情

**API 设计**：

```
POST /api/platform/billing/packages/pkg-uuid/purchase
Body: { "payment_method": "balance", "entity_type": "user" }
→ 200 { "code": "0", "data": { "entity_package_id": "ep-uuid", "credits_total": 50000, "expires_at": "2026-06-01T00:00:00Z" } }
```

---

### E3-S3: 套餐购买 — Stripe 支付

**用户故事**：作为用户，我可以直接通过 Stripe 支付购买套餐（无需先充值再购买）。

**验收标准**：
- [ ] POST `/api/platform/billing/packages/{id}/stripe/pay` 创建 Stripe Checkout Session
- [ ] Webhook 回调后：创建订单 → 创建实体套餐 → 创建套餐 Budget（余额不变，直接支付）
- [ ] 支付失败/过期时订单标记 failed/expired

---

### E3-S4: 套餐过期与额度管理

**用户故事**：作为用户，我的套餐到期后自动失效，我可以看到套餐的使用情况。

**验收标准**：
- [ ] 套餐到期后 `platform_entity_packages.status` → `expired`
- [ ] 对应 Budget 在 PreHook 中跳过已过期记录
- [ ] 定时任务扫描过期套餐（借鉴 subscription-module 的 `ExpireDueSubscriptions`）
- [ ] 用户可查看当前套餐列表及使用情况

**API 设计**：

```
GET /api/platform/billing/subscriptions
→ 200 { "code": "0", "data": { "items": [{ "package_name": "Pro Monthly", "credits_total": 50000, "credits_used": 12000, "expires_at": "2026-06-01T00:00:00Z", "status": "active" }] } }
```

---

### E3-S5: 管理员绑定套餐

**用户故事**：作为管理员，我可以给用户/组织手动绑定套餐（免支付，用于试用、补偿等）。

**验收标准**：
- [ ] POST `/api/platform/admin/billing/packages/bind` 管理员绑定套餐
- [ ] 不扣余额，直接创建实体套餐 + 套餐 Budget
- [ ] 订单记录 type=package_purchase, payment_method=admin

---

## E4: 扣费引擎

> 核心计费逻辑 — PreHook 余额检查 + PostHook 扣费结算。

### E4-S1: Credits 计算模块

**用户故事**：作为系统，我需要将 API 调用的 token 用量精确换算为 Credits。

**验收标准**：
- [ ] 复用 `governance_model_pricing` 表的定价数据
- [ ] `CalculateCredits(pricing, inputTokens, outputTokens) float64` 函数
- [ ] 支持扩展维度（cache/image/audio/batch），后续迭代实现
- [ ] 未配置定价的模型返回错误，拒绝请求

**技术要点**：
- 定价数据来自 ConfigStore，通过 GovernanceStore 接口访问
- 定价可能带 provider 前缀（如 `openai/gpt-4`），需支持模糊匹配

---

### E4-S2: PreHook — 余额/额度预检查

**用户故事**：作为系统，在 API 调用前我需要检查用户是否有足够额度，避免透支。

**验收标准**：
- [ ] PreHook 在请求进入 Provider 队列前执行
- [ ] 查找用户的可用 Budget 列表：
  1. 套餐 Budget（未过期、未耗尽、快过期优先）
  2. 按量付费 Budget（兜底）
- [ ] 如果没有任何 Budget 或所有 Budget 额度不足 → 返回 `429 budget_exceeded`
- [ ] VK.DeductFrom 字段控制扣费来源：
  - `auto` → 上述优先级
  - `user_balance` → 仅按量付费 Budget
  - `customer_balance` → 仅组织级 Budget
  - `package` → 仅指定套餐 Budget
- [ ] 流式请求：PreHook 仅做粗略估算（基于输入 token 数），PostHook 精确结算

**技术要点**：
- 预估公式：`estimatedCredits = CalculateCredits(pricing, inputTokens, 0)` — 仅算输入
- Budget 查询：`WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY expires_at ASC`

---

### E4-S3: PostHook — 扣费与结算

**用户故事**：作为系统，API 调用完成后我需要按实际用量扣费。

**验收标准**：
- [ ] PostHook 获取实际 token 用量（从 BifrostContext 或 streaming accumulator）
- [ ] `actualCredits = CalculateCredits(pricing, actualInputTokens, actualOutputTokens)`
- [ ] 原子更新 Budget：`gorm.Expr("current_usage + ?", actualCredits)`
- [ ] 更新 `platform_entity_packages.credits_used`（冗余字段，便于查询）
- [ ] 混合扣费：套餐 Budget 扣完后，剩余部分从按量付费 Budget 扣
- [ ] 同步更新 `governance_balances.total_consumption`

**技术要点**：
- 事务内更新：Budget.CurrentUsage += cost，如果超过 MaxLimit 则截断到 MaxLimit，差额从下一个 Budget 扣
- 套餐 Budget 的 MaxLimit 是"用完为止"，扣到 MaxLimit 就停

---

### E4-S4: 预扣 + 结算两阶段

**用户故事**：作为系统，流式请求需要在开始时预扣、结束时精确结算。

**验收标准**：
- [ ] `governance_pre_consume_records` 表创建成功
- [ ] 请求开始时：PreConsume → 创建预扣记录 + Budget.CurrentUsage += 预估值
- [ ] 请求结束时：Settle → 计算差额
  - delta > 0 → 补扣 Budget.CurrentUsage += delta
  - delta < 0 → 退还 Budget.CurrentUsage -= |delta|
  - delta = 0 → 无操作
- [ ] 异常时：Refund → Budget.CurrentUsage -= 预扣值
- [ ] `request_id` 唯一索引保证幂等

**技术要点**：
- BillingSession 模式（借鉴 subscription-module）：
  ```go
  session := NewBillingSession(userID, budgetList)
  session.PreConsume(requestID, estimatedCredits)  // 预扣
  // ... API 调用 ...
  session.Settle(actualCredits)  // 结算
  // 或
  session.Refund()  // 异常退款
  ```

---

### E4-S5: 组织场景扣费

**用户故事**：作为组织成员，我的 API 调用费用优先从组织套餐/余额扣除。

**验收标准**：
- [ ] VK.CustomerID 非空时，优先扣组织级 Budget
- [ ] 组织 Budget 不足时，回退到用户级按量付费 Budget
- [ ] 混合扣费记录中标注扣费来源（package_id / balance_type）
- [ ] 管理员可查看组织消费汇总

**扣费优先级**（VK.DeductFrom=auto 时）：
```
1. 组织套餐 Budget (CustomerID=VK.CustomerID, PackageID≠nil, 快过期优先)
2. 用户套餐 Budget (UserID=VK.UserID, PackageID≠nil, 快过期优先)
3. 组织按量付费 Budget (CustomerID=VK.CustomerID, PackageID=nil)
4. 用户按量付费 Budget (UserID=VK.UserID, PackageID=nil)
```

---

## E5: 兑换码

> 管理员预生成充值码，用户兑换后获得 Credits。

### E5-S1: 兑换码管理

**用户故事**：作为管理员，我可以批量创建兑换码，用于促销、线下发放等场景。

**验收标准**：
- [ ] POST `/api/platform/admin/billing/redemptions` 创建兑换码（单个/批量）
- [ ] GET `/api/platform/admin/billing/redemptions` 查询兑换码列表
- [ ] PATCH `/api/platform/admin/billing/redemptions/{id}/status` 启用/禁用
- [ ] 兑换码格式：32位随机字符串（crypto/rand 生成）
- [ ] 支持设置过期时间

---

### E5-S2: 兑换码使用

**用户故事**：作为用户，我可以通过输入兑换码获得 Credits。

**验收标准**：
- [ ] POST `/api/platform/billing/redeem` 兑换码充值
- [ ] 事务内操作（借鉴 topup-module 的 `Redeem()` 流程）：
  1. `FOR UPDATE` 行锁查找兑换码
  2. 校验状态（必须是启用）
  3. 校验过期时间
  4. 用户余额 += credits（原子操作）
  5. 兑换码状态 → 已使用
  6. 创建订单(status=success, type=recharge, payment_method=redemption)
  7. 调整按量付费 Budget
- [ ] 幂等：同一兑换码不可重复使用

**API 设计**：

```
POST /api/platform/billing/redeem
Body: { "key": "abcd1234efgh5678ijkl9012mnop3456" }
→ 200 { "code": "0", "data": { "credits": 1000, "balance": 1500 } }
```

---

## E6: 前端集成

> 打通前端已有页面与后端 API。

### E6-S1: Wallet 页面对接

**用户故事**：作为用户，我可以在 Wallet 页面查看余额和充值。

**验收标准**：
- [ ] `/platform/console/wallet` 页面展示余额、总充值、总消费
- [ ] 充值按钮连接 Stripe 支付流程
- [ ] 充值记录列表展示
- [ ] 兑换码输入框可用

**现有代码**：
- `ui/app/platform/console/wallet/page.tsx` — 已有框架
- `ui/app/platform/console/wallet/recharge.tsx` — 按钮 disabled，需激活

---

### E6-S2: 套餐展示与购买页面

**用户故事**：作为用户，我可以浏览可用套餐并购买。

**验收标准**：
- [ ] 套餐列表展示（价格、额度、有效期）
- [ ] 购买流程（余额支付 / Stripe 支付）
- [ ] 当前订阅状态展示

**现有代码**：
- `ui/app/platform/console/admin/packages/page.tsx` — 管理端已有框架

---

### E6-S3: Admin 套餐管理

**用户故事**：作为管理员，我可以在 Console 中管理套餐商品。

**验收标准**：
- [ ] 套餐 CRUD 操作
- [ ] 启用/禁用
- [ ] 用户订阅列表查看

---

### E6-S4: RTK Query API 对接

**用户故事**：作为开发者，我需要 RTK Query hooks 对接所有计费 API。

**验收标准**：
- [ ] `ui/lib/platform/endpoints/billing.ts` 中已有 hooks 框架，需对接实际 API
- [ ] 类型定义与后端响应格式匹配
- [ ] 缓存失效策略正确

**现有代码**：
- `ui/lib/platform/endpoints/billing.ts` — RTK Query hooks 已定义
- `ui/lib/platform/types.ts` (L178-310) — 前端类型定义已有

---

## 验收标准汇总

### P0 — MVP 必须完成

| Epic | Story | 关键验收点 |
|------|-------|-----------|
| E1 | S1-S3 | 余额表 + Budget 扩展 + 按量付费自动创建 |
| E2 | S1-S3 | 订单表 + Stripe 支付 + 管理员充值 |
| E3 | S1-S2 | 套餐 CRUD + 余额购买套餐 |
| E4 | S1-S3 | Credits 计算 + PreHook + PostHook |
| E6 | S1, S4 | Wallet 页面 + RTK Query |

### P1 — 第二迭代

| Epic | Story | 说明 |
|------|-------|------|
| E2 | S4 | 充值优惠规则 |
| E3 | S3-S5 | Stripe 购买套餐 + 过期管理 + 管理员绑定 |
| E4 | S4-S5 | 预扣+结算 + 组织场景 |
| E5 | S1-S2 | 兑换码 |
| E6 | S2-S3 | 套餐前端 |
