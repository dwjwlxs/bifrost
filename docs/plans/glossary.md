# Bifrost 术语表

> 版本: v1.0 | 最后更新: 2026-05

---

## 1. 核心架构

| 英文 | 中文 | 定义 | 代码/备注 |
|------|------|------|-----------|
| Bifrost | — | 高性能 AI 网关，统一 20+ LLM Provider 的 OpenAI 兼容 API | `github.com/maximhq/bifrost` |
| Gateway | 网关 | 统一入口，转发请求到下游 Provider | — |
| Provider | 供应商 | AI 模型提供商（OpenAI、Anthropic、Gemini 等） | `core/schemas/bifrost.go` → `ModelProvider` |
| ModelProvider | 模型供应商枚举 | Provider 的枚举类型，共 24 种 | `ModelProvider string` |
| StandardProvider | 标准供应商 | 内置供应商（非 CustomProvider） | `StandardProviders` 变量 |
| CustomProvider | 自定义供应商 | 基于标准供应商扩展的自定义配置 | `SupportedBaseProviders` 定义可用基座 |
| Virtual Key (VK) | 虚拟密钥 | 对外暴露的 API Key，内部路由到真实 Provider Key | `TableVirtualKey` / `governance_virtual_keys` |
| Provider Key | 供应商密钥 | 真实的 API Key（如 `sk-xxx`），挂在 Provider Config 下 | `TableKey` / `config_keys` |
| Provider Config | 供应商配置 | VK 级别的供应商配置，包含 AllowedModels、Key 列表 | `TableVirtualKeyProviderConfig` |
| Plugin | 插件 | Bifrost 的扩展机制，分为 LLM / MCP / HTTP 三类 | `PluginType` |
| MCP (Model Context Protocol) | 模型上下文协议 | 让 LLM 调用外部工具的协议 | `core/mcp/` |
| MCP Client | MCP 客户端 | Bifrost 连接到 MCP Server 的客户端实例 | `TableMCPClient` / `config_mcp_clients` |
| MCP Agent | MCP 代理 | 多轮工具调用的编排循环 | `core/mcp/agent.go` |
| Request | 请求 | 客户端到 Bifrost 的 API 调用 | `BifrostRequest` |
| Response | 响应 | Bifrost 返回给客户端的结果 | `BifrostResponse` |
| Stream Chunk | 流式分片 | SSE 流式响应的单个数据块 | `BifrostStreamChunk` |
| Fallback | 回退 | 主 Provider 失败时切换到备用 Provider | `Fallback` struct |
| Routing Rule | 路由规则 | 按条件将请求路由到指定 Provider/Model | `TableRoutingRule` / `routing_rules` |
| Routing Target | 路由目标 | 路由规则的输出，包含 Provider、Model、Weight | `TableRoutingTarget` |
| Config Hash | 配置哈希 | 用于检测 config.json 与数据库配置是否一致 | 各 Table 的 `ConfigHash` 字段 |
| BifrostContext | Bifrost 上下文 | 自定义 context.Context，支持线程安全的可变值 | `core/schemas/context.go` |
| Key Selector | 密钥选择器 | 从多个 Key 中加权随机选择一个的策略 | `KeySelector func` |

---

## 2. 请求类型 (RequestType)

| 英文 | 中文 | 定义 |
|------|------|------|
| Chat Completion | 聊天补全 | OpenAI Chat API 格式请求 |
| Chat Completion Stream | 聊天补全流式 | 流式 Chat API |
| Text Completion | 文本补全 | 传统文本补全请求 |
| Text Completion Stream | 文本补全流式 | 流式文本补全 |
| Responses | 响应式 API | OpenAI Responses API 格式 |
| Responses Stream | 响应式流式 | 流式 Responses API |
| Embedding | 向量嵌入 | 文本向量化请求 |
| Speech | 语音合成 | TTS 语音生成 |
| Transcription | 语音转录 | STT 语音转文字 |
| Image Generation | 图片生成 | AI 图片生成 |
| Image Edit | 图片编辑 | AI 图片编辑 |
| Image Variation | 图片变体 | AI 图片变体生成 |
| Video Generation | 视频生成 | AI 视频生成 |
| Batch | 批处理 | 异步批处理操作 |

---

## 3. 治理与计费

| 英文 | 中文 | 定义 | 代码/备注 |
|------|------|------|-----------|
| Governance | 治理 | 预算上限、速率限制等管控能力 | `plugins/governance/` |
| Billing | 计费 | 扣费付费、商业化运营能力 | `framework/payment/` |
| Budget | 预算 | 消费限额/额度，分治理和计费两种类型 | `TableBudget` / `governance_budgets` |
| BudgetType | 预算类型 | governance（治理限额）或 billing（计费额度） | `BudgetType string` |
| BudgetChecker | 预算检查器 | 按 BudgetType 分流的检查/扣费接口 | `BudgetChecker` interface（Check + Deduct） |
| GovernanceBudgetChecker | 治理预算检查器 | AND 逻辑：任一 Budget 超额即拒绝 | `plugins/governance/checker.go` |
| BillingBudgetChecker | 计费预算检查器 | OR 逻辑：混合扣费，余额补足 | `plugins/governance/checker.go` |
| RateLimit | 速率限制 | Token/Request 维度的频率限制 | `TableRateLimit` / `governance_rate_limits` |
| MaxLimit | 最大限额 | Budget 的消费上限（美元） | `TableBudget.MaxLimit` |
| CurrentUsage | 当前用量 | Budget 已消费金额（美元） | `TableBudget.CurrentUsage` |
| ResetDuration | 重置周期 | Budget/RateLimit 的自动重置间隔，如 "1d"、"1M"、"0"（永不重置） | `TableBudget.ResetDuration` |
| LastReset | 上次重置时间 | 上一次 CurrentUsage 归零的时间 | `TableBudget.LastReset` |
| ExpiresAt | 过期时间 | 一次性套餐的失效时间点 | `TableBudget.ExpiresAt` |
| CalendarAligned | 日历对齐 | 预算/限速按自然日/月/年边界重置 | `CalendarAligned bool` |
| OffPeakDiscount | 非高峰折扣 | 指定时段的消费折扣规则 | JSON: `{"rules":[...],"timezone":"Asia/Shanghai"}` |
| Dimension | 维度 | 预算的计量维度（cost/tokens/requests），未来扩展 | 计划中 |
| Credits | 积分/信用点 | 用户侧货币单位，1 Credit = $0.01 | Budget 内部存美元 |
| Baseline | 基线 | 预算检查时预扣除的已占用额度 | `baselines map[string]float64` |
| Decision | 决策 | 预算检查的结果：Allow 或 BudgetExceeded | — |
| Zero Overdraft | 零透支 | 余额不足即拒绝，不允许可用额为负 | — |
| Hybrid Deduction | 混合扣费 | 套餐优先 + 余额补足的扣费策略 | BillingBudgetChecker.Deduct |

---

## 4. 充值与套餐

| 英文 | 中文 | 定义 | 代码/备注 |
|------|------|------|-----------|
| Recharge | 充值 | 向账户增加余额 | `POST /api/billing/recharge` |
| Balance | 余额 | ResetDuration="0", ExpiresAt=nil 的 Budget，充值累加 MaxLimit | — |
| Subscription | 订阅型套餐 | 按周期自动重置的套餐（如月度） | ResetDuration="1M"，计费用 ExpiresAt |
| One-time Package | 一次性套餐 | 固定有效期、不可重置的套餐 | ResetDuration="0"，ExpiresAt=now+duration |
| Package (PlatformPackage) | 套餐商品模板 | 定义套餐的定价、额度、权益内容 | `TablePlatformPackage` / `platform_packages` |
| Entity Package | 套餐购买实例 | 用户购买套餐后创建的实例，关联子资源 | `TableEntityPackage` / `platform_entity_packages` |
| Quota | 额度 | 套餐包含的 Credits 数量 | Quota / 100 = Budget 的 MaxLimit（美元） |
| Duration | 有效期 | 套餐的有效天数 | `TablePlatformPackage.Duration` |
| Price | 售价 | 套餐的标价（Credits） | `TablePlatformPackage.Price` |
| AllowedModels | 允许模型 | 白名单机制，限制用户可用的 Provider/Model | `schemas.WhiteList` |
| AutoRenew | 自动续费 | 套餐到期时是否自动续费 | `TablePlatformPackage.AutoRenew` / `TableEntityPackage.AutoRenew` |
| RenewedFromID | 续费来源 | 续费创建的新 EntityPackage 指向旧记录 | `TableEntityPackage.RenewedFromID` |
| TargetType | 销售范围 | 套餐面向个人(user)/组织(customer)/两者(both) | `TablePlatformPackage.TargetType` |
| MaxPurchasePerUser | 限购数量 | 每用户最大购买次数，0=不限 | `TablePlatformPackage.MaxPurchasePerUser` |
| RateLimitConfig | 限速配置模板 | 套餐内的 RateLimit 配置，购买时创建 RateLimit 记录 | JSON 字段 |
| UserProviderConfig | 用户级供应商配置 | 用户维度的 AllowedModels 白名单，User 1:N per Provider | `TableUserProviderConfig` / `governance_user_provider_configs` |
| UNION Upsert | 合并写入 | 购买套餐时 AllowedModels 取并集 upsert | `12.5.1 购买合并算法` |
| Rebuild on Expiry | 到期重建 | 套餐到期时重新 UNION 所有活跃套餐的 AllowedModels | `12.5.2 到期重建算法` |
| Sort Rules | 排序规则 | 混合扣费时 Budget 的优先级排序 | `7.1 排序规则` |

---

## 5. 订单与支付

| 英文 | 中文 | 定义 | 代码/备注 |
|------|------|------|-----------|
| Order (PlatformOrder) | 订单 | 充值/套餐购买的统一订单记录 | `TablePlatformOrder` / `platform_orders` |
| Order No | 订单号 | 唯一订单标识，前缀区分：RCH-(充值)、PKG-(套餐) | `TablePlatformOrder.OrderNo` |
| Order Type | 订单类型 | recharge（充值）/ package_purchase（套餐购买） | `TablePlatformOrder.Type` |
| Order Status | 订单状态 | pending / success / failed / expired / cancelled | `TablePlatformOrder.Status` |
| Payment Gateway | 支付网关 | 支付平台的抽象接口 | `PaymentGateway` interface |
| Stripe Gateway | Stripe 网关 | 基于 Stripe Checkout Session 的在线支付实现 | `framework/payment/stripe.go` |
| Manual Gateway | 手动网关 | 管理员手动标记支付的实现（无真实支付） | `framework/payment/manual.go` |
| Checkout Session | 结账会话 | Stripe 托管支付页，用户在 Stripe 完成付款 | — |
| Checkout URL | 结账链接 | Stripe Checkout Session 的跳转地址 | `PaymentResult.CheckoutURL` |
| Webhook | 回调 | 支付平台主动通知支付结果的 HTTP 回调 | `POST /api/billing/webhook/stripe` |
| Payment ID | 支付交易号 | 支付平台（如 Stripe）侧的交易标识 | `TablePlatformOrder.PaymentID` |
| Paid Amount | 实付金额 | 用户实际支付的金额（美元） | `WebhookResult.PaidAmount` |
| Preferred Currency | 偏好货币 | 用户侧展示的货币（如 JPY/EUR），MVP 由 Stripe 换算 | `PaymentOptions.PreferredCurrency` |
| Provider Payload | 平台原始数据 | 支付平台回调的原始 JSON，用于对账 | `TablePlatformOrder.ProviderPayload` |
| Verify Payment | 支付验证 | 主动查询支付状态，用于对账 | `PaymentGateway.VerifyPayment` |
| Idempotent Webhook | 幂等回调 | Webhook 重复投递时只执行一次（status=pending 才执行） | — |

---

## 6. 组织与用户体系

| 英文 | 中文 | 定义 | 代码/备注 |
|------|------|------|-----------|
| User | 用户 | 计费体系中的个人实体，TableUser 存在=计费模式 | `TableUser` / `governance_users` |
| Team | 团队 | 组织内部的团队单元 | `TableTeam` / `governance_teams` |
| Customer | 客户/组织 | 顶级组织实体 | `TableCustomer` / `governance_customers` |
| Personal VK | 个人虚拟密钥 | UserID only，无 TeamID/CustomerID | 计费走 User |
| Organization VK | 组织虚拟密钥 | 有 TeamID 或 CustomerID | 计费走 Team → Customer |
| Platform Admin | 平台管理员 | 系统级管理员 | `TablePlatformAdmin` / `platform_admins` |
| Org Member | 组织成员 | Platform 多租户中的组织成员 | `TablePlatformOrgMember` / `platform_org_members` |
| Team Member | 团队成员 | Platform 多租户中的团队成员 | `TablePlatformTeamMember` / `platform_team_members` |
| Invitation | 邀请 | 加入组织/团队的待处理邀请 | `TablePlatformInvitation` / `platform_invitations` |
| RBAC | 基于角色的访问控制 | 5 种内置角色 + 自定义角色 | — |
| Multi-tenant | 多租户 | Platform 层面的组织隔离 | — |
| User Scope | 用户作用域 | Budget 限定在特定 Team/Customer 下生效 | `UserScopeTeamID` / `UserScopeCustomerID` |

---

## 7. 数据模型 (Table 汇总)

| Go 类型 | 表名 | 说明 | 模块 |
|---------|------|------|------|
| `TableVirtualKey` | `governance_virtual_keys` | 虚拟密钥 | governance |
| `TableVirtualKeyProviderConfig` | `governance_virtual_key_provider_configs` | VK 级供应商配置 | governance |
| `TableVirtualKeyProviderConfigKey` | `governance_virtual_key_provider_config_keys` | VK 供应商配置与 Key 的多对多 | governance |
| `TableVirtualKeyMCPConfig` | `governance_virtual_key_mcp_configs` | VK 级 MCP 配置 | governance |
| `TableBudget` | `governance_budgets` | 预算（治理+计费） | governance |
| `TableRateLimit` | `governance_rate_limits` | 速率限制 | governance |
| `TableUser` | `governance_users` | 用户（计费载体） | governance |
| `TableTeam` | `governance_teams` | 团队 | governance |
| `TableCustomer` | `governance_customers` | 客户/组织 | governance |
| `TableKey` | `config_keys` | Provider API Key | config |
| `TableProvider` | `config_providers` | 供应商配置 | config |
| `TableModel` | `config_models` | 模型配置 | config |
| `TableModelConfig` | `governance_model_configs` | 模型治理配置 | governance |
| `TableModelPricing` | `model_pricing` | 模型定价 | config |
| `TablePricingOverride` | `governance_pricing_overrides` | 定价覆盖规则 | governance |
| `TableRoutingRule` | `routing_rules` | 路由规则 | governance |
| `TableRoutingTarget` | `routing_targets` | 路由目标 | governance |
| `TableMCPClient` | `config_mcp_clients` | MCP 客户端配置 | config |
| `TablePlugin` | `config_plugins` | 插件配置 | config |
| `TableOauthConfig` | `oauth_configs` | OAuth 配置 | auth |
| `TableOauthToken` | `oauth_tokens` | OAuth Token | auth |
| `TableOauthUserSession` | `oauth_user_sessions` | OAuth 用户会话 | auth |
| `TableOauthUserToken` | `oauth_user_tokens` | OAuth 用户 Token | auth |
| `TablePerUserOAuthClient` | `per_user_oauth_clients` | 每用户 OAuth 客户端 | auth |
| `TablePerUserOAuthSession` | `per_user_oauth_sessions` | 每用户 OAuth 会话 | auth |
| `TablePerUserOAuthCode` | `per_user_oauth_codes` | 每用户 OAuth 授权码 | auth |
| `TablePerUserOAuthPendingFlow` | `per_user_oauth_pending_flows` | 每用户 OAuth 待处理流 | auth |
| `TablePlatformOrgMember` | `platform_org_members` | 组织成员 | platform |
| `TablePlatformTeamMember` | `platform_team_members` | 团队成员 | platform |
| `TablePlatformAdmin` | `platform_admins` | 平台管理员 | platform |
| `TablePlatformInvitation` | `platform_invitations` | 邀请 | platform |
| `TablePlatformPackage` | `platform_packages` | 套餐商品模板 | billing（计划中） |
| `TableEntityPackage` | `platform_entity_packages` | 套餐购买实例 | billing（计划中） |
| `TablePlatformOrder` | `platform_orders` | 统一订单 | billing（计划中） |
| `TableUserProviderConfig` | `governance_user_provider_configs` | 用户级供应商配置 | billing（计划中） |
| `TableGovernanceConfig` | `governance_configs` | 治理全局配置 | governance |
| `TableFrameworkConfig` | `framework_configs` | 框架全局配置 | framework |
| `TableClientConfig` | `client_configs` | 客户端配置 | config |
| `TableLogStoreConfig` | `logstore_configs` | 日志存储配置 | config |
| `TableVectorStoreConfig` | `vector_store_configs` | 向量存储配置 | config |
| `TableEnvKey` | `env_keys` | 环境变量密钥 | config |
| `TableFolder` | `folders` | 文件夹 | governance |
| `TableDistributedLock` | `distributed_locks` | 分布式锁 | framework |
| `TableConfigHash` | `config_hashes` | 配置哈希 | config |
| `TablePrompt` | `prompts` | 提示词 | governance |
| `TablePromptVersion` | `prompt_versions` | 提示词版本 | governance |
| `TablePromptVersionMessage` | `prompt_version_messages` | 提示词版本消息 | governance |
| `TablePromptSession` | `prompt_sessions` | 提示词会话 | governance |
| `TablePromptSessionMessage` | `prompt_session_messages` | 提示词会话消息 | governance |
| `SessionsTable` | `sessions` | 会话 | auth |

---

## 8. Budget 关键字段

| 字段 | 中文 | 说明 |
|------|------|------|
| `Type` | 类型 | `governance`（默认）或 `billing` |
| `MaxLimit` | 最大限额 | 消费上限，单位美元 |
| `CurrentUsage` | 当前用量 | 已消费金额，单位美元 |
| `ResetDuration` | 重置周期 | 如 `"1d"`, `"1M"`, `"0"`（余额型，永不重置） |
| `LastReset` | 上次重置 | CurrentUsage 归零的时间 |
| `ExpiresAt` | 过期时间 | 一次性套餐的失效时间，nil=永不过期 |
| `OffPeakDiscount` | 非高峰折扣 | JSON 折扣规则，Deduct 时使用 |
| `TeamID` | 团队 ID | FK → governance_teams，治理+计费 |
| `VirtualKeyID` | 虚拟密钥 ID | FK → governance_virtual_keys，仅治理 |
| `ProviderConfigID` | 供应商配置 ID | FK → governance_virtual_key_provider_configs，仅治理 |
| `CustomerID` | 客户 ID | FK → governance_customers，治理+计费 |
| `UserID` | 用户 ID | FK → governance_users，治理+计费 |
| `UserScopeTeamID` | 用户作用域团队 | 仅 UserID!=nil 时有效，Budget 限定在该 Team 下 |
| `UserScopeCustomerID` | 用户作用域客户 | 仅 UserID!=nil 时有效，Budget 限定在该 Customer 下 |

**Owner 约束**：五选一（TeamID / VirtualKeyID / ProviderConfigID / CustomerID / UserID）
**Scope 约束**：UserScopeTeamID 与 UserScopeCustomerID 互斥
**Billing 约束**：billing 类型不允许挂 VK 或 ProviderConfig

---

## 9. 收集层级

### 治理路径（AND 检查）

Budget 和 RateLimit 共用同一条收集链：

```
ProviderConfig → VK → User → Team → Customer
```

### 计费路径（OR 混合扣费）

仅 Budget 有计费路径，RateLimit 无计费概念：

```
个人 VK: → User
组织 VK: → Team → Customer（不看 User）
```

### RateLimit 收集链

与治理 Budget 收集链一致（AND 检查）：

```
ProviderConfig → VK → User → Team → Customer
```

实现要点：
- User 层级通过 `TableUser.RateLimitID` 关联（1:1，与 Team/Customer 同模式）
- `collectRateLimitsFromHierarchy` 在 VK 之后、Team 之前插入 User 层级收集
- `TableRateLimit` 不加 FK 反指 User（1:1 不需要）

---

## 10. 充值类型汇总

| 类型 | 操作 | Budget 特征 | 生命周期 |
|------|------|------------|---------|
| 余额充值 | 首次创建/后续累加 MaxLimit | ResetDuration="0", ExpiresAt=nil | 永不过期 |
| 订阅型套餐 | 创建新 Budget | ResetDuration="0", ExpiresAt=now+周期 | 到期失效，续费创建新 Budget |
| 一次性套餐 | 创建新 Budget | ResetDuration="0", ExpiresAt=now+duration | 到期失效 |

---

## 11. 订单状态机

```
pending → success  （支付回调成功）
pending → failed   （支付回调失败）
pending → expired  （超时未支付）
pending → cancelled（用户取消）
```

---

## 12. 计费 API 端点

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/billing/recharge` | 创建充值订单 | 需 auth |
| POST | `/api/billing/purchases` | 创建套餐购买订单 | 需 auth |
| GET | `/api/billing/orders` | 查询订单列表 | 需 auth |
| GET | `/api/billing/orders/{orderId}` | 查询单个订单 | 需 auth |
| GET | `/api/billing/packages` | 查询可购买套餐列表 | 需 auth |
| GET | `/api/billing/packages/{packageId}` | 查询单个套餐详情 | 需 auth |
| POST | `/api/billing/packages` | 创建套餐商品 | admin |
| PUT | `/api/billing/packages/{packageId}` | 更新套餐商品 | admin |
| DELETE | `/api/billing/packages/{packageId}` | 删除套餐商品 | admin |
| GET | `/api/billing/entity-packages` | 查询已购套餐 | 需 auth |
| GET | `/api/billing/entity-packages/{epId}` | 查询单个实例 | 需 auth |
| POST | `/api/billing/webhook/stripe` | Stripe 回调 | 无 auth（签名验证） |
| POST | `/api/billing/admin/recharge` | 管理员手动充值 | admin |

---

## 13. 插件体系

| 英文 | 中文 | 定义 | 代码 |
|------|------|------|------|
| LLM Plugin | LLM 插件 | 请求生命周期钩子（PreHook/PostHook） | `PluginTypeLLM` |
| MCP Plugin | MCP 插件 | MCP 工具调用集成 | `PluginTypeMCP` |
| HTTP Plugin | HTTP 插件 | HTTP 传输层拦截 | `PluginTypeHTTP` |
| Governance Plugin | 治理插件 | 预算、限速、RBAC、路由 | `plugins/governance/` |
| Telemetry Plugin | 遥测插件 | Prometheus 指标 | `plugins/telemetry/` |
| Logging Plugin | 日志插件 | 请求/响应审计日志 | `plugins/logging/` |
| Semantic Cache Plugin | 语义缓存插件 | 基于向量存储的语义缓存 | `plugins/semanticcache/` |
| OTEL Plugin | OpenTelemetry 插件 | 分布式追踪 | `plugins/otel/` |
| Mocker Plugin | 模拟插件 | 测试用 Mock 响应 | `plugins/mocker/` |
| PreHook | 前置钩子 | 请求发送到 Provider 之前执行 | — |
| PostHook | 后置钩子 | Provider 响应后执行，顺序与 PreHook 相反（LIFO） | — |

---

## 14. 框架与存储

| 英文 | 中文 | 定义 | 代码 |
|------|------|------|------|
| ConfigStore | 配置存储 | 持久化存储后端（file/postgres） | `framework/configstore/` |
| LogStore | 日志存储 | 请求/响应日志存储后端 | `framework/logstore/` |
| VectorStore | 向量存储 | 语义缓存用向量数据库 | `framework/vectorstore/` |
| ModelCatalog | 模型目录 | 模型元数据注册表 | `framework/modelcatalog/` |
| Streaming | 流式处理 | SSE 流的累积、Delta 复制、响应序列化 | `framework/streaming/` |
| Accumulator | 累加器 | 将 SSE Chunk 累积为完整响应 | `framework/streaming/accumulator.go` |
| Pool | 对象池 | sync.Pool 包装，减少 GC 压力 | `core/pool/` |
| Provider Queue | 供应商队列 | 基于 channel 的请求路由，per-Provider 隔离 | `core/bifrost.go` |
| KVStore | KV 存储 | 集群间会话粘性/状态共享 | `BifrostConfig.KVStore` |
