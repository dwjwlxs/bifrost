# Platform 多租户接入方案

> **文档状态**：实施方案
> **最后更新**：2026-04-30
> **适用版本**：Bifrost v2.x
> **前置文档**：[platform-multi-tenant.md](./platform-multi-tenant.md)（v1 草案）

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
5. **在组织中协作**（管理员邀请/移除成员，按角色管控权限）

### 1.3 非目标

- 不改造 Bifrost 原有的 Workspace 管理员体系（保持向后兼容）
- 不实现完整的 RBAC 系统（那是 Enterprise SCIM 的职责）
- 不在 Bifrost 内部实现用户注册/密码管理（由外部账号系统负责）
- 不在推理路径引入 User 级别的预算/限流（VK 层已覆盖）

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

### 2.4 关键设计决策

以下决策在方案论证过程中产生，影响整体架构：

#### 决策 1：VK 所有权模型 — `UserID` 独立于 `TeamID`/`CustomerID`

**背景**：原草案中 `UserID` 与 `TeamID`/`CustomerID` 互斥。但实际场景中，用户创建 VK 时需要同时记录归属人和所属团队。

**决策**：`TeamID`/`CustomerID` 保持互斥（不变），`UserID` 独立于两者（新增）。一个 VK 可以同时有 `user_id` 和 `team_id`（或 `customer_id`）。

```
互斥规则：TeamID ⊕ CustomerID（二选一或都为空）
独立字段：UserID（可与上述任意一个共存）
```

**理由**：
- 一次查询 `WHERE user_id = ?` 即可获得用户名下所有 VK
- 退出组织/Team 时 `DELETE WHERE user_id = ? AND team_id = ?` 精确清理
- 用户在 Team 下的 VK 既属于用户也属于 Team，语义更准确

#### 决策 2：组复用 Team，不新建 Group 实体

**背景**：用户组（Group）概念与 Team 高度重叠——都需要 Budget、RateLimit、Profile、Config、Claims、RoutingRules。

**决策**：复用 `governance_teams` 作为"组"，新增 `platform_team_members` 表记录组成员关系。

**理由**：
- 新建 Group 需重复 Team 的全部字段和 resolver 层级检查逻辑（15+ 人天）
- 给 Team 加 membership 只需一张关联表 + 几个查询方法（约 3 人天）
- Workspace 侧 Team 仍按原样工作（无 members），Platform 侧 Team 既是 VK 分组也是用户组，两者共存不冲突

#### 决策 3：不引入 User 级预算/限流

**背景**：Enterprise 版预留了 `UserGovernance`（用户级 Budget/RateLimit），代码骨架已存在但 OSS 版为 NoOp。

**决策**：MVP 不激活 `EvaluateUserRequest`，不填充 `UserGovernance` 的 NoOp。

**理由**：
- 推理 API 走 VK 校验，预算/限流已在 VK → Team → Customer 层级实现
- `UserGovernance` 是为 Enterprise "User 替代 VK 直接调用推理 API" 设计的，我们的场景是用户通过 VK 调用
- VK 的 `user_id` 仅用于 Platform API 的数据隔离和 ownership 校验，不参与 governance resolver

#### 决策 4：RBAC 角色校验在中间件，一个 API 一个数据范围

**背景**：是否允许同一个 API 根据用户角色返回不同范围的数据？

**决策**：角色门控在中间件层完成，每个 API 端点服务一个确定的数据范围。不同角色访问不同数据子集时，使用不同的端点。

**理由**：
- 中间件层完成权限二选一（放行/拒绝），逻辑清晰可测试
- Handler 只做业务 CRUD，不混入角色判断
- 前端调用明确，无隐式行为
- 与 Bifrost 现有的 `lib.ChainMiddlewares` 模式一致

#### 决策 5：组织管理员由系统管理员指定

**背景**：C 端用户注册后如何建立组织？谁来当组织管理员？

**决策**：系统管理员（`is_admin`）通过 Platform Admin 页面创建组织并指定管理员。

**理由**：
- 组织是 Bifrost 网关的概念，不是外部账号系统的概念
- MVP 阶段不需要"用户自助创建组织"流程
- 系统管理员通过 JWT 中的 `is_admin` 标识识别，无需独立角色体系

#### 决策 6：JWT 由 Bifrost 登录端点签发，合并 claims

**背景**：外部账号系统只管用户身份（email/password），不知道组织和角色概念。

**决策**：登录端点作为"账号中间层"——调用外部账号服务验证凭据后，查询 membership 表，用 Bifrost 自己的密钥签发包含完整 claims 的 JWT。

**理由**：
- 不需要复杂的 JWT 重签发机制
- Bifrost 完全控制 JWT 内容，可在签发时注入 `org_id`、`org_admin`、`team_ids` 等 claims
- 外部账号系统保持无状态，不需要了解 Bifrost 的组织模型

---

## 3. 技术架构

### 3.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                       外部账号服务                             │
│  注册 / 登录 / 邮箱验证 / 密码重置（Bifrost 不负责）          │
└──────────────────────────┬───────────────────────────────────┘
                           │ 验证凭据
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  POST /api/platform/login（Bifrost 登录端点）                  │
│                                                              │
│  1. 调用外部账号服务验证凭据                                   │
│  2. 查询 platform_org_members  → org_id, org_admin           │
│  3. 查询 platform_team_members → team_ids, team_roles        │
│  4. 查询 platform_admins      → is_admin                     │
│  5. 合并 claims → 签发 Bifrost JWT                           │
└──────────────────────────┬───────────────────────────────────┘
                           │ JWT: { sub, email, is_admin,
                           │        orgs[], teams[], exp }
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Platform API (/api/platform/*)                               │
│                                                              │
│  ┌────────────────┐  中间件链  ┌──────────────────────────┐   │
│  │ AuthMiddleware  │──────────▶│ RoleMiddleware            │   │
│  │ (JWT 校验)      │          │ RequireAdmin             │   │
│  │ 提取 claims     │          │ RequireOrgAdmin          │   │
│  └────────────────┘          │ RequireTeamAdmin          │   │
│                               │ RequireTeamMember         │   │
│                               │ RequireVKOwner           │   │
│                               └──────────┬───────────────┘   │
│                                          │                   │
│  ┌──────────────┐  ┌───────────────┐  ┌──▼──────────────┐   │
│  │ Admin 路由    │  │ 组织/团队路由  │  │ 用户路由        │   │
│  │ is_admin     │  │ org_admin     │  │ VK CRUD         │   │
│  │ 创建/管理组织  │  │ team_admin   │  │ 用量查询        │   │
│  └──────────────┘  │ 邀请/移除成员  │  │ Profile         │   │
│                     └───────────────┘  └─────────────────┘   │
└──────────────────────────────────────────────────────────────┘
                           │ 推理 API 通过 VK
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Governance Plugin（不变）                                     │
│  VK → Team → Customer 预算/限流链                              │
│  VK.user_id 仅用于 Platform API 过滤                          │
│  不走 EvaluateUserRequest                                     │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 认证流程

```
Workspace 管理员流程（不变）:
  浏览器 → POST /api/session/login {username, password}
        → 验证 AdminUserName/AdminPassword
        → 创建 Session → Set-Cookie: token=xxx
        → 后续请求 Cookie 自动携带

Platform C 端用户流程（新增）:
  浏览器 → POST /api/platform/login {email, password}
        → 调用外部账号服务验证凭据
        → 查询 membership 表 + admins 表
        → 合并 claims → 签发 Bifrost JWT
        → 前端存储 platform_token
        → 后续请求 Authorization: Bearer <jwt>

推理 API 流程（不变）:
  客户端 → POST /v1/chat/completions
        → x-bf-vk: sk-bf-xxx  (由后端或代理注入)
        → Governance Plugin 校验 VK 权限
        → 路由到 Provider
```

### 3.3 RBAC 角色与权限矩阵

#### 角色定义

| 角色 | 来源 | 说明 |
|------|------|------|
| `is_admin` | `platform_admins` 表 | 系统管理员，可创建/管理组织 |
| `org_admin` | `platform_org_members.role='admin'` | 组织管理员，管理本组织所有 Team |
| `team_admin` | `platform_team_members.role='admin'` | 团队管理员，管理本 Team |
| `team_member` | `platform_team_members.role='member'` | 团队成员，只读权限 |

**隐含推导**：`org_admin` 自动拥有其组织下所有 Team 的 `team_admin` 权限。不需要在 `platform_team_members` 中重复插入 org_admin 的记录。

#### 权限矩阵

| 操作 | is_admin | org_admin | team_admin | team_member |
|------|:--------:|:---------:|:----------:|:-----------:|
| 创建/修改/查看组织 | ✅ | — | — | — |
| 查看组织内所有 Team | — | ✅ | — | — |
| 修改 Team 信息和预算 | — | ✅ 本组织所有 | ✅ 仅本 Team | ❌ |
| 查看 Team 内所有成员 | — | ✅ | ✅ | ✅ |
| 移除成员 | — | ✅ | ✅ | ❌ |
| 修改成员角色 | — | ✅ | ✅ | ❌ |
| 查看 Team 下所有 VK | — | ✅ | ✅ | ❌ |
| 修改 VK 预算 | — | ✅ | ✅ | ❌ |
| 邀请成员 | — | ✅ | ✅ | ❌ |
| 查看自己的 VK | ✅ | ✅ | ✅ | ✅ |

### 3.4 数据模型

#### 已有表（改动）

**governance_virtual_keys — 新增 `user_id` 字段**

```sql
ALTER TABLE governance_virtual_keys
  ADD COLUMN user_id VARCHAR(255);

CREATE INDEX idx_virtual_key_user_id
  ON governance_virtual_keys(user_id);
```

```go
type TableVirtualKey struct {
    // ... 现有字段 ...
    TeamID     *string `gorm:"type:varchar(255);index" json:"team_id,omitempty"`
    CustomerID *string `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`
    UserID     *string `gorm:"type:varchar(255);index" json:"user_id,omitempty"` // 新增
}
```

**BeforeSave 互斥规则修改**：

```go
// 互斥规则不变：TeamID 与 CustomerID 互斥
// UserID 独立于两者，不参与互斥判断
if vk.TeamID != nil && vk.CustomerID != nil {
    return fmt.Errorf("virtual key cannot belong to both team and customer")
}
```

#### 新增表

**platform_org_members — 组织-用户映射**

```sql
CREATE TABLE platform_org_members (
  org_id     VARCHAR(255) NOT NULL REFERENCES governance_customers(id) ON DELETE CASCADE,
  user_id    VARCHAR(255) NOT NULL,
  role       VARCHAR(20)  NOT NULL DEFAULT 'member',
  joined_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX idx_org_members_user ON platform_org_members(user_id);
```

**platform_team_members — 团队-用户映射**

```sql
CREATE TABLE platform_team_members (
  team_id    VARCHAR(255) NOT NULL REFERENCES governance_teams(id) ON DELETE CASCADE,
  user_id    VARCHAR(255) NOT NULL,
  role       VARCHAR(20)  NOT NULL DEFAULT 'member',
  joined_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX idx_team_members_user ON platform_team_members(user_id);
```

**platform_admins — 系统管理员**

```sql
CREATE TABLE platform_admins (
  user_id    VARCHAR(255) NOT NULL PRIMARY KEY,
  email      VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**platform_invitations — 邀请记录**

```sql
CREATE TABLE platform_invitations (
  id         VARCHAR(255) NOT NULL PRIMARY KEY,
  org_id     VARCHAR(255) REFERENCES governance_customers(id) ON DELETE CASCADE,
  team_id    VARCHAR(255) REFERENCES governance_teams(id) ON DELETE CASCADE,
  email      VARCHAR(255) NOT NULL,
  role       VARCHAR(20)  NOT NULL DEFAULT 'member',
  token      VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  accepted   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_invitations_email ON platform_invitations(email);
CREATE INDEX idx_invitations_token ON platform_invitations(token);
```

#### 实体关系

```
Customer (组织)
  ├── platform_org_members ──→ User
  ├── Team (组)
  │     ├── platform_team_members ──→ User
  │     └── VirtualKey (团队 VK)
  │           └── user_id (VK 归属人)
  └── VirtualKey (组织级 VK)
        └── user_id (VK 归属人)

platform_admins ──→ User (系统管理员)
platform_invitations ──→ email (待接受邀请)
```

### 3.5 JWT Claims 结构

```json
{
  "sub": "u-abc123",
  "email": "alice@example.com",
  "is_admin": false,
  "orgs": [
    { "id": "cust-1", "role": "admin" }
  ],
  "teams": [
    { "id": "team-1", "role": "admin" },
    { "id": "team-2", "role": "member" }
  ],
  "iat": 1746000000,
  "exp": 1746086400
}
```

**签发流程**：

1. 外部账号服务验证 email/password → 返回 `user_id`
2. Bifrost 登录端点查询 `platform_org_members` → 填充 `orgs`
3. 查询 `platform_team_members` → 填充 `teams`
4. 查询 `platform_admins` → 填充 `is_admin`
5. 用 Bifrost JWT 密钥签发完整 token

**角色变更生效**：角色变更后返回新 JWT，前端替换旧 token。MVP 不实现 token revocation list（Post-MVP 优化）。

### 3.6 中间件架构

```
请求 → AuthMiddleware(JWT) → RoleMiddleware(二选一) → Handler
                              ├── RequireAdmin
                              ├── RequireOrgAdmin
                              ├── RequireTeamAdmin
                              ├── RequireTeamMember
                              └── RequireVKOwner
```

**各中间件职责**：

| 中间件 | 检查逻辑 | 通过后设置 |
|--------|---------|-----------|
| `AuthMiddleware` | JWT 签名 + 过期时间 | `platform_user_id`, `platform_claims` |
| `RequireAdmin` | `claims.is_admin == true` | — |
| `RequireOrgAdmin` | `claims.orgs[i].id == :orgId && role == 'admin'` | `platform_resolved_role` |
| `RequireTeamAdmin` | `claims.IsTeamAdmin(:teamId)` 或 `claims.IsOrgAdmin(orgId)` | `platform_resolved_role` |
| `RequireTeamMember` | membership 存在（admin 也通过） | `platform_resolved_role` |
| `RequireVKOwner` | `vk.user_id == claims.UserID` | — |

**关键设计**：org_admin 隐含所有 Team 的 team_admin 权限。`RequireTeamAdmin` 中间件内部先检查 org_admin，再检查 team_admin。

---

## 4. API 设计

### 4.1 设计原则

1. **一个 API = 一个数据范围**：不同角色访问不同数据子集时，使用不同端点
2. **角色校验在中间件**：Handler 不做角色判断，只做 CRUD
3. **路由前缀隔离**：`/api/platform/admin/*`（系统管理员）、`/api/platform/orgs/*`（组织管理）、`/api/platform/teams/*`（团队管理）

### 4.2 系统管理员路由

| 方法 | 路由 | 中间件 | 说明 |
|------|------|--------|------|
| GET | `/api/platform/admin/orgs` | `RequireAdmin` | 全部组织列表 |
| POST | `/api/platform/admin/orgs` | `RequireAdmin` | 创建组织 |
| GET | `/api/platform/admin/orgs/:orgId` | `RequireAdmin` | 组织详情 |
| PUT | `/api/platform/admin/orgs/:orgId` | `RequireAdmin` | 修改组织 |
| DELETE | `/api/platform/admin/orgs/:orgId` | `RequireAdmin` | 删除组织 |

### 4.3 组织管理路由

| 方法 | 路由 | 中间件 | 说明 |
|------|------|--------|------|
| GET | `/api/platform/orgs` | `RequireAuth` | 自己所属的组织列表 |
| GET | `/api/platform/orgs/:orgId` | `RequireOrgMember` | 组织详情 |
| GET | `/api/platform/orgs/:orgId/teams` | `RequireOrgAdmin` | 本组织所有 Team |
| GET | `/api/platform/orgs/:orgId/members` | `RequireOrgAdmin` | 本组织所有成员 |

### 4.4 团队管理路由

| 方法 | 路由 | 中间件 | 说明 |
|------|------|--------|------|
| GET | `/api/platform/teams` | `RequireAuth` | 自己所属的 Team 列表 |
| GET | `/api/platform/teams/:teamId` | `RequireTeamMember` | Team 详情 |
| PUT | `/api/platform/teams/:teamId` | `RequireTeamAdmin` | 修改 Team 信息/预算 |
| GET | `/api/platform/teams/:teamId/members` | `RequireTeamMember` | 所有成员 |
| POST | `/api/platform/teams/:teamId/members` | `RequireTeamAdmin` | 邀请成员 |
| DELETE | `/api/platform/teams/:teamId/members/:uid` | `RequireTeamAdmin` | 移除成员 |
| PUT | `/api/platform/teams/:teamId/members/:uid` | `RequireTeamAdmin` | 修改角色 |

### 4.5 VK 路由

| 方法 | 路由 | 中间件 | 说明 |
|------|------|--------|------|
| GET | `/api/platform/virtual-keys` | `RequireAuth` | 仅自己的 VK |
| POST | `/api/platform/virtual-keys` | `RequireAuth` | 创建 VK（自动绑定 user_id） |
| GET | `/api/platform/virtual-keys/:vkId` | `RequireVKOwner` | VK 详情 |
| PUT | `/api/platform/virtual-keys/:vkId` | `RequireVKOwner` | 修改自己的 VK |
| DELETE | `/api/platform/virtual-keys/:vkId` | `RequireVKOwner` | 删除自己的 VK |
| GET | `/api/platform/teams/:teamId/virtual-keys` | `RequireTeamAdmin` | Team 下所有 VK |
| PUT | `/api/platform/teams/:teamId/virtual-keys/:vkId` | `RequireTeamAdmin` | 修改 Team 下 VK 的预算 |

### 4.6 用户路由

| 方法 | 路由 | 中间件 | 说明 |
|------|------|--------|------|
| GET | `/api/platform/profile` | `RequireAuth` | 当前用户信息 |
| POST | `/api/platform/login` | 无 | 登录（签发 JWT） |
| POST | `/api/platform/register` | 无 | 注册（调用外部账号服务） |
| POST | `/api/platform/invitations/:token/accept` | 无 | 接受邀请 |

### 4.7 Platform API 与 Governance API 的关系

```
/api/governance/virtual-keys     → 全量数据，Session/Cookie 认证
/api/platform/virtual-keys       → per-user 数据，JWT 认证
/api/platform/teams/:id/virtual-keys → per-team 数据，JWT + team_admin 认证

三者内部共享 configStore 的 VK 操作方法
区别：
  1. 认证方式不同（Session vs JWT）
  2. 数据范围不同（全量 vs per-user vs per-team）
  3. 权限模型不同（管理员 vs owner vs team_admin）
```

---

## 5. Epic / Story 拆解

### Epic 1: Platform 认证层

> 后端支持 C 端用户通过 JWT 登录，与 Workspace Session 认证隔离

**Story 1.1: Platform JWT 中间件**

| 项 | 内容 |
|---|------|
| **描述** | 在 `middlewares.go` 的 `APIMiddleware` 中，对 `/api/platform/` 路径使用 JWT 验证而非 Session 验证 |
| **验收标准** | ① 携带有效 JWT 的请求访问 `/api/platform/*` 返回 200；② 无 JWT 或 JWT 无效返回 401；③ `/api/session/*` 和 `/api/governance/*` 不受影响 |
| **改动文件** | `transports/bifrost-http/handlers/middlewares.go` |
| **实现要点** | 在 `middleware()` 函数中增加路径判断分支：`strings.HasPrefix(url, "/api/platform/")` 时走 JWT 验证逻辑；验证成功后将 `platform_user_id`、`platform_claims` 写入 `ctx.SetUserValue` |

**Story 1.2: Platform 登录端点（含 claims 合并）**

| 项 | 内容 |
|---|------|
| **描述** | 新增 `/api/platform/login` 端点，调用外部账号服务验证凭据后，查询 membership 表，签发包含完整 claims 的 JWT |
| **验收标准** | ① 登录成功返回 JWT；② JWT 包含 `sub`、`email`、`is_admin`、`orgs`、`teams` 声明；③ 无效凭据返回 401 |
| **改动文件** | 新增 `transports/bifrost-http/handlers/platform_auth.go` |
| **实现要点** | 使用 `golang-jwt/jwt/v5` 签发 ES256 JWT；claims 合并逻辑：查询 `platform_org_members` + `platform_team_members` + `platform_admins` |

**Story 1.3: JWT 配置与密钥管理**

| 项 | 内容 |
|---|------|
| **描述** | 在 `config.json` 中支持配置 JWT 密钥、过期时间、外部账号服务地址 |
| **验收标准** | ① `platform_auth.jwt_secret` 从环境变量读取；② 热更新密钥后旧 JWT 在过期前仍可用 |
| **改动文件** | `transports/config.schema.json`、`framework/configstore/` |

**Story 1.4: baseApi.ts 401 处理隔离**

| 项 | 内容 |
|---|------|
| **描述** | `baseApi.ts` 的全局 401 handler 对 `/platform/*` 路由不做清除 auth/重定向 |
| **验收标准** | ① Platform 页面 401 不跳转 `/login`；② Workspace 页面 401 仍跳转 `/login` |
| **改动文件** | `ui/lib/store/apis/baseApi.ts` |
| **实现要点** | 在 401 handler 中检测 `window.location.pathname.startsWith("/platform")`，若是则跳过 `clearAuthStorage()` 和重定向 |

---

### Epic 2: VK 所有权与数据隔离

> VK 绑定到 C 端用户，支持 per-user 数据隔离

**Story 2.1: 数据库 Migration**

| 项 | 内容 |
|---|------|
| **描述** | `governance_virtual_keys` 表新增 `user_id` 列，修改 BeforeSave 互斥规则 |
| **验收标准** | ① 列可为空（已有 VK 不受影响）；② 新建索引；③ `UserID` 不参与 `TeamID`/`CustomerID` 互斥判断 |
| **改动文件** | `framework/configstore/tables/virtualkey.go`、新增 migration 文件 |

**Story 2.2: VK 创建时绑定 user_id**

| 项 | 内容 |
|---|------|
| **描述** | Platform API 创建 VK 时自动从 JWT 中提取 `user_id` 并绑定；可选择同时绑定 `team_id` |
| **验收标准** | ① 通过 `/api/platform/virtual-keys` 创建的 VK 自动带 `user_id`；② 通过 `/api/governance/virtual-keys` 创建的 VK 不受影响 |
| **改动文件** | Platform VK handler、`framework/configstore/` VK 创建逻辑 |

**Story 2.3: VK 查询按 user_id 过滤**

| 项 | 内容 |
|---|------|
| **描述** | Platform API 查询 VK 列表时只返回当前用户的 VK |
| **验收标准** | ① `GET /api/platform/virtual-keys` 返回 `WHERE user_id = ?` 的结果；② Workspace 管理员仍可看到所有 VK |
| **改动文件** | `framework/configstore/` VK 查询逻辑 |

**Story 2.4: VK 操作 ownership 校验中间件**

| 项 | 内容 |
|---|------|
| **描述** | 实现 `RequireVKOwner` 中间件，更新/删除 VK 时校验操作者是 VK 的 owner |
| **验收标准** | ① 用户只能修改/删除自己的 VK；② 返回 403 而非 404（避免信息泄露） |
| **改动文件** | 新增 `transports/bifrost-http/handlers/platform_middlewares.go` |

---

### Epic 3: 组织与团队管理

> 组织/团队的成员管理、角色分配、邀请机制

**Story 3.1: 数据库 Migration（新增表）**

| 项 | 内容 |
|---|------|
| **描述** | 创建 `platform_org_members`、`platform_team_members`、`platform_admins`、`platform_invitations` 四张表 |
| **验收标准** | ① 表结构正确，外键约束生效；② 遵循 DROP-MODIFY-RECREATE 迁移策略 |
| **改动文件** | 新增 `framework/configstore/tables/platform_*.go`、migration 文件 |

**Story 3.2: Platform Admin API（组织 CRUD）**

| 项 | 内容 |
|---|------|
| **描述** | 实现系统管理员创建/查看/修改组织 API，创建时指定管理员 |
| **验收标准** | ① `POST /api/platform/admin/orgs` 创建组织 + 指定管理员；② `GET /api/platform/admin/orgs` 返回全部组织；③ 非 admin 用户访问返回 403 |
| **改动文件** | 新增 `transports/bifrost-http/handlers/platform_admin.go` |

**Story 3.3: Role Middleware 实现**

| 项 | 内容 |
|---|------|
| **描述** | 实现 `RequireAdmin`、`RequireOrgAdmin`、`RequireTeamAdmin`、`RequireTeamMember` 中间件 |
| **验收标准** | ① org_admin 自动通过 `RequireTeamAdmin`；② 无权限返回 403；③ claims 解析正确 |
| **改动文件** | 新增 `transports/bifrost-http/handlers/platform_middlewares.go` |

**Story 3.4: 组织管理 API**

| 项 | 内容 |
|---|------|
| **描述** | org_admin 查看组织内 Team 列表、成员列表 |
| **验收标准** | ① `GET /api/platform/orgs/:orgId/teams` 返回本组织 Team；② `GET /api/platform/orgs/:orgId/members` 返回本组织成员 |
| **改动文件** | 新增 `transports/bifrost-http/handlers/platform_org.go` |

**Story 3.5: 团队管理 API**

| 项 | 内容 |
|---|------|
| **描述** | team_admin 修改团队信息/预算、邀请/移除成员、修改角色 |
| **验收标准** | ① `PUT /api/platform/teams/:teamId` 修改团队；② `POST /api/platform/teams/:teamId/members` 邀请成员；③ `DELETE .../members/:uid` 移除成员；④ `PUT .../members/:uid` 修改角色 |
| **改动文件** | 新增 `transports/bifrost-http/handlers/platform_team.go` |

**Story 3.6: 邮箱邀请流程**

| 项 | 内容 |
|---|------|
| **描述** | 邀请成员时若邮箱未注册则发送邀请邮件，已注册则直接加入 |
| **验收标准** | ① 已注册用户直接成为成员；② 未注册用户收到邀请邮件 + token；③ 接受邀请后创建 membership 记录 |
| **改动文件** | `transports/bifrost-http/handlers/platform_team.go`、`platform_invitations` 处理逻辑 |

**Story 3.7: 移除成员级联清理**

| 项 | 内容 |
|---|------|
| **描述** | 移除组织成员时级联删除所有 team membership，移除 team 成员时可选删除该 team 下的 VK |
| **验收标准** | ① 删除 org membership → 级联删除所有 team membership；② 删除 team membership → 可选删除 `WHERE user_id = ? AND team_id = ?` 的 VK |
| **改动文件** | Platform handler、`framework/configstore/` |

---

### Epic 4: Platform 前端模块

> C 端用户独立的 Dashboard 界面

**Story 4.1: Platform 前端路由与布局**

| 项 | 内容 |
|---|------|
| **描述** | 在 `ui/app/platform/` 下创建独立的路由结构和布局 |
| **验收标准** | ① `/platform/login` — 登录页；② `/platform/home` — 首页/概览；③ `/platform/virtual-keys` — VK 管理页；④ 独立 sidebar，不显示 Provider/Config 等管理员功能 |
| **改动文件** | `ui/app/platform/` 目录下新增 layout、路由文件 |

**Story 4.2: Platform API 客户端**

| 项 | 内容 |
|---|------|
| **描述** | 创建独立的 `platformApi`（RTK Query），使用 JWT 而非 Cookie 认证 |
| **验收标准** | ① 请求自动附加 `Authorization: Bearer <platform_token>`；② 401 响应跳转到 `/platform/login`；③ 与 workspace 的 `baseApi` 完全隔离 |
| **改动文件** | 新增 `ui/lib/platform/platformApi.ts` |

**Story 4.3: 系统管理员组织管理页面**

| 项 | 内容 |
|---|------|
| **描述** | 系统管理员创建、查看、修改组织的页面 |
| **验收标准** | ① 组织列表页（含成员数、Team 数）；② 创建组织弹窗（名称 + 管理员邮箱）；③ 组织编辑页（名称、预算、限流） |
| **改动文件** | `ui/app/platform/admin/orgs/` 下新增页面组件 |

**Story 4.4: 组织/团队管理页面**

| 项 | 内容 |
|---|------|
| **描述** | org_admin 查看团队列表和成员；team_admin 管理成员和 VK |
| **验收标准** | ① 团队列表页（org_admin）；② 成员列表页（team_admin 可邀请/移除/改角色）；③ 团队 VK 列表页（team_admin 可修改预算） |
| **改动文件** | `ui/app/platform/orgs/`、`ui/app/platform/teams/` 下新增页面组件 |

**Story 4.5: VK 管理页面**

| 项 | 内容 |
|---|------|
| **描述** | VK 列表、创建、编辑、删除功能页面 |
| **验收标准** | ① 列表页展示当前用户的 VK 及状态；② 创建表单支持配置 provider、model 白名单、预算；③ 删除需二次确认；④ VK 值默认脱敏显示 |
| **改动文件** | `ui/app/platform/virtual-keys/` 下新增页面组件 |

**Story 4.6: 登录/注册页面**

| 项 | 内容 |
|---|------|
| **描述** | C 端用户的登录和邮箱验证注册流程 |
| **验收标准** | ① 登录页：邮箱 + 密码；② 注册页：邮箱 + 密码 → 验证码 → 激活；③ 登录成功后 JWT 存储到 localStorage 的 `platform_token` 键 |
| **改动文件** | `ui/app/platform/login/`、`ui/app/platform/register/` |

---

### Epic 5: 推理路径多租户集成

> C 端用户通过自己的 VK 调用推理 API

**Story 5.1: 后端代理 VK 注入**

| 项 | 内容 |
|---|------|
| **描述** | 在后端服务中，根据用户身份自动注入对应的 `x-bf-vk` header |
| **验收标准** | ① 用户请求推理 API 时自动携带自己的 VK；② VK 预算耗尽时返回 402 |
| **改动文件** | 后端代理服务（非 Bifrost 代码） |

**Story 5.2: 推理路径认证配置**

| 项 | 内容 |
|---|------|
| **描述** | 配置 `disable_auth_on_inference: true`，由代理层负责认证 |
| **验收标准** | ① 推理路径不要求 Basic Auth；② Dashboard 路径仍需认证 |
| **改动文件** | `config.json` |

---

## 6. 实施计划

### Sprint 1（2 周）：认证基础 + VK 所有权

| Story | 预估 | 优先级 |
|-------|------|--------|
| 1.1 Platform JWT 中间件 | 3d | P0 |
| 1.2 Platform 登录端点（含 claims 合并） | 3d | P0 |
| 1.3 JWT 配置与密钥管理 | 1d | P0 |
| 1.4 baseApi.ts 401 处理隔离 | 1d | P0 |
| 2.1 数据库 Migration（user_id） | 1d | P0 |
| 2.2 VK 创建时绑定 user_id | 1d | P0 |
| 2.3 VK 查询按 user_id 过滤 | 1d | P0 |
| 2.4 VK ownership 校验中间件 | 1d | P0 |

**里程碑**：C 端用户可以通过 JWT 登录，VK 支持 per-user 数据隔离。可通过 curl 测试 VK CRUD。

### Sprint 2（2 周）：组织与团队管理

| Story | 预估 | 优先级 |
|-------|------|--------|
| 3.1 数据库 Migration（新增表） | 1d | P0 |
| 3.2 Platform Admin API（组织 CRUD） | 2d | P0 |
| 3.3 Role Middleware 实现 | 2d | P0 |
| 3.4 组织管理 API | 1d | P0 |
| 3.5 团队管理 API | 3d | P0 |
| 3.6 邮箱邀请流程 | 2d | P1 |
| 3.7 移除成员级联清理 | 1d | P1 |

**里程碑**：Platform API 完整可用，可通过 curl/Postman 测试组织/团队/成员管理。

### Sprint 3（2 周）：前端模块

| Story | 预估 | 优先级 |
|-------|------|--------|
| 4.1 Platform 前端路由与布局 | 2d | P0 |
| 4.2 Platform API 客户端 | 1d | P0 |
| 4.3 系统管理员组织管理页面 | 2d | P0 |
| 4.4 组织/团队管理页面 | 3d | P0 |
| 4.5 VK 管理页面 | 3d | P0 |
| 4.6 登录/注册页面 | 2d | P0 |

**里程碑**：C 端用户可通过浏览器完成登录、管理组织/团队/ VK 的完整流程。

### Sprint 4（1 周）：推理路径集成 + 端到端测试

| Story | 预估 | 优先级 |
|-------|------|--------|
| 5.1 后端代理 VK 注入 | 2d | P0 |
| 5.2 推理路径认证配置 | 0.5d | P0 |
| 端到端集成测试 | 2d | P0 |

**里程碑**：C 端用户可通过自己的 VK 调用推理 API，预算/限流生效。

---

## 7. 关键技术细节

### 7.1 JWT 中间件实现

```go
// middlewares.go — 在 APIMiddleware 的 middleware() 中增加分支
if strings.HasPrefix(url, "/api/platform/") {
    // 白名单：login/register/invitation-accept 不需要 JWT
    if isPlatformPublicRoute(url) {
        next(ctx)
        return
    }
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
    ctx.SetUserValue("platform_claims", claims)
    next(ctx)
    return
}
```

### 7.2 Role Middleware 实现

```go
// RequireTeamAdmin — org_admin 隐含通过
func RequireTeamAdmin(next fasthttp.RequestHandler) fasthttp.RequestHandler {
    return func(ctx *fasthttp.RequestCtx) {
        claims := getPlatformClaims(ctx)
        teamID := ctx.UserValue("teamId").(string)
        // 查找 team 所属的 org
        orgID := getOrgIDForTeam(ctx, teamID)
        // org_admin 隐含 team_admin
        if claims.IsOrgAdmin(orgID) {
            ctx.SetUserValue("platform_resolved_role", "org_admin")
            next(ctx)
            return
        }
        if !claims.IsTeamAdmin(teamID) {
            SendError(ctx, 403, "Forbidden: team admin required")
            return
        }
        ctx.SetUserValue("platform_resolved_role", "team_admin")
        next(ctx)
    }
}
```

### 7.3 config.json 新增配置项

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

### 7.4 移除成员级联逻辑

```
移除组织成员:
  1. DELETE FROM platform_org_members WHERE org_id=? AND user_id=?
  2. DELETE FROM platform_team_members WHERE team_id IN (组织下所有 team) AND user_id=?
  3. （可选）DELETE FROM governance_virtual_keys WHERE user_id=? AND customer_id=?

移除团队成员:
  1. DELETE FROM platform_team_members WHERE team_id=? AND user_id=?
  2. （可选）DELETE FROM governance_virtual_keys WHERE user_id=? AND team_id=?

如果用户不再属于任何组织:
  3. 该用户创建的 VK（user_id 匹配但 team_id/customer_id 为空）保留
  4. 该用户在团队下的 VK 按上述规则清理
```

---

## 8. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| JWT 密钥泄露 | 全部 C 端用户身份伪造 | 低 | 密钥仅从环境变量读取，支持热轮换；使用 ES256 非对称算法，私钥不落盘 |
| VK user_id 过滤遗漏 | 用户看到他人数据 | 中 | 中间件层强制过滤，代码 review 重点检查，集成测试覆盖 |
| 外部账号服务不可用 | C 端用户无法登录 | 中 | 登录端点做超时降级，返回明确错误；不缓存外部凭据 |
| 角色变更后旧 JWT 仍有效 | 权限漂移 | 中 | MVP 接受（JWT 过期后刷新）；Post-MVP 加 token revocation |
| baseApi.ts 401 回归 | Platform 页面被重定向 | 中 | 单元测试覆盖 route-path detection 逻辑 |
| 数据库 migration 失败 | VK 表锁死 | 低 | 遵循 DROP-MODIFY-RECREATE 策略，加回滚脚本 |
| org_admin 隐含 team_admin 绕过 | 越权访问 | 低 | 中间件统一处理隐含关系，不在 handler 中重复判断 |

---

## 9. Post-MVP 路线图

| 阶段 | 功能 | 说明 |
|------|------|------|
| Phase 2 | Token revocation | JWT 黑名单，角色变更即时生效 |
| Phase 2 | 用量概览页面 | VK 级别的用量统计和预算消耗可视化 |
| Phase 2 | 用户自助创建组织 | C 端用户可直接创建组织（需审批或付费） |
| Phase 3 | API Key 级别的权限 | VK 的 provider/model 细粒度权限控制 |
| Phase 3 | 审计日志 | 组织/团队操作审计，满足合规需求 |
| Phase 3 | 多组织切换 | 用户属于多个组织时，前端支持组织切换 |

---

## 10. 参考文件索引

| 类别 | 文件 |
|------|------|
| 认证中间件 | `transports/bifrost-http/handlers/middlewares.go` |
| Session 处理 | `transports/bifrost-http/handlers/session.go` |
| VK 数据模型 | `framework/configstore/tables/virtualkey.go` |
| VK Handler | `transports/bifrost-http/handlers/governance.go` |
| Governance Plugin | `plugins/governance/main.go` |
| Governance Resolver | `plugins/governance/resolver.go` |
| Governance Store | `plugins/governance/store.go` |
| 前端 baseApi | `ui/lib/store/apis/baseApi.ts` |
| 前端 Governance API | `ui/lib/store/apis/governanceApi.ts` |
| 前端 Enterprise fallback | `ui/app/_fallbacks/enterprise/` |
| 配置 Schema | `transports/config.schema.json` |
| RBAC 文档 | `docs/enterprise/rbac.mdx` |
| Advanced Governance | `docs/enterprise/advanced-governance.mdx` |
