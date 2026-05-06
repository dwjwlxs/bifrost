# Bifrost 计费系统 — 总体设计

> 版本: v2.0 | 状态: 设计中 | 最后更新: 2026-05

---

## 1. 背景与动机

Bifrost 是一个开源 AI 网关，当前 governance 模块已实现 VK/Team/Customer 级别的**预算限制**（Budget）和**速率限制**（RateLimit），但缺少面向终端用户的商业化计费能力：

- 用户无法充值，无法自助使用 API
- 没有套餐商品体系，无法支撑 SaaS 商业模式
- 扣费链路只做"预算检查"不做"余额扣减"，无法实现真正的付费使用

**本项目的目标**：在现有 governance 基础上，构建完整的 **充值 → 余额 → 套餐 → 扣费** 计费闭环。

---

## 2. 核心设计哲学

### 2.1 余额是钱包，套餐是消费通道

```
┌─────────────────────────────────────────────────────┐
│                    用户视角                          │
│                                                     │
│  充值 ──→ 余额(钱包) ──→ 购买套餐 ──→ API 消费      │
│                 │                                   │
│                 └──→ 按量付费(无套餐) ──→ API 消费   │
│                                                     │
├─────────────────────────────────────────────────────┤
│                    底层实现                          │
│                                                     │
│  所有消费统一走 Budget 扣费链路                      │
│  • 套餐 = Budget 记录（MaxLimit=套餐额度）           │
│  • 按量付费 = 自动创建的 Budget（MaxLimit=余额）     │
│  • 扣费 = Budget.CurrentUsage += cost               │
└─────────────────────────────────────────────────────┘
```

**关键洞察**：Bifrost 已有成熟的 Budget 扣费链路（PreHook 检查 → API 调用 → PostHook 递增 CurrentUsage）。套餐不过是"有额度上限 + 有效期"的 Budget，按量付费不过是"MaxLimit = 余额"的 Budget。**无需新建第二条消费通道**。

### 2.2 零透支原则

余额不足以覆盖请求成本 → 直接拒绝，返回 `429 budget_exceeded`。不做透支、不做后付费。这保证了：

- 财务安全：平台不会承担坏账
- 实现简洁：无需催收、账单对账等复杂逻辑
- 用户体验透明：扣费前检查，失败即知

### 2.3 向后兼容

- 所有新增字段使用 nullable / 默认值，不影响现有表结构
- 现有 API 只新增，不修改签名
- 新功能通过 governance plugin 的 PreHook/PostHook 注入，不侵入核心请求链路

---

## 3. 核心概念

| 概念 | 说明 | 对应实现 |
|------|------|---------|
| **Credits** | 平台统一计费单位，1 Credit = $0.01 | `platform_balances.balance` |
| **余额 (Balance)** | 用户/组织的 Credits 钱包 | `platform_balances` 表 |
| **套餐 (Package)** | 管理员定义的商品模板（如"Pro 月包 100K Credits"） | `platform_packages` 表 |
| **实体套餐 (EntityPackage)** | 用户/组织购买的套餐实例 | `platform_entity_packages` 表 |
| **按量付费 Budget** | 充值时自动创建，MaxLimit=余额，用完即止 | `governance_budgets` 表（ResetDuration="0"） |
| **套餐 Budget** | 购买套餐时创建，MaxLimit=套餐额度，到期失效 | `governance_budgets` 表（关联 PackageID） |
| **兑换码 (Redemption)** | 管理员预生成的充值码 | `platform_redemptions` 表 |
| **订单 (Order)** | 充值/购买套餐的支付记录 | `platform_orders` 表 |

---

## 4. 关键设计决策

### D1: 余额表放在 platform 模块

**决策**：新建 `platform_balances` 单表，采用 `entity_type + entity_id` 多态模式。

**原因**：
- governance PostHook 需要直接扣减余额，跨模块访问 auth 层会引入循环依赖
- entity_type 模式让 user/customer 共用一张表，避免分表带来的代码重复
- 与 Bifrost 已有的 VK.UserID / VK.CustomerID 归属体系天然对齐

**替代方案**：在 `auth_users` 表加 Balance 字段 → ❌ auth 模块是用户身份层，不应承载财务逻辑。

### D2: 套餐 = Budget 记录（挂载到 VK）

**决策**：用户购买套餐后，在 `governance_budgets` 创建对应记录，通过 `VirtualKeyID` 挂载到 VK 上，完全复用现有扣费链路。

**原因**：
- Bifrost 已有成熟的 Budget 检查+扣减链路，无需重复造轮子
- 套餐天然有"额度上限"（MaxLimit）和"有效期"（ResetDuration），与 Budget 语义一致
- PreHook 检查 Budget.CurrentUsage < Budget.MaxLimit 即可判断套餐是否可用
- 所有 API 调用都通过 VK，VK 是请求的唯一入口，计费 Budget 自然应挂载到 VK

**扩展 Budget 表**：新增 `UserID *string`、`CustomerID *string`、`PackageID *string` 三个可选字段，但这些字段是**冗余元数据**，仅用于管理查询/审计/报表，运行时计费路径不依赖这些字段做查找（详见 D8）。

### D3: "充钱即用" — 自动创建按量付费 Budget

**决策**：用户充值时，自动创建/调整"按量付费" Budget（MaxLimit = 余额），用户无需手动买套餐即可使用 API。

**原因**：
- 降低使用门槛：充值即可用，不需要理解套餐概念
- 底层统一：始终走 Budget 扣费，无需第二条消费通道
- 原子操作：`platform_balances.balance += amount` 同时调整 Budget 的 `MaxLimit += amount`

### D4: 套餐表放 platform 层

**决策**：`platform_packages` + `platform_entity_packages` 放在 platform 模块，governance 通过共享数据库访问套餐。

**原因**：
- 套餐是平台运营行为（定价、上下架），属于 Platform Admin 管辖
- governance 只需读取套餐关联的 Budget 记录，不直接操作套餐表
- 遵循"谁拥有数据谁管理"原则

### D5: 复用 ModelPricing 已有定价表

**决策**：使用 `governance_model_pricing` 表（已存在），不新建简化版定价 map。

**原因**：
- 现有 `TableModelPricing` 支持 cache/image/audio/batch 等多种价格维度，远比简化版精确
- 避免数据冗余：两套定价体系会导致数据不一致

**换算公式**：
```
credits = (inputTokens * InputCostPerToken + outputTokens * OutputCostPerToken) / 0.01
```
> 0.01的倍率是举例，实际上应该支持在provider维度、模型维度设置倍率

### D6: 预扣 + 结算两阶段

**决策**：借鉴 subscription-module 的 BillingSession 模式，API 调用前预扣估算额度，完成后按实际用量结算差额。

**原因**：
- 流式响应：实际用量在流结束后才确定，预扣保证不会超额
- 并发安全：`request_id` 唯一索引保证幂等
- 可退款：异常时 `Refund()` 退还全部预扣

### D7: 扣费优先级

**决策**：VK 粒度可配置扣费来源（auto/user_balance/customer_balance/package），auto 模式下：

1. 优先消耗"快过期"的套餐 Budget
2. 套餐 Budget 不够时，余额补足（混合扣费）
3. 无套餐时，走按量付费 Budget

**原因**：用户利益最大化 — 快过期套餐先用，避免浪费；混合扣费避免"套餐剩一点但不够用"的尴尬。

### D8: VK 驱动的计费查找路径

**决策**：运行时计费完全通过 VK 驱动，不引入独立的用户级 Budget 查找路径。

**原因**：
- 所有 API 调用都通过 VK，VK 是请求的唯一入口
- 现有链路 `collectBudgetsFromHierarchy` 已天然收集 VK 下的所有 Budget（包括计费 Budget）
- VK 有 `UserID *string`，可间接关联到用户，无需另起查找路径
- 不需要新增 `userBillingBudgets sync.Map`，不需要改 `CheckUserBudget` / `UpdateUserBudgetUsageInMemory`

**运行时路径**：
```
请求 → VK → collectBudgetsFromHierarchy → VK.Budgets → 扣费
                                              ↑ 计费Budget通过VirtualKeyID挂载
```

**管理查询路径**（不走运行时热路径）：
```
"用户X的所有Budget" → WHERE user_id = X 或 WHERE virtual_key_id IN (VK.UserID=X 的 VK)
"组织Y的消费报表"   → WHERE customer_id = Y
"套餐Z的Budget"     → WHERE package_id = Z
"快过期的套餐"       → WHERE package_id IS NOT NULL AND expires_at < threshold
```

**Budget 上冗余字段的用途注释**：
- `UserID` — 仅用于管理查询（如"用户维度账单"），运行时不依赖此字段查找 Budget
- `CustomerID` — 仅用于组织维度审计和报表
- `PackageID` — 仅用于标识 Budget 来源套餐，以及批量操作（如套餐过期清理）

**代价与接受**：余额 Budget 是 VK 级别，同一用户有多个 VK 时余额独立。在 API 网关场景下，VK 本身就是隔离单位，大多数用户 1-2 个 VK，此代价可接受。

---

## 5. 系统架构

```
                        ┌─────────────┐
                        │  Platform   │  套餐管理、订单管理、充值管理
                        │  Handlers   │  (CRUD, 支付回调)
                        └──────┬──────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │    platform   │ │  governance  │ │  governance  │
     │   _packages   │ │  _balances   │ │  _budgets    │
     │   _orders     │ │  _redemptions│ │ (扩展字段)    │
     │   _entity_    │ │              │ │              │
     │   packages    │ │              │ │              │
     └──────────────┘ └──────────────┘ └──────────────┘
                               │
                        ┌──────┴──────┐
                        │  Governance  │  PreHook: 余额/Budget检查
                        │   Plugin     │  PostHook: 扣费+结算
                        └─────────────┘
                               │
                        ┌──────┴──────┐
                        │ ModelPricing │  已有定价表，Credits 换算
                        └─────────────┘
```

### 数据流

```
充值:
  支付回调 → platform_orders(status=success)
           → platform_balances.balance += amount (原子)
           → governance_budgets(MaxLimit += amount) (按量付费Budget)

购买套餐:
  支付回调 → platform_orders(status=success)
           → platform_balances.balance -= price (扣余额)
           → governance_budgets(新建, MaxLimit=套餐额度, PackageID=ep-x, UserID/CustomerID)
           → platform_entity_packages(新建, 记录归属)

API消费:
  PreHook  → 查 Budget(MaxLimit - CurrentUsage >= 预估cost?) → 放行/拒绝
  PostHook → Budget.CurrentUsage += actual_cost (gorm.Expr 原子更新)
           → 套餐Budget耗尽时，自动切到按量付费Budget
```

---

## 6. 与参考系统的对比

### 6.1 与 topup-module (new-api) 的对比

| 维度 | new-api TopUp | Bifrost 计费 |
|------|--------------|-------------|
| 额度单位 | Quota (1$ = 500K quota) | Credits (1 Credit = $0.01) |
| 余额存储 | `users.quota` 字段 | 独立 `platform_balances` 表 |
| 套餐扣费 | 无（充值后直接扣 quota） | 通过 Budget 记录扣费 |
| 分组倍率 | TopupGroupRatio | 不需要（Credits 直接映射美元） |
| 支付渠道 | Epay/Stripe/Creem/Waffo 5种 | 初期 Stripe + 兑换码，后续扩展 |

### 6.2 与 subscription-module (new-api) 的对比

| 维度 | new-api Subscription | Bifrost 套餐 |
|------|---------------------|-------------|
| 套餐实例 | `user_subscriptions` (独立额度管理) | `governance_budgets` (复用现有Budget) |
| 预扣机制 | `SubscriptionPreConsumeRecord` | 复用 Budget 的 CurrentUsage 机制 |
| 额度重置 | 定时任务 ResetDueSubscriptions | Budget.ResetDuration 机制（已有） |
| 分组升降级 | upgrade_group / prev_user_group | 暂不实现（后续迭代） |
| 计费偏好 | BillingPreference 4种模式 | VK.DeductFrom 字段（更简单） |

### 6.3 借鉴的最佳实践

从两个参考系统中，我们借鉴以下已验证的模式：

1. **预扣 + 结算两阶段** (subscription-module) — 保证流式响应的精确计费
2. **订单级内存锁** (topup-module) — `sync.Map` + 引用计数，防 Webhook 并发
3. **行锁 FOR UPDATE** (两者共用) — 事务内防竞态
4. **request_id 幂等** (subscription-module) — 防重复扣费
5. **联动写入** (subscription-module) — 套餐购买同时写 top_ups 记录，保持统计一致
6. **订单号前缀区分** (subscription-module) — `SUBUSR` vs `USR`，Webhook 共用端点

---

## 7. 文档索引

| 文档 | 内容 |
|------|------|
| [billing-overview.md](./billing-overview.md) | 本文档 — 总体设计、背景、哲学、决策 |
| [billing-data-model.md](./billing-data-model.md) | 数据模型、表设计、迁移策略 |
| [billing-epics-and-stories.md](./billing-epics-and-stories.md) | Epic/Story 划分、API 设计、业务流程 |
| [billing-implementation-plan.md](./billing-implementation-plan.md) | Sprint 计划、工作量估算、风险与依赖 |


    4 份文档全部完成，放在 docs/plans/ 目录下：

    1. billing-overview.md — 总体设计
    - 背景、核心设计哲学（余额=钱包，套餐=消费通道，零透支）
    - 7 个关键设计决策 D1-D7（含原因和替代方案分析）
    - 系统架构图 + 数据流
    - 与 topup-module / subscription-module 的对比 + 6 条借鉴的最佳实践

    2. billing-data-model.md — 数据模型
    - 现有表变更：governance_budgets 扩展 3 个字段（UserID/CustomerID/PackageID）
    - 6 张新建表：platform_balances, platform_packages, platform_entity_packages, platform_orders, governance_redemptions, governance_pre_consume_records
    - 完整表关系图 + GORM 结构体定义
    - 迁移策略（AutoMigrate + 向后兼容保证）+ Credits 换算规则

    3. billing-epics-and-stories.md — Epic/Story 设计
    - 6 个 Epic、23 个 Story
    - 每个 Story 含：用户故事、验收标准、API 设计、技术要点
    - P0/P1 优先级划分

    4. billing-implementation-plan.md — 实施计划
    - 6 个 Sprint，约 10 周
    - 每个 Sprint 含 Story 分配 + 工作量估算
    - 依赖关系图 + 关键路径
    - 技术实现规范（项目结构、代码规范、第三方依赖）
    - 7 项风险 + 缓解措施
    - 验收/测试策略 + 5 个里程碑