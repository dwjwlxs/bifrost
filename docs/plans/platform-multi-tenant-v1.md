# Platform 多租户接入方案

> **文档状态**：草案
> **最后更新**：2026-04-30  
> **适用版本**：Bifrost v2.x  

---

## 1. 需求背景

### 1.1 现状

Bifrost 是一个高性能 AI 网关，当前认证体系仅支持**单一管理员账号**（`admin_username` / `admin_password`），所有登录 Dashboard 的用户共享同一管理员权限，无法区分身份。

| 维度 | 当前状态 |
|------|---------|
| Dashboard 登录 | 单管理员账号，无用户概念 |
| Session 模型 | `SessionsTable` 仅存 `Token + ExpiresAt`，无 `user_id` |
| 推理路径认证 | `disable_auth_on_inference` 控制是否需要 Basic Auth |
| 租户隔离 | 仅通过 Virtual Key 的 Team/Customer 关联实现 |
| 自助注册 | 不支持 |
| RBAC | OSS 模式默认全部放行，Enterprise 通过 SCIM/IdP 实现 |

### 1.2 目标

接入**自有 C 端账号系统**（非标准 IdP），使 C 端用户能够：

1. **独立登录** Dashboard，身份与原管理员隔离
2. **自行管理 Virtual Key**（创建、查看、编辑、删除）
3. **查看自己的用量和预算**（不能看到其他用户的数据）
4. **使用推理 API**（通过自己的 VK 调用模型）

### 1.3 非目标

- 不改造 Bifrost 原有的 Workspace 管理员体系（保持向后兼容）
- 不实现完整的 RBAC 系统（那是 Enterprise SCIM 的职责）
- 不在 Bifrost 内部实现用户注册/密码管理（由外部账号系统负责）

---

## 2. 方案选型与决策过程

### 2.1 候选方案

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. Proxy + VK** | 反向代理验证用户身份，注入 `x-bf-vk` header | 零代码改动，原生支持 | Dashboard 仍单管理员，用户无法自助管理 VK |
| **B. SCIM/SSO** | 接入 Okta/Entra/Keycloak 等 IdP | 最完整的多租户方案 | 我们不是标准 IdP，且需 Enterprise license |
| **C. 自定义 Plugin** | 编写 LLMPlugin 实现自定义认证 | 灵活、可扩展 | 仅控制请求流，Dashboard 多用户登录需改核心代码 |
| **D. 双轨认证（Platform）** | 新增 `/platform/` 路由组 + JWT 认证 + VK 所有权绑定 | 兼顾 Dashboard 多用户与推理路径隔离 | 改动量最大 |

### 2.2 决策矩阵

| 需求 | A | B | C | D |
|------|---|---|---|---|
| C 端用户登录 Dashboard | ❌ | ✅ | ❌ | ✅ |
| 自助管理 VK | ❌ | ✅ | ❌ | ✅ |
| 非标准 IdP 接入 | ✅ | ❌ | ✅ | ✅ |
| 推理路径多租户隔离 | ✅ | ✅ | ✅ | ✅ |
| 无需 Enterprise license | ✅ | ❌ | ✅ | ✅ |
| 向后兼容 Workspace | ✅ | ✅ | ✅ | ✅ |

### 2.3 最终决策

**采用方案 D（双轨认证）+ 方案 A（推理路径 Proxy + VK 注入）的混合方案。**

理由：
- Dashboard 侧：方案 D 是唯一能满足"C 端用户登录 + 自管理 VK"的方案
- 推理路径：方案 A 是 Bifrost 原生设计就支持的零代码接入方式
- 两者通过 `user_id → VK ownership` 串联

**已有决策参考**（项目历史决策）：
- **Backend API Expansion Strategy**：新增路由用专用前缀（`/api/platform/...`），不修改原有路由
- **Shared Auth Logic Modification Constraint**：修改共享认证逻辑时，通过 route-path detection 隔离行为，不影响 workspace 路由
- **Database Migration Strategy**：采用显式 DROP-MODIFY-RECREATE 模式做 schema 变更

---

## 3. 技术架构

### 3.1 整体架构

```
                          ┌─────────────────────┐
                          │   C 端用户浏览器      │
                          └──────────┬──────────┘
                                     │
                          ┌──────────▼──────────┐
                          │  Platform Frontend   │
                          │  /platform/* (JWT)   │
                          └──────────┬──────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
   ┌──────────▼──────────┐          │           ┌──────────▼──────────┐
   │ /api/platform/*     │          │           │ /v1/chat/completions│
   │ JWT 认证             │          │           │ 推理 API            │
   │ user_id 隔离         │          │           │ x-bf-vk 注入       │
   └──────────┬──────────┘          │           └──────────┬──────────┘
              │                      │                      │
              │           ┌──────────▼──────────┐          │
              │           │ /api/governance/*    │          │
              │           │ Workspace 原有路由    │          │
              │           │ Session/Cookie 认证  │          │
              │           └─────────────────────┘          │
              │                                            │
   ┌──────────▼────────────────────────────────────────────▼──┐
   │                    Bifrost Gateway                        │
   │                                                           │
   │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
   │  │ Platform    │  │ Governance   │  │ Inference      │  │
   │  │ Middleware  │  │ Plugin       │  │ Handler        │  │
   │  │ (JWT)       │  │ (VK 校验)    │  │ (Provider 调用) │  │
   │  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘  │
   │         │                │                   │           │
   │  ┌──────▼────────────────▼───────────────────▼────────┐  │
   │  │              ConfigStore (数据库)                    │  │
   │  │  virtual_keys.user_id ←── 关联 C 端用户            │  │
   │  │  sessions             ←── Workspace 管理员          │  │
   │  └─────────────────────────────────────────────────────┘  │
   └───────────────────────────────────────────────────────────┘
              │
   ┌──────────▼──────────┐
   │  外部账号服务         │
   │  (注册/登录/邮箱验证) │
   │  签发 JWT            │
   └─────────────────────┘
```

### 3.2 认证流程对比

```
Workspace 管理员流程（不变）:
  浏览器 → POST /api/session/login {username, password}
        → 验证 AdminUserName/AdminPassword
        → 创建 Session → Set-Cookie: token=xxx
        → 后续请求 Cookie 自动携带

Platform C 端用户流程（新增）:
  浏览器 → POST /api/platform/login {email, password}
        → 调用外部账号服务验证
        → 签发 JWT {user_id, email, role}
        → 前端存储 platform_token
        → 后续请求 Authorization: Bearer <jwt>

推理 API 流程（不变）:
  客户端 → POST /v1/chat/completions
        → x-bf-vk: sk-bf-xxx  (由后端或代理注入)
        → Governance Plugin 校验 VK 权限
        → 路由到 Provider
```

### 3.3 数据模型变更

**Virtual Key 增加 user_id 字段：**

```sql
-- 新增列
ALTER TABLE governance_virtual_keys
  ADD COLUMN user_id VARCHAR(255);

CREATE INDEX idx_virtual_key_user_id
  ON governance_virtual_keys(user_id);
```

```go
// TableVirtualKey 新增字段
type TableVirtualKey struct {
    // ... 现有字段 ...
    UserID *string `gorm:"type:varchar(255);index" json:"user_id,omitempty"` // 新增：关联 C 端用户
}
```

**互斥关系**：`TeamID`/`CustomerID` 互斥，`UserID`独立，一个 VK 可以同时归属于用户和“团队或客户”。

---

## 4. Epic / Story 拆解

### Epic 1: Platform 认证层

> 后端支持 C 端用户通过 JWT 登录，与 Workspace Session 认证隔离

**Story 1.1: Platform JWT 中间件**

| 项 | 内容 |
|---|------|
| **描述** | 在 `middlewares.go` 的 `APIMiddleware` 中，对 `/api/platform/` 路径使用 JWT 验证而非 Session 验证 |
| **验收标准** | ① 携带有效 JWT 的请求访问 `/api/platform/*` 返回 200<br>② 无 JWT 或 JWT 无效返回 401<br>③ `/api/session/*` 和 `/api/governance/*` 不受影响 |
| **改动文件** | `transports/bifrost-http/handlers/middlewares.go` |
| **实现要点** | 在 `middleware()` 函数中增加路径判断分支：`strings.HasPrefix(url, "/api/platform/")` 时走 JWT 验证逻辑；验证成功后将 `platform_user_id` 写入 `ctx.SetUserValue` |

**Story 1.2: Platform 登录/注册端点**

| 项 | 内容 |
|---|------|
| **描述** | 新增 `/api/platform/login` 和 `/api/platform/register` 端点，对接外部账号系统 |
| **验收标准** | ① 登录成功返回 JWT<br>② 注册成功触发邮箱验证流程<br>③ JWT 包含 `user_id`、`email`、`role` 声明 |
| **改动文件** | 新增 `transports/bifrost-http/handlers/platform_auth.go` |
| **实现要点** | 登录端点调用外部账号服务验证凭据 → 签发 JWT；注册端点调用外部账号服务创建用户 → 发送验证码。JWT 密钥通过 `config.json` 或环境变量配置 |

**Story 1.3: JWT 配置与密钥管理**

| 项 | 内容 |
|---|------|
| **描述** | 在 `config.json` 中支持配置 JWT 密钥、过期时间等参数 |
| **验收标准** | ① `platform_auth.jwt_secret` 从环境变量读取<br>② 热更新密钥后旧 JWT 在过期前仍可用 |
| **改动文件** | `transports/config.schema.json`、`framework/configstore/` |

**Story 1.4: baseApi.ts 401 处理隔离**

| 项 | 内容 |
|---|------|
| **描述** | `baseApi.ts` 的全局 401 handler 对 `/platform/*` 路由不做清除 auth/重定向，让 Platform 前端自行处理 |
| **验收标准** | ① Platform 页面 401 不跳转 `/login`<br>② Workspace 页面 401 仍跳转 `/login` |
| **改动文件** | `ui/lib/store/apis/baseApi.ts` |
| **实现要点** | 在 401 handler 中检测 `window.location.pathname.startsWith("/platform")`，若是则跳过 `clearAuthStorage()` 和重定向 |

---

### Epic 2: Virtual Key 所有权

> VK 绑定到 C 端用户，支持 per-user 数据隔离

**Story 2.1: 数据库 Migration**

| 项 | 内容 |
|---|------|
| **描述** | `governance_virtual_keys` 表新增 `user_id` 列 |
| **验收标准** | ① 列可为空（已有 VK 不受影响）<br>② 新建索引<br>③ 遵循 DROP-MODIFY-RECREATE 迁移策略 |
| **改动文件** | `framework/configstore/tables/virtualkey.go`、新增 migration 文件 |

**Story 2.2: VK 创建时绑定 user_id**

| 项 | 内容 |
|---|------|
| **描述** | Platform API 创建 VK 时自动从 JWT 中提取 `user_id` 并绑定 |
| **验收标准** | ① 通过 `/api/platform/virtual-keys` 创建的 VK 自动带 `user_id`<br>② 通过 `/api/governance/virtual-keys` 创建的 VK 不受影响（`user_id` 为空） |
| **改动文件** | `framework/configstore/` VK 创建逻辑 |

**Story 2.3: VK 查询按 user_id 过滤**

| 项 | 内容 |
|---|------|
| **描述** | Platform API 查询 VK 列表时只返回当前用户的 VK |
| **验收标准** | ① 用户 A 看不到用户 B 的 VK<br>② Workspace 管理员仍可看到所有 VK |
| **改动文件** | `framework/configstore/` VK 查询逻辑 |

**Story 2.4: VK 操作 ownership 校验**

| 项 | 内容 |
|---|------|
| **描述** | 更新/删除 VK 时校验操作者是 VK 的 owner 或管理员 |
| **验收标准** | ① 用户只能修改/删除自己的 VK<br>② 返回 403 而非 404（避免信息泄露） |
| **改动文件** | Platform VK 操作 handler |

---

### Epic 3: Platform API 路由

> 新增 `/api/platform/` 路由组，提供 C 端用户受限的 Governance 能力

**Story 3.1: Platform 路由注册**

| 项 | 内容 |
|---|------|
| **描述** | 新增 `/api/platform/` 路由组，挂载 Platform JWT 中间件 |
| **验收标准** | ① 所有 `/api/platform/*` 路由受 JWT 保护<br>② 不影响原有 `/api/governance/*` 路由 |
| **改动文件** | 新增 `transports/bifrost-http/handlers/platform.go`，修改路由注册入口 |

**Story 3.2: Platform VK CRUD API**

| 项 | 内容 |
|---|------|
| **描述** | 提供受限的 VK 管理 API |
| **验收标准** | ① `GET /api/platform/virtual-keys` — 列出当前用户的 VK<br>② `POST /api/platform/virtual-keys` — 创建 VK（自动绑定 user_id）<br>③ `PUT /api/platform/virtual-keys/:id` — 更新自己的 VK<br>④ `DELETE /api/platform/virtual-keys/:id` — 删除自己的 VK |
| **改动文件** | 新增 `transports/bifrost-http/handlers/platform_vk.go` |
| **实现要点** | 内部复用 `configStore` 的 VK 操作方法，但增加 ownership 校验和 user_id 过滤；不修改 Governance 原有 handler |

**Story 3.3: Platform 用量查询 API**

| 项 | 内容 |
|---|------|
| **描述** | 提供当前用户 VK 的用量/预算/限流信息查询 |
| **验收标准** | ① `GET /api/platform/usage` — 返回当前用户所有 VK 的用量汇总<br>② `GET /api/platform/virtual-keys/:id/quota` — 返回指定 VK 的预算和限流状态 |
| **改动文件** | 新增 `transports/bifrost-http/handlers/platform_usage.go` |

**Story 3.4: Platform 用户信息 API**

| 项 | 内容 |
|---|------|
| **描述** | 提供当前登录用户的基本信息 |
| **验收标准** | ① `GET /api/platform/profile` — 返回 user_id, email, role<br>② `POST /api/platform/logout` — 清除 JWT（可选，JWT 无状态时可为 no-op） |
| **改动文件** | `transports/bifrost-http/handlers/platform_auth.go` |

---

### Epic 4: Platform 前端模块

> C 端用户独立的 Dashboard 界面

**Story 4.1: Platform 前端路由与布局**

| 项 | 内容 |
|---|------|
| **描述** | 在 `ui/app/platform/` 下创建独立的路由结构和布局 |
| **验收标准** | ① `/platform/login` — 登录页<br>② `/platform/home` — 首页/概览<br>③ `/platform/virtual-keys` — VK 管理页<br>④ 独立的 sidebar，不显示 Provider/Config 等管理员功能 |
| **改动文件** | `ui/app/platform/` 目录下新增 layout、路由文件 |

**Story 4.2: Platform API 客户端**

| 项 | 内容 |
|---|------|
| **描述** | 创建独立的 `platformApi`（RTK Query），使用 JWT 而非 Cookie 认证 |
| **验收标准** | ① 请求自动附加 `Authorization: Bearer <platform_token>`<br>② 401 响应跳转到 `/platform/login`<br>③ 与 workspace 的 `baseApi` 完全隔离 |
| **改动文件** | 新增 `ui/lib/platform/platformApi.ts` |

**Story 4.3: VK 管理页面**

| 项 | 内容 |
|---|------|
| **描述** | VK 列表、创建、编辑、删除功能页面 |
| **验收标准** | ① 列表页展示当前用户的 VK 及状态<br>② 创建表单支持配置 provider、model 白名单、预算<br>③ 编辑表单预填现有配置<br>④ 删除需二次确认<br>⑤ VK 值默认脱敏显示，可点击查看 |
| **改动文件** | `ui/app/platform/virtual-keys/` 下新增页面组件 |

**Story 4.4: 用量概览页面**

| 项 | 内容 |
|---|------|
| **描述** | 展示当前用户所有 VK 的用量统计和预算消耗 |
| **验收标准** | ① 总调用量、Token 消耗、费用汇总<br>② 各 VK 的预算使用进度条<br>③ 速率限制状态提示 |
| **改动文件** | `ui/app/platform/home/` 或 `ui/app/platform/usage/` |

**Story 4.5: 登录/注册页面**

| 项 | 内容 |
|---|------|
| **描述** | C 端用户的登录和邮箱验证注册流程 |
| **验收标准** | ① 登录页：邮箱 + 密码<br>② 注册页：邮箱 + 密码 → 发送验证码 → 输入验证码 → 激活<br>③ 登录成功后 JWT 存储到 localStorage 的 `platform_token` 键 |
| **改动文件** | `ui/app/platform/login/`、`ui/app/platform/register/` |

---

### Epic 5: 推理路径多租户集成

> C 端用户通过自己的 VK 调用推理 API

**Story 5.1: 后端代理 VK 注入**

| 项 | 内容 |
|---|------|
| **描述** | 在你的后端服务中，根据用户身份自动注入对应的 `x-bf-vk` header |
| **验收标准** | ① 用户请求推理 API 时自动携带自己的 VK<br>② VK 预算耗尽时返回 402 而非透传到 Provider |
| **改动文件** | 你的后端代理服务（非 Bifrost 代码） |

**Story 5.2: 推理路径认证配置**

| 项 | 内容 |
|---|------|
| **描述** | 配置 `disable_auth_on_inference: true`，由代理层负责认证 |
| **验收标准** | ① 推理路径不要求 Basic Auth<br>② Dashboard 路径仍需认证 |
| **改动文件** | `config.json` |

---

## 5. 实施计划

### Sprint 1（2 周）：认证基础

| Story | 预估 | 优先级 |
|-------|------|--------|
| 1.1 Platform JWT 中间件 | 3d | P0 |
| 1.2 Platform 登录/注册端点 | 3d | P0 |
| 1.3 JWT 配置与密钥管理 | 1d | P0 |
| 1.4 baseApi.ts 401 处理隔离 | 1d | P0 |

**里程碑**：C 端用户可以通过 JWT 登录 Bifrost，但尚无可访问的功能页面。

### Sprint 2（2 周）：VK 所有权 + Platform API

| Story | 预估 | 优先级 |
|-------|------|--------|
| 2.1 数据库 Migration | 1d | P0 |
| 2.2 VK 创建时绑定 user_id | 1d | P0 |
| 2.3 VK 查询按 user_id 过滤 | 1d | P0 |
| 2.4 VK 操作 ownership 校验 | 1d | P0 |
| 3.1 Platform 路由注册 | 1d | P0 |
| 3.2 Platform VK CRUD API | 3d | P0 |
| 3.3 Platform 用量查询 API | 2d | P1 |
| 3.4 Platform 用户信息 API | 0.5d | P0 |

**里程碑**：Platform API 完整可用，可通过 curl/Postman 测试全部功能。

### Sprint 3（2 周）：前端模块

| Story | 预估 | 优先级 |
|-------|------|--------|
| 4.1 Platform 前端路由与布局 | 2d | P0 |
| 4.2 Platform API 客户端 | 1d | P0 |
| 4.3 VK 管理页面 | 3d | P0 |
| 4.4 用量概览页面 | 2d | P1 |
| 4.5 登录/注册页面 | 2d | P0 |

**里程碑**：C 端用户可通过浏览器完成登录、管理 VK、查看用量的完整流程。

### Sprint 4（1 周）：推理路径集成 + 端到端测试

| Story | 预估 | 优先级 |
|-------|------|--------|
| 5.1 后端代理 VK 注入 | 2d | P0 |
| 5.2 推理路径认证配置 | 0.5d | P0 |
| 端到端集成测试 | 2d | P0 |

**里程碑**：C 端用户可通过自己的 VK 调用推理 API，预算/限流生效。

---

## 6. 关键技术细节

### 6.1 JWT 中间件实现要点

```go
// 在 middlewares.go 的 middleware() 中增加分支
if strings.HasPrefix(url, "/api/platform/") {
    scheme, token, ok := strings.Cut(authorization, " ")
    if !ok || scheme != "Bearer" {
        SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
        return
    }
    claims, err := validatePlatformJWT(token)
    if err != nil {
        SendError(ctx, fasthttp.StatusUnauthorized, "Invalid token")
        return
    }
    ctx.SetUserValue("platform_user_id", claims.UserID)
    ctx.SetUserValue("platform_user_email", claims.Email)
    next(ctx)
    return
}
```

**注意**：遵循 **Shared Auth Logic Modification Constraint** — 通过 route-path detection 隔离，不修改 workspace 的认证逻辑。

### 6.2 VK 所有权校验模式

```go
// Platform VK 操作的 ownership 校验
func (h *PlatformHandler) validateVKOwnership(ctx *fasthttp.RequestCtx, vkID string) (bool, error) {
    userID := ctx.UserValue("platform_user_id").(string)
    vk, err := h.configStore.GetVirtualKey(ctx, vkID)
    if err != nil {
        return false, err
    }
    if vk.UserID == nil || *vk.UserID != userID {
        return false, nil  // 返回 403
    }
    return true, nil
}
```

### 6.3 Platform API 与 Governance API 的关系

```
/api/governance/virtual-keys     → 全量数据，管理员权限
/api/platform/virtual-keys       → 按 user_id 过滤，C 端用户权限

两者内部共享 configStore 的 VK 操作方法
区别仅在于：
  1. 认证方式不同（Session vs JWT）
  2. 数据过滤不同（全量 vs per-user）
  3. 操作范围不同（全局 vs owned-only）
```

### 6.4 config.json 新增配置项

```json
{
  "platform_auth": {
    "enabled": true,
    "jwt_secret": "env.PLATFORM_JWT_SECRET",
    "jwt_expiry": "24h",
    "external_auth_url": "https://auth.example.com",
    "external_auth_api_key": "env.AUTH_SERVICE_API_KEY"
  }
}
```

---

## 7. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| JWT 密钥泄露 | 全部 C 端用户身份伪造 | 低 | 密钥仅从环境变量读取，支持热轮换 |
| VK user_id 过滤遗漏 | 用户看到他人数据 | 中 | 代码 review 重点检查，集成测试覆盖 |
| 外部账号服务不可用 | C 端用户无法登录 | 中 | 登录端点做超时降级，返回明确错误 |
| baseApi.ts 401 回归 | Platform 页面被重定向 | 中 | 单元测试覆盖 route-path detection 逻辑 |
| 数据库 migration 失败 | VK 表锁死 | 低 | 遵循 DROP-MODIFY-RECREATE 策略，加回滚脚本 |

---

## 8. 参考文件索引

| 类别 | 文件 |
|------|------|
| 认证中间件 | `transports/bifrost-http/handlers/middlewares.go` |
| Session 处理 | `transports/bifrost-http/handlers/session.go` |
| VK 数据模型 | `framework/configstore/tables/virtualkey.go` |
| VK Handler | `transports/bifrost-http/handlers/governance.go` |
| Governance Plugin | `plugins/governance/main.go` |
| 前端 baseApi | `ui/lib/store/apis/baseApi.ts` |
| 前端 Governance API | `ui/lib/store/apis/governanceApi.ts` |
| 配置 Schema | `transports/config.schema.json` |
| VK 文档 | `docs/features/governance/virtual-keys.mdx` |
| Required Headers 文档 | `docs/features/governance/required-headers.mdx` |
| SCIM 文档 | `docs/enterprise/user-provisioning.mdx` |
| RBAC 文档 | `docs/enterprise/rbac.mdx` |
