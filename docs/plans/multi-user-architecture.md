# Bifrost Multi-User Architecture Refactor — Implementation Plan

> **Goal:** Unify Bifrost's auth into a single multi-user system where users own
> Virtual Keys, admins get full dashboard access, and self-service registration
> enables an OpenRouter.ai-style product.

---

## 设计理念：虚拟组织模式

### 核心思想

**个人账号与组织账号统一实现**的关键在于"虚拟组织模式"：

- 每个用户注册时自动创建一个**虚拟 Customer**（个人空间）
- 用户自动成为该虚拟 Customer 的 **customer_owner**
- 个人用户和组织用户使用**完全相同的数据结构和业务逻辑**
- 无需区分"这是个人用户还是组织用户"

### 与 GitHub 的对照

| GitHub | Bifrost | 说明 |
|--------|---------|------|
| User (个人账号) | User | 独立身份，可存在于多个组织 |
| Personal Account | 虚拟 Customer | 每个用户自动拥有，单人"组织" |
| Organization | Customer | 真实组织，多人协作 |
| Team | Team | 组织内的团队划分 |
| Repository | Virtual Key | 核心资源，归属到组织/团队 |
| Collaborator | Team Member | 通过团队身份获得访问权限 |
| Owner/Admin/Member | customer_owner/team_admin/team_member | 角色权限 |

### 用户级加入

用户可以同时属于多个组织/团队，通过角色获得不同的访问权限：

```
┌─────────────────────────────────────────────────────────────────┐
│                        User (用户身份)                           │
│  ID: 42, Username: "zhangsan", Email: "zhang@example.com"       │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  虚拟 Customer   │ │   Team A (前端)  │ │   Team B (后端)  │
│  "personal-42"  │ │   Customer: 公司  │ │   Customer: 公司  │
│                 │ │                 │ │                 │
│  Role:          │ │  Role:          │ │  Role:          │
│  customer_owner │ │  team_member    │ │  team_admin     │
│                 │ │                 │ │                 │
│  VK: my-key-1   │ │  VK: frontend   │ │  VK: backend    │
│  VK: my-key-2   │ │  VK: test-key   │ │  VK: prod-key   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

**关键点**：张三同时存在于三个"组织"中，但角色不同！

### 统一实现的优势

1. **数据模型统一**：User + Customer/Team + VK 三表结构，一套代码两种场景
2. **业务逻辑统一**：RBAC 角色 + 组织归属，不需要 if/else 判断用户类型
3. **用户体验统一**：个人空间 = 虚拟组织，界面一致，操作一致
4. **扩展性好**：个人用户升级为组织用户时，只需把虚拟 Customer 变成真实 Customer，邀请成员加入即可

### 使用旅程（User Journey）

**阶段1：个人开发者**
```
1. 注册 Bifrost 账号
2. 系统自动创建虚拟 Customer "personal-42"
3. 用户成为 customer_owner
4. 创建个人 VK，用于个人项目
5. 体验：完全自助，无需审批
```

**阶段2：加入公司**
```
1. 收到公司邀请加入 Team "frontend"
2. 角色变为 team_member
3. 可以看到团队 VK，用于工作项目
4. 个人 VK 仍然存在，用于个人项目
5. 体验：无缝切换，两种用途并存
```

**阶段3：晋升为团队管理员**
```
1. 角色升级为 team_admin
2. 可以为团队创建新 VK
3. 可以管理团队成员
4. 体验：权限渐进式扩展
```

**阶段4：独立创业**
```
1. 创建自己的 Customer "zhang-corp"
2. 成为 customer_owner
3. 邀请员工加入
4. 分配预算
5. 体验：从个人到组织，平滑过渡
```

### Epic/Story/Task 拆解

**Epic: Multi-User Architecture Refactor**
> 目标: 将 Bifrost 从"管理员分发式"改造为"个人自助式"架构

**Story 1: 用户认证系统**
> 作为用户，我可以通过多种方式注册和登录 Bifrost
- Tasks: User + Identity 数据模型、AuthProvider 接口、密码认证、注册/登录 API、JWT Token 管理

**Story 2: 个人空间**
> 作为注册用户，我拥有一个个人空间，可以管理自己的 VK
- Tasks: 注册时自动创建虚拟 Customer、用户自动成为 customer_owner、个人 VK CRUD API、个人仪表板页面

**Story 3: 组织管理**
> 作为组织管理员，我可以创建和管理组织
- Tasks: Customer CRUD API、Team CRUD API、成员邀请流程、成员角色管理、组织管理页面

**Story 4: RBAC 权限控制**
> 作为系统，我需要根据用户角色控制资源访问权限
- Tasks: 预置角色和权限矩阵、权限检查中间件、VK 可见性过滤、自定义角色（Phase 2）

**Story 5: 前端集成**
> 作为用户，我可以通过 Web 界面管理我的资源
- Tasks: 用户仪表板、VK 管理页面、组织管理页面、团队管理页面

---

## 一句话需求

将Bifrost 从"管理员分发式"架构改造为"个人自助式"架构，支持用户自主注册、创建 VK、管理预算，同时保留组织层级预算控制能力，并确保认证系统可扩展以对接公司账号系统和第三方登录。


### 子需求

1. **VK 归属改造**

要求：
- VK 必须关联到 Team 或 Customer（不再绑定个人用户）
- VK 创建时必须指定 TeamID 或 CustomerID（二选一）
- Team Member 只能查看 Team 内所有 VK
- Team Admin 可以管理 Team 内所有 VK（CRUD）
- Customer Owner 可以管理本组织所有 VK（CRUD）
- Admin（系统管理员）可以看到所有 VK



2. **保留 Team/Customer 层级预算控制**

要求：
- Team/Customer 保留，作为组织级预算分配的载体
- Customer（组织）→ Team（团队）→ VK 三层预算继承
- 各层级预算可选，配置了才生效
- 请求通过条件：所有配置了预算的层级，余额必须 > 0
- 请求完成后：所有配置了预算的层级都独立扣除消耗量
- 管理员可以在 Customer/Team 层面分配和控制预算
- VK 预算可选，配置了才生效



3. **RBAC 权限系统**

要求：
- 不能简化为 is_admin 字段，需要完整的 RBAC 模块
- 预置 4 个系统角色：admin、customer_owner、team_admin、team_member
- 不需要 user 角色，个人用户使用虚拟组织模式
- 每个角色有明确的权限边界和作用域
- 支持组织自定义角色（Phase 2）：组织可以定义自己的角色和权限组合
- 权限格式：resource:action（如 virtual_key:create、user:invite）
- 权限检查必须覆盖所有敏感 API



4. **组织和个人使用流程**

要求：

组织流程：
- 管理员创建 Customer（组织），分配全局预算
- 管理员创建 Team（团队），分配团队预算
- 管理员邀请成员加入 Team（通过邮箱/邀请链接）
- 管理员可管理成员角色和权限
- Team Admin 可以创建 VK（归属 Team）

个人流程（单人用户）：
- 用户注册时自动创建虚拟 Customer
- 用户自动成为虚拟 Customer 的 customer_owner
- VK 绑定到虚拟 Customer
- 不需要 JWT，直接用 VK 调用 API
- 用户可查看个人用量和预算



5. **认证解耦（支持外部账号系统）**

要求：
- 认证与授权分离：账号创建/认证可委托给外部系统，Bifrost 只负责授权
- User + Identity 分离设计：一个用户可关联多种登录方式
- 支持的认证方式：
  - 内置密码认证（默认，必须）
  - 公司账号系统集成（OIDC/SAML，预留接口）
  - GitHub OAuth（可选）
  - 微信登录（可选）
  - 其他扩展（钉钉、飞书、LDAP 等）
- AuthProvider 接口化：新增认证方式只需实现接口，无需修改核心逻辑
- 配置驱动：通过 config.json 启用/禁用认证方式
- 自动创建用户：外部系统首次登录自动创建 Bifrost 用户
- 账号关联：已登录用户可绑定/解绑多种登录方式



6. **前端界面**

要求：
用户面板：
- 我的 VK 列表（按角色和归属过滤）
- VK 用量统计
- 已绑定的登录方式管理

管理员面板：
- 用户管理（列表、角色分配、封禁）
- 组织管理（Customer、Team、成员、预算）
- 角色管理（预置角色展示、自定义角色 CRUD）
- VK 管理（支持按 team/customer 过滤）



## 1. 为什么 VK 当前关联 Team/Customer？

### 原始设计理念：企业多租户架构

```
Customer（企业客户）
  └── Team（部门/项目组）
        └── VK（团队凭证）→ 管理员创建，分配给团队使用
```

**核心逻辑：**
- **Customer** = 企业客户，购买 Bifrost 部署
- **Team** = 部门/项目组，部门内部的资源隔离
- **VK** = 团队凭证，管理员创建后分配给团队共享使用

**层级预算体系：**
```
Customer Budget（公司级预算）
  └── Team Budget（团队级预算）
        └── VK Budget（可选，更细粒度限流）
```

**应用场景：**
- 某公司购买 Bifrost 作为内部 API 网关
- 管理员为"AI 研发部"创建 Team，设置月度预算 $10,000
- 为"测试团队"创建 Team，设置更低预算
- 研发部的 VK 只能用 OpenAI/Anthropic，测试团队只能用免费模型
- 员工只拿到 VK，不需要自己创建，也没有自助面板

**总结：Bifrost 原生设计是管理员分发式，不是个人自助式。**

### 为什么需要改造？

当前架构的问题：
1. **无个人身份** — 员工无 User 账号，无法追踪个人使用情况
2. **VK 共享** — 团队共用 VK，无法区分谁在用、用量多少
3. **无自助能力** — 员工无法创建自己的 VK、查看个人用量
4. **权限粗糙** — is_admin 二元开关，无法支持组织自定义 RBAC

---

## 2. 改造目标：User 优先 + 保留层级预算

### 核心原则

1. **VK 关联到 Team/Customer** — VK 只归属组织层级，不绑定个人用户
2. **User 通过组织归属获得 VK 访问权限** — Team Member 可查看 Team 内所有 VK
3. **保留 Team/Customer 预算控制** — 承载组织级预算分配
4. **各层级预算可选** — 配置了才检查和扣除
5. **组织可自定义 RBAC** — 不只是 is_admin
6. **认证解耦** — 账号创建/认证可委托给外部系统，支持第三方登录

### 推荐架构：VK → Team/Customer，User 通过组织归属获得 VK 访问权限

```
Customer（组织，可选）
  ├── OwnerUserID（组织所有者）
  ├── BudgetLimit / CurrentUsage（组织预算，可选）
  ├── Teams[]（包含的团队）
  └── VirtualKeys[]（组织级 VK）

Team（团队，可选）
  ├── OwnerUserID（团队管理者）
  ├── Members[]（成员列表）
  ├── BudgetLimit / CurrentUsage（团队预算，可选）
  └── VirtualKeys[]（团队级 VK）

User（个人）
  ├── CustomerID（所属组织，可选）
  ├── TeamID（所属团队，可选）
  ├── Role: admin | customer_owner | team_admin | team_member
  ├── BudgetLimit / CurrentUsage（个人预算，可选）
  └── Identities[]（多种认证方式）

VK（Virtual Key）
  ├── TeamID 或 CustomerID（归属层级，二选一，必需）
  └── BudgetLimit / CurrentUsage（VK 级预算，可选）
```

> **单人用户**：注册时自动创建虚拟 Customer，用户成为 customer_owner，VK 绑定到该虚拟 Customer。

---

## 3. 组织和个人使用流程

### 流程 1：组织最初使用平台

```
场景：Acme Corp 购买 Bifrost 部署

1. 超级管理员（系统级）登录后台
2. 创建 Customer "Acme Corp"
   - 分配全局预算：$50,000/月
   - 设置 Owner：指定组织管理员
3. 组织管理员登录（customer_owner 角色）
4. 创建 Team "Engineering"
   - 分配团队预算：$20,000/月
   - 设置 Team Admin
5. 创建 Team "QA"
   - 分配团队预算：$5,000/月
6. Team Admin 创建 VK（归属 Team）
   - VK.TeamID = "engineering"
   - 可选设置 VK 级预算
7. 邀请成员加入 Team（通过邮箱/邀请链接）
8. 成员注册/接受邀请 → 获得个人账号，加入 Team
9. 成员通过 Team 成员身份获得 VK 访问权限
```

### 流程 2：组织内个人使用

```
场景：工程师小明加入 Acme Corp - Engineering Team

1. 小明收到邀请邮件，点击注册
2. 系统自动：
   - 创建 User 账号（user_id=42）
   - 设置 role="team_member"
   - 设置 team_id="engineering"
   - 设置 customer_id="acme-corp"
3. 小明登录用户面板
4. 可以看到 Engineering Team 下的所有 VK（只读）
5. 使用 Team VK 调用 API
6. 消耗记录归属 Team + Customer + VK（各层级独立扣除）
```

### 流程 3：个人用户（无组织）

```
场景：独立开发者小王

1. 小王自行注册
2. 系统自动：
   - 创建 User 账号（user_id=99）
   - 创建虚拟 Customer（customer_id="personal-99"）
   - 设置 role="customer_owner"
   - 设置 customer_id="personal-99"
3. 小王登录用户面板
4. 创建 VK（归属虚拟 Customer）：
   - name="小王的Key"
   - customer_id="personal-99"
   - 可选设置 VK 级预算
5. 不需要 JWT，直接用 VK 调用 API
6. 消耗记录归属虚拟 Customer + VK（各层级独立扣除）
```

---

## 4. 数据模型设计

### 4.1 User 表扩展

```go
// framework/configstore/tables/user.go
type TableUser struct {
    ID           uint      `gorm:"primaryKey;autoIncrement" json:"id"`
    Email        string    `gorm:"type:varchar(255);uniqueIndex;not null" json:"email"`
    Username     string    `gorm:"type:varchar(100);uniqueIndex;not null" json:"username"`
    PasswordHash string    `gorm:"type:varchar(255);not null" json:"-"`
    Nickname     string    `gorm:"type:varchar(100)" json:"nickname"`
    Avatar       string    `gorm:"type:text" json:"avatar"`
    Status       string    `gorm:"type:varchar(20);default:'active'" json:"status"` // active, banned, deleted

    // === 预算（可选） ===
    BudgetLimit     float64 `gorm:"type:decimal(20,6);default:0" json:"budget_limit"`
    CurrentUsage    float64 `gorm:"type:decimal(20,6);default:0" json:"current_usage"`

    // === 新增：组织归属 ===
    // 注意：VK 不再绑定个人用户，只归属 Team 或 Customer
    CustomerID   *string   `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`
    TeamID       *string   `gorm:"type:varchar(255);index" json:"team_id,omitempty"`

    // === RBAC 角色 ===
    // 预置角色: admin | customer_owner | team_admin | team_member
    // 不需要 user 角色，个人用户使用虚拟组织模式
    Role         string    `gorm:"type:varchar(50);default:'user'" json:"role"`

    // 关联
    Customer     *TableCustomer     `gorm:"foreignKey:CustomerID" json:"customer,omitempty"`
    Team         *TableTeam         `gorm:"foreignKey:TeamID" json:"team,omitempty"`

    EncryptionStatus string    `gorm:"type:varchar(20);default:'plain_text'" json:"-"`
    CreatedAt        time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt        time.Time `gorm:"index;not null" json:"updated_at"`
}
```

### 4.2 VirtualKey 表扩展

> **重要变更**：VK 去掉 user_id 字段，统一归属到 team 或 customer。

```go
// framework/configstore/tables/virtualkey.go
type TableVirtualKey struct {
    ID              string                          `gorm:"primaryKey;type:varchar(255)" json:"id"`
    Name            string                          `gorm:"uniqueIndex;type:varchar(255);not null" json:"name"`
    Description     string                          `gorm:"type:text" json:"description,omitempty"`
    Value           string                          `gorm:"type:text;not null" json:"value"`
    IsActive        bool                            `gorm:"default:true" json:"is_active"`
    ProviderConfigs []TableVirtualKeyProviderConfig `gorm:"foreignKey:VirtualKeyID" json:"provider_configs"`
    MCPConfigs      []TableVirtualKeyMCPConfig      `gorm:"foreignKey:VirtualKeyID" json:"mcp_configs"`

    // === 归属层级（二选一） ===
    // VK 必须归属于 Team 或 Customer，不再绑定个人用户
    TeamID          *string `gorm:"type:varchar(255);index" json:"team_id,omitempty"`
    CustomerID      *string `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`

    // === 预算（可选） ===
    BudgetLimit     float64 `gorm:"type:decimal(20,6);default:0" json:"budget_limit"`
    CurrentUsage    float64 `gorm:"type:decimal(20,6);default:0" json:"current_usage"`

    RateLimitID     *string `gorm:"type:varchar(255);index" json:"rate_limit_id,omitempty"`

    // ... 其他现有字段保持不变 ...
}
```

### 4.3 Team 表扩展

```go
// framework/configstore/tables/team.go
type TableTeam struct {
    ID            string  `gorm:"primaryKey;type:varchar(255)" json:"id"`
    Name          string  `gorm:"type:varchar(255);not null" json:"name"`
    CustomerID    *string `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`
    RateLimitID   *string `gorm:"type:varchar(255);index" json:"rate_limit_id,omitempty"`

    // === 新增：团队管理者 ===
    OwnerUserID   *uint      `gorm:"index" json:"owner_user_id,omitempty"`
    OwnerUser     *TableUser `gorm:"foreignKey:OwnerUserID" json:"owner_user,omitempty"`

    // 关联
    Customer      *TableCustomer    `gorm:"foreignKey:CustomerID" json:"customer,omitempty"`
    Budgets       []TableBudget     `gorm:"foreignKey:TeamID" json:"budgets,omitempty"`
    RateLimit     *TableRateLimit   `gorm:"foreignKey:RateLimitID" json:"rate_limit,omitempty"`
    VirtualKeys   []TableVirtualKey `gorm:"foreignKey:TeamID" json:"virtual_keys,omitempty"`
    Members       []TableUser       `gorm:"foreignKey:TeamID" json:"members,omitempty"`

    // ... 其他现有字段 ...
}
```

### 4.4 Customer 表扩展

```go
// framework/configstore/tables/customer.go
type TableCustomer struct {
    ID            string  `gorm:"primaryKey;type:varchar(255)" json:"id"`
    Name          string  `gorm:"type:varchar(255);not null" json:"name"`
    BudgetID      *string `gorm:"type:varchar(255);index" json:"budget_id,omitempty"`
    RateLimitID   *string `gorm:"type:varchar(255);index" json:"rate_limit_id,omitempty"`

    // === 新增：组织所有者 ===
    OwnerUserID   *uint      `gorm:"index" json:"owner_user_id,omitempty"`
    OwnerUser     *TableUser `gorm:"foreignKey:OwnerUserID" json:"owner_user,omitempty"`

    // 关联
    Budget        *TableBudget      `gorm:"foreignKey:BudgetID" json:"budget,omitempty"`
    RateLimit     *TableRateLimit   `gorm:"foreignKey:RateLimitID" json:"rate_limit,omitempty"`
    Teams         []TableTeam       `gorm:"foreignKey:CustomerID" json:"teams"`
    VirtualKeys   []TableVirtualKey `gorm:"foreignKey:CustomerID" json:"virtual_keys"`

    // ... 其他现有字段 ...
}
```

---

## 5. 认证解耦设计（支持外部账号系统/第三方登录）

### 5.1 设计目标

- **认证与授权分离**：账号创建/认证可委托给外部系统，Bifrost 只负责授权（VK、预算、RBAC）
- **多登录方式**：一个用户可以关联多种登录方式（密码、公司 SSO、GitHub、微信等）
- **渐进式迁移**：先用内置密码认证，后续无缝切换到外部系统

### 5.2 数据模型：User + Identity 分离

```go
// framework/configstore/tables/user.go

type TableUser struct {
    ID           uint      `gorm:"primaryKey;autoIncrement" json:"id"`
    Username     string    `gorm:"type:varchar(100);uniqueIndex;not null" json:"username"`
    Email        string    `gorm:"type:varchar(255);uniqueIndex;not null" json:"email"`
    Nickname     string    `gorm:"type:varchar(100)" json:"nickname"`
    Avatar       string    `gorm:"type:text" json:"avatar"`
    Status       string    `gorm:"type:varchar(20);default:'active'" json:"status"` // active, banned, deleted

    // === 预算（可选） ===
    BudgetLimit     float64 `gorm:"type:decimal(20,6);default:0" json:"budget_limit"`
    CurrentUsage    float64 `gorm:"type:decimal(20,6);default:0" json:"current_usage"`

    // 组织归属
    CustomerID   *string   `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`
    TeamID       *string   `gorm:"type:varchar(255);index" json:"team_id,omitempty"`

    // RBAC 角色（去掉 user 角色，个人用户使用虚拟组织模式）
    // 预置角色: admin | customer_owner | team_admin | team_member
    Role         string    `gorm:"type:varchar(50);default:'user'" json:"role"`

    // 认证方式配置（JSON，标识该用户支持的认证方式）
    // 可选字段，用于快速判断用户是否有某种认证方式
    AuthMethods  string    `gorm:"type:text" json:"auth_methods,omitempty"`

    // 关联
    Identities   []TableUserIdentity `gorm:"foreignKey:UserID" json:"identities,omitempty"`
    Customer     *TableCustomer      `gorm:"foreignKey:CustomerID" json:"customer,omitempty"`
    Team         *TableTeam          `gorm:"foreignKey:TeamID" json:"team,omitempty"`

    CreatedAt    time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt    time.Time `gorm:"index;not null" json:"updated_at"`
}

// TableUserIdentity 用户身份关联表
// 支持多种认证方式：password、sso、github、wechat 等
type TableUserIdentity struct {
    ID              uint      `gorm:"primaryKey;autoIncrement" json:"id"`
    UserID          uint      `gorm:"index;not null" json:"user_id"`
    Provider        string    `gorm:"type:varchar(50);not null" json:"provider"`
    // 联合唯一索引：同一个 provider + provider_user_id 只能对应一个用户
    // 支持的 provider 类型：
    // - "password"     : 内置密码认证
    // - "company_sso"  : 公司账号系统（OIDC/SAML）
    // - "github"       : GitHub OAuth
    // - "wechat"       : 微信登录
    // - "dingtalk"     : 钉钉登录
    // - "feishu"       : 飞书登录
    // - "ldap"         : LDAP/AD

    ProviderUserID  string    `gorm:"type:varchar(255);not null" json:"provider_user_id"`
    // 外部系统用户标识：
    // - password: 用户名（username）
    // - github: GitHub user ID
    // - wechat: openid
    // - sso: 外部系统 user_id

    ProviderData    string    `gorm:"type:text" json:"provider_data,omitempty"`
    // JSON 存储 provider 特有数据：
    // - password: {"password_hash": "bcrypt..."}
    // - github: {"access_token": "***", "avatar_url": "..."}
    // - wechat: {"access_token": "***", "refresh_token": "***"}
    // - sso: {"id_token": "...", "claims": {...}}

    IsPrimary       bool      `gorm:"default:false" json:"is_primary"`
    // 主要登录方式标记

    LastUsedAt      *time.Time `json:"last_used_at,omitempty"`
    CreatedAt       time.Time  `gorm:"index;not null" json:"created_at"`
    UpdatedAt       time.Time  `gorm:"index;not null" json:"updated_at"`

    User            *TableUser `gorm:"foreignKey:UserID" json:"user,omitempty"`

    // 联合唯一索引：同一个 provider + provider_user_id 只能对应一个用户
    // UNIQUE(provider, provider_user_id)
}
```

### 5.3 认证流程抽象

```go
// handlers/auth/interface.go

// AuthProvider 认证提供者接口
type AuthProvider interface {
    // Authenticate 执行认证，返回用户信息或错误
    Authenticate(ctx *fasthttp.RequestCtx) (*AuthResult, error)

    // GetProviderName 获取提供者名称
    GetProviderName() string
}

// AuthResult 认证结果
type AuthResult struct {
    User         *TableUser
    Identity     *TableUserIdentity
    IsNewUser    bool   // 是否新用户（首次登录）
    ProviderData map[string]interface{} // provider 特有数据
}

// AuthManager 认证管理器
type AuthManager struct {
    providers map[string]AuthProvider
}

// RegisterProvider 注册认证提供者
func (m *AuthManager) RegisterProvider(provider AuthProvider) {
    m.providers[provider.GetProviderName()] = provider
}

// Authenticate 根据 provider 名称执行认证
func (m *AuthManager) Authenticate(providerName string, ctx *fasthttp.RequestCtx) (*AuthResult, error) {
    provider, exists := m.providers[providerName]
    if !exists {
        return nil, fmt.Errorf("unknown auth provider: %s", providerName)
    }
    return provider.Authenticate(ctx)
}
```

### 5.4 内置认证提供者实现

```go
// handlers/auth/password.go

type PasswordAuthProvider struct {
    db *gorm.DB
}

func (p *PasswordAuthProvider) GetProviderName() string {
    return "password"
}

func (p *PasswordAuthProvider) Authenticate(ctx *fasthttp.RequestCtx) (*AuthResult, error) {
    // 解析请求
    var req struct {
        Username string `json:"username"`
        Password string `json:"password"`
    }
    // ... 解析 JSON ...

    // 查找用户身份
    var identity TableUserIdentity
    err := p.db.Where("provider = ? AND provider_user_id = ?", "password", req.Username).First(&identity).Error
    if err != nil {
        return nil, fmt.Errorf("user not found")
    }

    // 验证密码
    var providerData map[string]interface{}
    json.Unmarshal([]byte(identity.ProviderData), &providerData)
    storedHash, _ := providerData["password_hash"].(string)

    if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(req.Password)); err != nil {
        return nil, fmt.Errorf("invalid password")
    }

    // 更新最后使用时间
    now := time.Now()
    identity.LastUsedAt = &now
    p.db.Save(&identity)

    // 返回用户
    var user TableUser
    p.db.First(&user, identity.UserID)

    return &AuthResult{
        User:     &user,
        Identity: &identity,
    }, nil
}
```

### 5.5 外部账号系统集成（公司 SSO）

```go
// handlers/auth/company_sso.go

type CompanySSOAuthProvider struct {
    db         *gorm.DB
    // 外部系统配置
    issuerURL  string // 外部系统 issuer URL
    clientID   string
    clientSecret string
}

func (p *CompanySSOAuthProvider) GetProviderName() string {
    return "company_sso"
}

func (p *CompanySSOAuthProvider) Authenticate(ctx *fasthttp.RequestCtx) (*AuthResult, error) {
    // 方式 1：接收外部系统回调（OIDC Authorization Code Flow）
    // 方式 2：验证外部系统签发的 JWT
    // 方式 3：调用外部系统 API 验证 token

    // 示例：验证外部 JWT
    token := extractBearerToken(ctx)
    claims, err := p.validateExternalJWT(token)
    if err != nil {
        return nil, err
    }

    externalUserID := claims["sub"].(string)
    email := claims["email"].(string)

    // 查找或创建用户身份
    var identity TableUserIdentity
    err = p.db.Where("provider = ? AND provider_user_id = ?", "company_sso", externalUserID).First(&identity).Error

    if err == gorm.ErrRecordNotFound {
        // 首次登录，自动创建用户
        user := &TableUser{
            Username: email, // 或从外部系统获取
            Email:    email,
            Role:     "user", // 默认角色
        }
        p.db.Create(user)

        identity = TableUserIdentity{
            UserID:         user.ID,
            Provider:       "company_sso",
            ProviderUserID: externalUserID,
            ProviderData:   marshalJSON(claims),
            IsPrimary:      true,
        }
        p.db.Create(&identity)

        return &AuthResult{
            User:      user,
            Identity:  &identity,
            IsNewUser: true,
        }, nil
    }

    // 已有用户，更新信息
    var user TableUser
    p.db.First(&user, identity.UserID)

    return &AuthResult{
        User:     &user,
        Identity: &identity,
    }, nil
}
```

### 5.6 第三方登录集成（GitHub/微信）

```go
// handlers/auth/github.go

type GitHubAuthProvider struct {
    db         *gorm.DB
    clientID   string
    clientSecret string
}

func (p *GitHubAuthProvider) GetProviderName() string {
    return "github"
}

func (p *GitHubAuthProvider) Authenticate(ctx *fasthttp.RequestCtx) (*AuthResult, error) {
    // 1. 接收 OAuth 回调 code
    code := string(ctx.QueryArgs().Peek("code"))

    // 2. 用 code 换取 access_token
    accessToken, err := p.exchangeCodeForToken(code)
    if err != nil {
        return nil, err
    }

    // 3. 用 access_token 获取用户信息
    githubUser, err := p.getGitHubUser(accessToken)
    if err != nil {
        return nil, err
    }

    githubUserID := fmt.Sprintf("%d", githubUser.ID)

    // 4. 查找或创建用户身份
    var identity TableUserIdentity
    err = p.db.Where("provider = ? AND provider_user_id = ?", "github", githubUserID).First(&identity).Error

    if err == gorm.ErrRecordNotFound {
        // 首次登录，创建用户
        user := &TableUser{
            Username: githubUser.Login,
            Email:    githubUser.Email,
            Nickname: githubUser.Name,
            Avatar:   githubUser.AvatarURL,
            Role:     "user",
        }
        p.db.Create(user)

        providerData := map[string]interface{}{
            "access_token": accessToken,
            "avatar_url":   githubUser.AvatarURL,
            "login":        githubUser.Login,
        }
        identity = TableUserIdentity{
            UserID:         user.ID,
            Provider:       "github",
            ProviderUserID: githubUserID,
            ProviderData:   marshalJSON(providerData),
            IsPrimary:      false, // GitHub 通常不是主要登录方式
        }
        p.db.Create(&identity)

        return &AuthResult{User: user, Identity: &identity, IsNewUser: true}, nil
    }

    // 已有用户
    var user TableUser
    p.db.First(&user, identity.UserID)

    // 更新 access_token
    providerData := map[string]interface{}{
        "access_token": accessToken,
    }
    identity.ProviderData = marshalJSON(providerData)
    now := time.Now()
    identity.LastUsedAt = &now
    p.db.Save(&identity)

    return &AuthResult{User: &user, Identity: &identity}, nil
}

// handlers/auth/wechat.go 结构类似，使用微信 OAuth2.0
```

### 5.7 API 端点设计

```
# 内置密码认证
POST /api/auth/login                    — 密码登录 {username, password}
POST /api/auth/register                 — 密码注册 {username, email, password}

# 第三方登录（OAuth2 流程）
GET  /api/auth/github                   — 发起 GitHub OAuth
GET  /api/auth/github/callback          — GitHub OAuth 回调
GET  /api/auth/wechat                   — 发起微信登录
GET  /api/auth/wechat/callback          — 微信回调

# 公司 SSO 集成
POST /api/auth/sso/verify               — 验证外部 SSO token
GET  /api/auth/sso/redirect             — 重定向到外部 SSO 登录页

# 账号关联（已登录用户绑定其他登录方式）
POST /api/user/identities               — 绑定新的登录方式
GET  /api/user/identities               — 查看已绑定的登录方式
DELETE /api/user/identities/{id}        — 解绑登录方式

# 统一认证入口（根据配置自动选择）
POST /api/auth/login                    — {method: "password"|"sso"|"github"|...}
```

### 5.8 认证配置（config.json 扩展）

```json
{
  "auth": {
    "default_method": "password",
    "methods": {
      "password": {
        "enabled": true
      },
      "github": {
        "enabled": false,
        "client_id": "",
        "client_secret": "",
        "callback_url": "https://your-domain.com/api/auth/github/callback"
      },
      "wechat": {
        "enabled": false,
        "app_id": "",
        "app_secret": ""
      },
      "company_sso": {
        "enabled": false,
        "type": "oidc",
        "issuer_url": "https://sso.company.com",
        "client_id": "",
        "client_secret": "",
        "callback_url": "https://your-domain.com/api/auth/sso/callback",
        "auto_create_user": true,
        "default_role": "user"
      }
    }
  }
}
```

### 5.9 扩展性设计要点

| 设计点 | 说明 |
|--------|------|
| **User + Identity 分离** | User 存储用户信息，Identity 存储多种登录方式，1:N 关系 |
| **AuthProvider 接口** | 新增认证方式只需实现接口，无需修改核心逻辑 |
| **配置驱动** | 通过 config.json 启用/禁用认证方式，支持运行时切换 |
| **自动创建用户** | 外部系统首次登录自动创建 Bifrost 用户，无需手动配置 |
| **账号关联** | 已登录用户可绑定多种登录方式（如先用密码注册，后绑定 GitHub） |
| **Provider 扩展** | 新增 provider 只需添加文件，注册到 AuthManager |

---

## 6. RBAC 设计

### 6.1 预置系统角色

| 角色 | 作用域 | 权限 |
|------|--------|------|
| `admin` | 全局 | 所有资源完全控制 |
| `customer_owner` | Customer | 管理整个组织：Team、成员、预算、VK |
| `team_admin` | Team | 管理团队：成员、Team 预算（只读）、所有成员 VK |
| `team_member` | Team | 只能查看 Team 内资源 |

> **重要变更**：不需要 `user` 角色，个人用户使用虚拟组织模式。

### 6.2 权限矩阵

| 角色 | VK | Team | Customer | Budget | User | Role |
|------|-----|------|----------|--------|------|------|
| admin | CRUD (全局) | CRUD (全局) | CRUD (全局) | CRUD (全局) | CRUD (全局) | CRUD (全局) |
| customer_owner | CRUD (本customer) | CRUD (本customer) | CRUD (本customer) | CRUD (本customer) | CRUD (本customer) | CRUD (本customer) |
| team_admin | CRUD (本team) | R (本team) | — | R (本team) | CRUD (本team) | — |
| team_member | R (本team) | R (本team) | — | — | — | — |

**Scope规则**：
- **admin** — 全局，不受 scope 限制
- **customer_owner** — 只能操作自己所在的 customer 及下属所有 team/user
- **team_admin** — 只能操作自己所在的 team 及 team 内的 vk/user
- **team_member** — 只能查看自己所在的 team 资源

**VK创建权限**：只有 team_admin 或 customer_owner 可以创建 VK，team_member 不能创建。

### 6.3 自定义角色（Phase 2）

```go
// framework/configstore/tables/role.go

// TableCustomRole 组织自定义角色
type TableCustomRole struct {
    ID          string   `gorm:"primaryKey;type:varchar(255)" json:"id"`
    Name        string   `gorm:"type:varchar(100);not null" json:"name"`
    Scope       string   `gorm:"type:varchar(20);not null" json:"scope"` // global | customer | team
    CustomerID  *string  `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`
    TeamID      *string  `gorm:"type:varchar(255);index" json:"team_id,omitempty"`

    Permissions []string `gorm:"type:text;serializer:json" json:"permissions"`
    // e.g. ["virtual_key:create", "virtual_key:read", "virtual_key:delete", "user:invite"]

    Description string   `gorm:"type:text" json:"description,omitempty"`
    CreatedAt   time.Time `gorm:"index;not null" json:"created_at"`
    UpdatedAt   time.Time `gorm:"index;not null" json:"updated_at"`
}

// TableUserRole 用户角色关联
type TableUserRole struct {
    UserID      uint    `gorm:"primaryKey" json:"user_id"`
    RoleID      string  `gorm:"primaryKey;type:varchar(255)" json:"role_id"`
    CustomerID  *string `gorm:"type:varchar(255);index" json:"customer_id,omitempty"` // 作用域
    TeamID      *string `gorm:"type:varchar(255);index" json:"team_id,omitempty"`

    Role        *TableCustomRole `gorm:"foreignKey:RoleID" json:"role,omitempty"`
    User        *TableUser       `gorm:"foreignKey:UserID" json:"user,omitempty"`
}
```

### 6.4 权限检查逻辑

```go
// plugins/governance/permissions.go

// HasPermission 检查用户是否有权限
func HasPermission(user *TableUser, resource string, action string, scopeID string) bool {
    // 1. 检查预置角色
    switch user.Role {
    case "admin":
        return true // 拥有所有权限

    case "customer_owner":
        // 可以管理自己 Customer 下的所有资源
        if user.CustomerID != nil && *user.CustomerID == scopeID {
            return true
        }

    case "team_admin":
        // 可以管理自己 Team 下的资源
        if user.TeamID != nil && *user.TeamID == scopeID {
            // team_admin 对 Team 只有 R 权限
            if resource == "team" && action != "read" {
                return false
            }
            // team_admin 对 Budget 只有 R 权限
            if resource == "budget" && action != "read" {
                return false
            }
            return true
        }

    case "team_member":
        // 只能查看 Team 内资源
        if user.TeamID != nil && *user.TeamID == scopeID {
            return action == "read"
        }
    }

    // 2. 检查自定义角色（Phase 2）
    // ... 查询 user_roles，匹配 permissions ...

    return false
}

// GetVisibleVKs 获取用户可见的 VK
func GetVisibleVKs(db *gorm.DB, userID uint) ([]TableVirtualKey, error) {
    var vks []TableVirtualKey
    user := GetUser(db, userID)

    // 使用单一条件查询，避免多次数据库访问
    switch user.Role {
    case "admin":
        // Admin 可以看到所有 VK
        db.Find(&vks)

    case "customer_owner":
        // Customer Owner 可以看到本组织所有 VK
        if user.CustomerID != nil {
            db.Where("customer_id = ?", *user.CustomerID).Find(&vks)
        }

    case "team_admin", "team_member":
        // Team Admin/Member 可以看到本 Team 所有 VK
        if user.TeamID != nil {
            db.Where("team_id = ?", *user.TeamID).Find(&vks)
        }
    }

    return vks, nil
}
```

---

## 7. 预算继承链

### 7.1 多层预算评估

> **重要变更**：VK 去掉 user_id，所有层级采用统一的 BudgetLimit + CurrentUsage 模式。

```
请求 → 查 VK → 取 TeamID → 取 CustomerID
→ 检查各层级预算（余额 > 0），任一层不足则拒绝
→ 请求完成后，各层级独立扣除消耗量

检查逻辑（各层级独立，同时检查）：
├─ VK Budget:        如果有 → CurrentUsage < BudgetLimit ?
├─ Team Budget:      如果有（VK在team）→ CurrentUsage < BudgetLimit ?
└─ Customer Budget:  如果有（VK在customer）→ CurrentUsage < BudgetLimit ?

扣除操作（所有存在的层级都扣除）：
├─ VK CurrentUsage        += 消耗量
├─ Team CurrentUsage      += 消耗量
└─ Customer CurrentUsage  += 消耗量
```

### 7.2 BudgetResolver 实现

```go
// plugins/governance/resolver.go

func (r *BudgetResolver) CheckBudget(vk *TableVirtualKey) (bool, error) {
    // 1. 检查 VK 层预算（如果有）
    if vk.BudgetLimit > 0 && vk.CurrentUsage >= vk.BudgetLimit {
        return false, fmt.Errorf("VK budget exceeded")
    }

    // 2. 检查 Team 层预算（如果 VK 在 Team）
    if vk.TeamID != nil {
        team := r.getTeam(*vk.TeamID)
        if team.BudgetLimit > 0 && team.CurrentUsage >= team.BudgetLimit {
            return false, fmt.Errorf("Team budget exceeded")
        }
    }

    // 3. 检查 Customer 层预算（如果 VK 在 Customer）
    if vk.CustomerID != nil {
        customer := r.getCustomer(*vk.CustomerID)
        if customer.BudgetLimit > 0 && customer.CurrentUsage >= customer.BudgetLimit {
            return false, fmt.Errorf("Customer budget exceeded")
        }
    }

    return true, nil
}

func (r *BudgetResolver) DeductBudget(vk *TableVirtualKey, usage float64) error {
    // 1. 扣除 VK 层预算
    if vk.BudgetLimit > 0 {
        vk.CurrentUsage += usage
        r.db.Save(vk)
    }

    // 2. 扣除 Team 层预算（如果 VK 在 Team）
    if vk.TeamID != nil {
        team := r.getTeam(*vk.TeamID)
        team.CurrentUsage += usage
        r.db.Save(team)
    }

    // 3. 扣除 Customer 层预算（如果 VK 在 Customer）
    if vk.CustomerID != nil {
        customer := r.getCustomer(*vk.CustomerID)
        customer.CurrentUsage += usage
        r.db.Save(customer)
    }

    return nil
}
```

### 7.3 预算配置模式

| 场景 | VK Budget | Team Budget | Customer Budget |
|------|-----------|-------------|-----------------|
| 个人用户（虚拟组织） | 可选 | — | 可选 |
| 组织成员（单Team） | 可选 | 可选 | 可选 |
| 组织成员（多Team） | 可选 | 按 VK.TeamID | 可选 |

**说明**：
- 所有层级的预算都是可选的，配置了才生效
- 请求通过条件：所有配置了预算的层级，余额必须 > 0
- 请求完成后：所有配置了预算的层级都独立扣除消耗量

---

## 8. API 设计

### 8.1 用户 VK API（新增）

```
GET    /api/user/virtual-keys        — 列出自己可见的 VK（按角色和归属过滤）
GET    /api/user/virtual-keys/{id}   — 获取 VK（需有读取权限）
```

### 8.2 管理员 VK API（扩展）

```
GET    /api/admin/virtual-keys                   — 列出所有 VK（支持 team_id/customer_id 过滤）
POST   /api/admin/virtual-keys                   — 创建 VK（admin/customer_owner/team_admin）
PUT    /api/admin/virtual-keys/{id}              — 更新 VK
DELETE /api/admin/virtual-keys/{id}              — 删除 VK
```

### 8.3 组织管理 API（新增）

```
POST   /api/admin/customers                      — 创建组织
GET    /api/admin/customers/{id}                 — 获取组织
PUT    /api/admin/customers/{id}                 — 更新组织
DELETE /api/admin/customers/{id}                 — 删除组织
GET    /api/admin/customers/{id}/members          — 列出组织成员
POST   /api/admin/customers/{id}/members/invite   — 邀请成员加入组织

POST   /api/admin/teams                           — 创建团队
GET    /api/admin/teams/{id}                       — 获取团队
PUT    /api/admin/teams/{id}                       — 更新团队
DELETE /api/admin/teams/{id}                       — 删除团队
GET    /api/admin/teams/{id}/members              — 列出团队成员
POST   /api/admin/teams/{id}/members/invite       — 邀请成员加入团队
PUT    /api/admin/teams/{id}/members/{uid}/role   — 设置成员角色

POST   /api/admin/roles                           — 创建自定义角色
GET    /api/admin/roles                           — 列出角色
PUT    /api/admin/roles/{id}                      — 更新角色
DELETE /api/admin/roles/{id}                      — 删除角色
POST   /api/admin/users/{id}/roles                — 为用户分配角色
```

### 8.4 用户邀请流程 API

```
POST   /api/invite/accept                         — 接受邀请（设置密码、完成注册）
GET    /api/invite/{token}                        — 验证邀请令牌

# 邀请 token 有效期 7 天，过期后自动失效
# TableInvite 新增字段：ExpiresAt (7天后过期)、RevokedAt (可选)
```

---

## 9. 改造成本评估

### 9.1 代码量分析

| 改动项 | 工作量 | 风险 |
|--------|--------|------|
| 数据库扩展（User/Identity/Team/Customer/VK） | 1 天 | 低 — nullable 字段，向后兼容 |
| 认证解耦（AuthProvider 接口 + 密码实现） | 1.5 天 | 中 — 核心认证逻辑重构 |
| 用户 VK CRUD API | 1 天 | 低 — 复用现有 governance 逻辑 |
| VK 可见性过滤（user_id 隔离） | 0.5 天 | 低 — WHERE 过滤 |
| 预算继承重写（四层评估） | 1-1.5 天 | 中 — 核心逻辑改动 |
| RBAC 预置角色实现 | 1 天 | 中 — Handler 层权限检查 |
| 邀请流程 | 0.5 天 | 低 — 标准邀请模式 |
| 第三方登录（GitHub/微信，可选） | 2 天 | 低 — 独立模块 |
| 前端用户面板 | 2-3 天 | 中 — 新增页面 |
| 审计日志 | 0.5 天 | 低 — 独立表 + 记录逻辑 |
| auth 配置验证 | 0.5 天 | 低 — 启动时校验 |
| 测试 | 1 天 | — |
| **总计** | **13-16 天**（不含第三方登录 11-14 天） | |

### 9.2 架构影响

- **核心改动集中**：plugins/governance + handlers/governance
- **向后兼容**：所有新增字段 nullable，现有 VK 不受影响
- **无破坏性改动**：BudgetResolver 是新增逻辑，不替换现有

---

## 10. 实施阶段

### Phase 1：核心数据模型 + 认证解耦 + VK 管理（7 天）

**目标**：实现 VK 归属到 Team/Customer，支持多种认证方式

1. **数据库扩展**
   - `TableUser`: 添加 CustomerID、TeamID、Role、BudgetLimit、CurrentUsage 字段
   - `TableUserIdentity`: 新建表，支持多种认证方式
   - `TableVirtualKey`: 去掉 UserID 字段，添加 BudgetLimit、CurrentUsage 字段
   - `TableTeam`: 添加 OwnerUserID、BudgetLimit、CurrentUsage 字段
   - `TableCustomer`: 添加 OwnerUserID、BudgetLimit、CurrentUsage 字段
   - 数据库迁移脚本

2. **认证解耦架构**
   - `handlers/auth/interface.go`: AuthProvider 接口、AuthManager 管理器
   - `handlers/auth/password.go`: 内置密码认证提供者
   - 修改现有登录/注册逻辑，使用 AuthManager 统一入口
   - 扩展 config.json，添加 auth 配置节

3. **VK CRUD API**
   - `GET /api/user/virtual-keys` — 列出自己可见的 VK（按角色和归属过滤）
   - `POST /api/admin/virtual-keys` — 创建 VK（admin/customer_owner/team_admin）
   - `GET/PUT/DELETE /api/admin/virtual-keys/{id}` — 管理 VK

4. **VK 可见性控制**
   - 修改现有 VK API，添加角色和归属过滤
   - Team Member 只能看到 Team 内 VK
   - Admin 可以看到所有 VK

5. **单人用户虚拟组织**
   - 注册时自动创建虚拟 Customer
   - 用户自动成为 customer_owner
   - VK 绑定到虚拟 Customer

### Phase 2：RBAC 基础（3 天）

**目标**：实现预置角色和权限检查

1. **预置角色定义**
   - admin、customer_owner、team_admin、team_member（去掉 user 角色）
   - 权限检查中间件

2. **Handler 层权限集成**
   - 所有敏感 API 加权限检查
   - 使用 `HasPermission()` 函数
   - 实现权限矩阵（见 6.2）

3. **管理员用户管理**
   - `GET /api/admin/users` — 列出用户
   - `PUT /api/admin/users/{id}/role` — 设置用户角色
   - `PUT /api/admin/users/{id}/team` — 分配用户到团队
   - `PUT /api/admin/users/{id}/customer` — 分配用户到组织

### Phase 3：预算继承（2 天）

**目标**：实现多层预算评估

1. **BudgetResolver 重写**
   - 多层预算检查：VK + Team + Customer（各层级独立，配置了才检查）
   - 任一层余额不足则拒绝

2. **预算扣除逻辑**
   - 请求完成后各层级独立扣除消耗量
   - 支持可选预算配置

### Phase 4：组织管理（3 天）

**目标：** 组织创建、邀请、成员管理

1. **邀请流程**
   - 管理员邀请成员（邮箱）
   - 生成邀请链接（token）
   - 成员接受邀请，设置密码

2. **组织管理面板**
   - 创建/编辑 Customer
   - 创建/编辑 Team
   - 查看成员列表
   - 管理成员角色

3. **团队管理面板**
   - 查看团队成员
   - 管理团队预算
   - 管理团队 VK

### Phase 5：自定义角色（2 天）

**目标：** 组织可定义自己的角色

1. **自定义角色 CRUD**
   - 创建角色：名称、权限列表
   - 权限格式：`resource:action`（如 `virtual_key:create`）

2. **角色分配**
   - 为用户分配自定义角色
   - 权限检查扩展到自定义角色

### Phase 6：第三方登录集成（2 天，可选）

**目标：** 支持 GitHub、微信等第三方登录

1. **GitHub OAuth**
   - `handlers/auth/github.go`: GitHubAuthProvider 实现
   - OAuth2 流程：发起授权 → 回调 → 创建/关联用户
   - config.json 添加 github 配置

2. **微信登录（可选）**
   - `handlers/auth/wechat.go`: WeChatAuthProvider 实现
   - 微信 OAuth2 流程
   - config.json 添加 wechat 配置

3. **账号关联功能**
   - 已登录用户可绑定多种登录方式
   - `POST /api/user/identities` — 绑定新登录方式
   - `GET /api/user/identities` — 查看已绑定方式
   - `DELETE /api/user/identities/{id}` — 解绑

### Phase 7：前端集成（5-7 天）

**目标：** 完整的前端界面

1. **用户面板**
   - 我的 VK
   - 创建新 VK
   - 用量统计
   - 余额和充值

2. **管理员面板**
   - 用户管理
   - 组织管理
   - 角色管理
   - 预算分配

---

## 11. 文件变更清单

| 文件 | 操作 | 描述 |
|------|------|------|
| `framework/configstore/tables/user.go` | 修改 | 添加 CustomerID、TeamID、Role、BudgetLimit、CurrentUsage 字段 |
| `framework/configstore/tables/virtualkey.go` | 修改 | 去掉 UserID 字段，添加 BudgetLimit、CurrentUsage 字段 |
| `framework/configstore/tables/team.go` | 修改 | 添加 OwnerUserID、Members 关联、BudgetLimit、CurrentUsage 字段 |
| `framework/configstore/tables/customer.go` | 修改 | 添加 OwnerUserID、BudgetLimit、CurrentUsage 字段 |
| `framework/configstore/tables/role.go` | 新建 | 自定义角色表 |
| `framework/configstore/tables/audit_log.go` | 新建 | 审计日志表 |
| `framework/configstore/tables/invite.go` | 新建 | 邀请表（含 ExpiresAt 过期字段） |
| `framework/configstore/tables/user_identity.go` | 新建 | TableUserIdentity 表（含联合唯一索引） |
| `config/validator.go` | 新建 | auth 配置启动时验证 |
| `handlers/auth/interface.go` | 新建 | AuthProvider 接口、AuthManager 管理器 |
| `handlers/auth/password.go` | 新建 | 内置密码认证提供者 |
| `handlers/auth/github.go` | 新建 | GitHub OAuth 认证提供者（可选） |
| `handlers/auth/wechat.go` | 新建 | 微信登录认证提供者（可选） |
| `handlers/virtualkey.go` | 新建 | VK CRUD API（admin 级别） |
| `handlers/virtualkey_user.go` | 新建 | 用户 VK 列表 API（按角色过滤） |
| `handlers/governance.go` | 修改 | 添加权限检查、角色过滤 |
| `handlers/invite.go` | 新建 | 邀请流程 API |
| `handlers/role.go` | 新建 | 自定义角色 CRUD API |
| `handlers/middlewares.go` | 修改 | 添加权限检查中间件 |
| `server/server.go` | 修改 | 注册新路由 |
| `plugins/governance/resolver.go` | 修改 | 多层预算评估 |
| `plugins/governance/permissions.go` | 新建 | RBAC 权限检查 |
| `ui/app/workspace/user/` | 新建 | 用户面板页面 |
| `ui/app/workspace/admin/users.tsx` | 修改 | 用户管理页面 |
| `ui/app/workspace/admin/roles.tsx` | 新建 | 角色管理页面 |

---

## 12. 执行顺序

```
Phase 1: 数据模型 + 认证解耦 + VK 管理
  ↓
Phase 2: RBAC 基础
  ↓
Phase 3: 预算继承
  ↓
Phase 4: 组织管理
  ↓
Phase 5: 自定义角色
  ↓
Phase 6: 前端集成
```

**总估算：21-26 个工作日（约 5 周）**

---

## 13. 向后兼容性

1. **数据库**：所有新增字段 nullable，现有数据无需迁移
2. **API**：现有 API 保持不变，新 API 只新增
3. **VK**：现有 VK 无 UserID（已移除），需要通过 TeamID/CustomerID 关联
4. **预算**：现有 Team/Customer 预算逻辑不变，新增 User 层预算

---

## 14. 验证清单

### 基础功能
- [ ] 单人用户注册时自动创建虚拟 Customer
- [ ] 单人用户自动成为虚拟 Customer 的 customer_owner
- [ ] 单人用户可以直接用 VK 调用 API（不需要 JWT）
- [ ] Team Admin 可以创建 VK（归属 Team）
- [ ] Customer Owner 可以创建 VK（归属 Customer）
- [ ] Team Member 只能查看 Team 内 VK，不能创建
- [ ] Admin 可以看到所有 VK
- [ ] 预算各层级独立检查（余额 > 0），任一层不足拒绝
- [ ] 请求完成后各层级独立扣除消耗量
- [ ] 邀请 token 7 天过期
- [ ] 邀请流程完整
- [ ] 自定义角色权限生效
- [ ] 前端界面完整可用

### 数据一致性
- [ ] VK 创建时必须指定 TeamID 或 CustomerID（二选一）
- [ ] 用户离开 Team 时 VK 归属不变，用户失去访问权限
- [ ] Team 删除时相关 VK 需要重新归属
- [ ] 用户角色变更影响可见 VK 范围

### 审计日志
- [ ] 登录/注册操作记录到 AuditLog
- [ ] 角色变更记录到 AuditLog
- [ ] 预算分配/调整记录到 AuditLog

## 15. 数据一致性规则

### VK 归属策略：只归属组织层级

> **重要变更**：VK 去掉 user_id，只归属 Team 或 Customer。

| 场景 | 处理方式 |
|------|---------|
| VK 创建 | 必须指定 TeamID 或 CustomerID（二选一） |
| 用户加入 Team | VK 归属不变，用户通过 Team 成员身份获得 VK 访问权限 |
| 用户离开 Team | VK 归属不变，用户失去该 Team VK 的访问权限 |
| 用户切换 Team | VK 归属不变，用户只能访问新 Team 的 VK |

### 角色转换副作用

| 场景 | 处理方式 |
|------|---------|
| 用户离开 Team | 用户失去该 Team VK 的访问权限，VK 本身保留 |
| Team 被删除 | 该 Team 下所有 VK 需要重新归属到 Customer 或新 Team |
| 用户角色变更 | 影响用户可见的 VK 范围和操作权限 |

### 单人用户模式

> **重要变更**：单人用户使用虚拟组织模式，不需要 user 角色。

```
单人用户注册时：
1. 系统自动创建一个"个人 Customer"（虚拟组织）
2. 用户成为这个虚拟 Customer 的 Owner（customer_owner 角色）
3. VK 绑定到这个虚拟 Customer
4. 不需要 JWT，直接用 VK 调用 API
```

## 16. 审计日志设计

### AuditLog 表

```go
// framework/configstore/tables/audit_log.go
type TableAuditLog struct {
    ID          uint      `gorm:"primaryKey;autoIncrement" json:"id"`
    UserID      uint      `gorm:"index;not null" json:"user_id"`
    Action      string    `gorm:"type:varchar(50);not null;index" json:"action"`
    // action 类型: login, register, role_change, budget_allocate, vk_create, vk_delete
    Resource    string    `gorm:"type:varchar(50);index" json:"resource"`
    // resource 类型: user, virtual_key, team, customer, budget
    ResourceID  string    `gorm:"type:varchar(255)" json:"resource_id"`
    BeforeState string    `gorm:"type:text" json:"before_state,omitempty"`
    AfterState  string    `gorm:"type:text" json:"after_state,omitempty"`
    IPAddress   string    `gorm:"type:varchar(45)" json:"ip_address"`
    CreatedAt   time.Time `gorm:"index;not null" json:"created_at"`
}
```

### 需要记录的操作

- 用户登录/注册
- 角色变更
- 预算分配/调整
- VK 创建/删除
- Team/Customer 创建/删除

## 17. 配置验证

### 启动时验证规则

```go
// config/validator.go
func ValidateAuthConfig(config *AuthConfig) error {
    enabledProviders := 0
    for name, provider := range config.Methods {
        if provider.Enabled {
            enabledProviders++
            // 验证必需字段
            switch name {
            case "company_sso":
                if provider.IssuerURL == "" {
                    return fmt.Errorf("company_sso 配置缺少 issuer_url")
                }
            case "github":
                if provider.ClientID == "" || provider.ClientSecret == "" {
                    return fmt.Errorf("github 配置缺少 client_id 或 client_secret")
                }
            }
        }
    }
    if enabledProviders == 0 {
        return errors.New("至少需要启用一种认证方式")
    }
    return nil
}
```

## 18. 测试覆盖

### 边界测试

- [ ] 用户无 VK 时调用 API（应返回 403 或提示创建 VK）
- [ ] VK 预算耗尽时被拒绝（应返回 429 或预算超限错误）
- [ ] Team 预算耗尽时相关 VK 被拒绝
- [ ] Customer 预算耗尽时相关 VK 被拒绝
- [ ] 预算各层级独立检查正确（余额 > 0）

### 并发测试

- [ ] 多个请求同时检查预算时的竞态条件（原子操作）
- [ ] 多个用户同时接受邀请时的冲突处理
- [ ] 同时创建多个 VK 时的唯一性约束

### 权限测试

- [ ] team_member 只能查看 Team 内 VK
- [ ] team_member 不能创建 VK
- [ ] team_admin 可以创建 VK（归属 Team）
- [ ] team_admin 对 Team 和 Budget 只有 R 权限
- [ ] customer_owner 可以管理本组织所有资源
- [ ] admin 可以管理所有资源

### 认证解耦测试

- [ ] 密码登录正常工作
- [ ] 注册时自动创建 TableUserIdentity
- [ ] AuthProvider 接口可扩展
- [ ] config.json 配置认证方式生效
- [ ] 第三方登录（GitHub）OAuth 流程正常（可选）
- [ ] 多登录方式绑定/解绑正常
- [ ] 外部 SSO 集成预留接口可用（可选）

