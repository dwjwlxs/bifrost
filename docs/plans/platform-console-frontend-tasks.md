# Platform Console 前端任务拆分

> 基于 `docs/plans/platform-multi-tenant-v2.md` 实施方案
> 对标现有 `ui/app/platform/` 已有代码，梳理差距并拆分为可独立交互的任务

---

## 现状分析

### 已有前端页面

| 页面 | 路径 | 状态 | 说明 |
|------|------|------|------|
| 登录 | `/platform/login` | ✅ 已有 | 需适配新 API 端点 |
| 注册 | `/platform/register` | ✅ 已有 | 需适配新 API 端点 |
| 邮箱验证 | `/platform/verify-email` | ✅ 已有 | 需适配新 API 端点 |
| Dashboard | `/platform/console/dashboard` | ✅ 已有 | 需展示 org/team 信息 |
| 我的 VK | `/platform/console/virtual-keys` | ✅ 已有 | 需适配新 API + team 绑定 |
| 组织管理 | `/platform/console/organizations` | ⚠️ 需重构 | 当前用 governance API，需改为 platform org API |
| 用量统计 | `/platform/console/usage` | ✅ 已有 | 基本不变 |
| 钱包 | `/platform/console/wallet` | ✅ 已有 | 基本不变 |
| RBAC | `/platform/console/rbac` | ✅ 已有 | 需适配新角色模型 |
| 个人资料 | `/platform/console/user/profile` | ✅ 已有 | 需适配新 API |
| 邀请接受 | `/platform/invite/:token` | ✅ 已有 | 需适配新 API |
| Admin 套餐 | `/platform/console/admin/packages` | ✅ 已有 | 基本不变 |
| Admin Provider | `/platform/console/admin/providers` | ✅ 已有 | 基本不变 |
| Admin 用户 | `/platform/console/admin/users` | ✅ 已有 | 需适配新角色模型 |
| Admin 模型价格 | `/platform/console/admin/model-prices` | ✅ 已有 | 基本不变 |

### 缺失页面（需新建）

| 页面 | 路径 | 说明 |
|------|------|------|
| Admin 组织管理 | `/platform/console/admin/orgs` | 系统管理员 CRUD 组织 |
| 组织详情 | `/platform/console/organizations/:orgId` | org_admin 查看团队/成员 |
| 团队详情 | `/platform/console/teams/:teamId` | team_admin 管理团队 |

### API 端点差异

现有前端使用 `/platform/governance/customers`、`/platform/governance/teams` 等端点。
实施方案定义了新的 `/api/platform/*` 端点体系，需要全面迁移。

---

## 任务拆分

### Task 1: API 层 + 认证 + 角色模型（基础层）

> 所有后续任务的前置依赖

**目标**: 将 platform API 客户端迁移到 v2 端点体系，更新 JWT claims 解析和角色模型

**改动文件**:
- `ui/lib/platform/platformBaseApi.ts` — 保持不变（已正确实现 Bearer token）
- `ui/lib/platform/auth.ts` — 更新 JWT claims 结构，新增 orgs/teams 解析
- `ui/lib/platform/hooks.ts` — 新增 org_admin 角色判断，重构 useUserRole
- `ui/lib/platform/platformApi.ts` — 更新所有端点 URL 和类型定义
- `ui/lib/platform/config.ts` — 更新导航项角色可见性

**核心功能**:
1. 更新 `PlatformJWTPayload` 接口，匹配 v2 JWT claims:
   ```
   { sub, email, is_admin, orgs: [{id, role}], teams: [{id, role}], exp, iat }
   ```
2. 更新 `PlatformUserInfo` 接口，新增 `orgs` 和 `teams` 字段
3. 新增类型: `PlatformOrgMember`, `PlatformTeamMember`, `PlatformInvitation`
4. 更新 `useUserRole` hook，支持 `org_admin` 角色判断
5. 新增 `useOrgRole(orgId)` 和 `useTeamRole(teamId)` hooks
6. 迁移 API 端点:
   - `/platform/governance/customers` → `/platform/admin/orgs` (admin) 和 `/platform/orgs` (user)
   - `/platform/governance/teams` → `/platform/orgs/:orgId/teams` 和 `/platform/teams`
   - `/platform/user/virtual-keys` → `/platform/virtual-keys`
   - `/platform/admin/teams/:id/members` → `/platform/teams/:id/members`
7. 更新 RTK Query tag types 和 cache invalidation

**后端接口**:
- `POST /api/platform/login` — 登录
- `POST /api/platform/register` — 注册
- `GET /api/platform/profile` — 用户信息
- `POST /api/platform/verify` — 邮箱验证

**权限**: 无（基础层，不涉及页面权限）

**验收标准**:
- [x] JWT 解析正确提取 orgs/teams
- [x] useUserRole 正确判断 admin/org_admin/team_admin/team_member
- [x] 所有 API 端点 URL 与实施方案一致
- [x] TypeScript 编译通过

---

### Task 2: Admin 组织管理页面（新建）

> 系统管理员创建和管理组织

**目标**: 新建 `/platform/console/admin/orgs` 页面，供系统管理员 CRUD 组织

**新建文件**:
- `ui/app/platform/console/admin/orgs/layout.tsx` — 路由定义 + admin 守卫
- `ui/app/platform/console/admin/orgs/page.tsx` — 组织列表 + 创建/编辑/删除

**核心功能**:
1. **组织列表**: 表格展示所有组织，列: 名称、ID、成员数、团队数、创建时间
2. **创建组织**: Dialog 表单 — 名称 + 管理员邮箱（指定 org_admin）
3. **编辑组织**: Dialog 表单 — 修改名称
4. **删除组织**: AlertDialog 二次确认
5. **组织详情入口**: 点击行跳转到 `/platform/console/organizations/:orgId`

**交互细节**:
- 创建时"管理员邮箱"字段必填，提示"该用户将成为组织管理员"
- 删除前 confirm 提示，告知将级联删除团队和成员
- 列表支持分页（offset/limit）
- 空状态: "暂无组织，点击创建"

**后端接口**:
| 操作 | 方法 | 端点 | 中间件 |
|------|------|------|--------|
| 列表 | GET | `/api/platform/admin/orgs` | RequireAdmin |
| 创建 | POST | `/api/platform/admin/orgs` | RequireAdmin |
| 详情 | GET | `/api/platform/admin/orgs/:orgId` | RequireAdmin |
| 修改 | PUT | `/api/platform/admin/orgs/:orgId` | RequireAdmin |
| 删除 | DELETE | `/api/platform/admin/orgs/:orgId` | RequireAdmin |

**权限**: `is_admin === true`

**验收标准**:
- [ ] 非 admin 用户看不到此页面（sidebar 隐藏 + layout 守卫）
- [ ] 创建组织后列表自动刷新
- [ ] 删除组织有二次确认
- [ ] 表单验证完整（名称必填、管理员邮箱格式）

---

### Task 3: 组织详情页面（新建）

> org_admin 查看组织下的团队和成员

**目标**: 新建 `/platform/console/organizations/:orgId` 页面，展示组织详情

**新建文件**:
- `ui/app/platform/console/organizations/[orgId]/layout.tsx` — 路由定义
- `ui/app/platform/console/organizations/[orgId]/page.tsx` — 组织详情页

**重构文件**:
- `ui/app/platform/console/organizations/page.tsx` — 改为用户所属组织列表（当前是 customers 列表）

**核心功能**:
1. **组织概览**: 名称、ID、成员数、团队数
2. **团队列表 Tab**: 本组织下所有团队，列: 名称、成员数、VK 数、操作
   - 点击团队名跳转到 `/platform/console/teams/:teamId`
   - org_admin 可创建新团队
3. **成员列表 Tab**: 本组织下所有成员，列: 邮箱、角色、加入时间、操作
   - org_admin 可移除成员
   - org_admin 可邀请新成员（邮箱输入 + 角色选择）

**交互细节**:
- 团队列表和成员列表用 Tabs 切换
- 创建团队 Dialog: 名称 + 可选关联 customer_id
- 邀请成员 Dialog: 邮箱 + 角色(admin/member) + 可选团队
- 移除成员 AlertDialog 二次确认，提示"将级联删除该成员在所有团队的 membership"

**后端接口**:
| 操作 | 方法 | 端点 | 中间件 |
|------|------|------|--------|
| 组织详情 | GET | `/api/platform/orgs/:orgId` | RequireOrgMember |
| 组织团队 | GET | `/api/platform/orgs/:orgId/teams` | RequireOrgAdmin |
| 组织成员 | GET | `/api/platform/orgs/:orgId/members` | RequireOrgAdmin |
| 创建团队 | POST | `/api/platform/orgs/:orgId/teams` | RequireOrgAdmin |

**权限**:
- 查看详情: `org_member`（orgs 中包含该 orgId）
- 查看团队/成员: `org_admin`（orgs 中该 orgId 的 role === 'admin'）

**验收标准**:
- [ ] org_admin 能看到组织下的团队和成员
- [ ] team_member 只能看到组织概览，看不到团队/成员列表
- [ ] 创建团队后列表刷新
- [ ] 路由参数 orgId 正确解析

---

### Task 4: 团队详情与管理页面（新建）

> team_admin 管理团队信息、成员、VK

**目标**: 新建 `/platform/console/teams/:teamId` 页面，完整的团队管理功能

**新建文件**:
- `ui/app/platform/console/teams/[teamId]/layout.tsx` — 路由定义
- `ui/app/platform/console/teams/[teamId]/page.tsx` — 团队详情页

**核心功能**:
1. **团队信息卡片**: 名称、所属组织、创建时间
   - team_admin 可编辑名称
   - team_admin 可设置预算（budget_limit, reset_duration）
2. **成员管理 Tab**:
   - 成员列表: 邮箱、角色、加入时间
   - 邀请成员: 邮箱输入 + 角色选择(team_admin/team_member)
   - 移除成员: 二次确认
   - 修改角色: Select 下拉切换 team_admin/team_member
3. **Virtual Keys Tab**:
   - 本团队下所有 VK 列表
   - team_admin 可修改 VK 预算
   - 显示 VK 名称、状态、当前用量、预算上限

**交互细节**:
- 团队信息和成员/VK 用 Tabs 切换
- 邀请成员时，如果邮箱已注册则直接加入；未注册则发送邀请邮件
- 修改角色后需重新签发 JWT（前端替换 token）
- 移除成员提示"将可选删除该成员在本团队下的 VK"
- VK 预算编辑 Inline Dialog，不用跳转页面

**后端接口**:
| 操作 | 方法 | 端点 | 中间件 |
|------|------|------|--------|
| 团队详情 | GET | `/api/platform/teams/:teamId` | RequireTeamMember |
| 修改团队 | PUT | `/api/platform/teams/:teamId` | RequireTeamAdmin |
| 成员列表 | GET | `/api/platform/teams/:teamId/members` | RequireTeamMember |
| 邀请成员 | POST | `/api/platform/teams/:teamId/members` | RequireTeamAdmin |
| 移除成员 | DELETE | `/api/platform/teams/:teamId/members/:uid` | RequireTeamAdmin |
| 修改角色 | PUT | `/api/platform/teams/:teamId/members/:uid` | RequireTeamAdmin |
| 团队 VK | GET | `/api/platform/teams/:teamId/virtual-keys` | RequireTeamAdmin |
| 修改 VK 预算 | PUT | `/api/platform/teams/:teamId/virtual-keys/:vkId` | RequireTeamAdmin |

**权限**:
- 查看: `team_member`（teams 中包含该 teamId）
- 管理: `team_admin`（teams 中该 teamId 的 role === 'admin'）或 `org_admin`

**验收标准**:
- [ ] team_member 能查看但不能编辑
- [ ] team_admin 能完整管理团队
- [ ] org_admin 自动拥有 team_admin 权限
- [ ] 成员操作后列表正确刷新
- [ ] VK 预算编辑即时生效

---

### Task 5: VK 管理页面更新（重构）

> 适配新 API 端点，新增 team 绑定功能

**目标**: 更新现有 VK 页面，使用新的 API 端点，支持创建时选择绑定团队

**改动文件**:
- `ui/app/platform/console/virtual-keys/page.tsx` — 更新 API 调用 + team 选择
- `ui/app/platform/console/user/my-keys/page.tsx` — 如保留则同步更新

**核心功能**（在现有基础上新增）:
1. **创建 VK 表单新增字段**:
   - "绑定团队" Select（可选）: 列出用户所属的团队
   - 选择后 VK 的 team_id 自动设置
2. **VK 列表新增列**:
   - 所属团队（显示 team 名称或"—"）
   - 预算用量（budget_limit / current_usage）
3. **VK 详情面板**（可选，点击行展开）:
   - 完整信息: 名称、描述、状态、团队、预算、用量、创建时间

**交互细节**:
- 创建时选择团队是可选的，不选则 VK 仅绑定 user_id
- 团队下拉只列出用户有 admin 权限的团队
- VK 值默认脱敏显示（已有实现，保持不变）
- 删除二次确认（已有实现，保持不变）

**后端接口**:
| 操作 | 方法 | 端点 | 中间件 |
|------|------|------|--------|
| 列表 | GET | `/api/platform/virtual-keys` | RequireAuth |
| 创建 | POST | `/api/platform/virtual-keys` | RequireAuth |
| 详情 | GET | `/api/platform/virtual-keys/:vkId` | RequireVKOwner |
| 修改 | PUT | `/api/platform/virtual-keys/:vkId` | RequireVKOwner |
| 删除 | DELETE | `/api/platform/virtual-keys/:vkId` | RequireVKOwner |

**权限**: `RequireAuth`（创建/列表），`RequireVKOwner`（修改/删除自己的 VK）

**验收标准**:
- [ ] 创建 VK 时可选择绑定团队
- [ ] 列表正确显示团队信息
- [ ] 用户只能操作自己的 VK
- [ ] 脱敏显示和复制功能正常

---

### Task 6: Dashboard + 侧边栏 + 导航更新

> 更新 Dashboard 展示 org/team 信息，更新侧边栏导航

**目标**: Dashboard 展示用户的组织/团队 membership，侧边栏新增导航项

**改动文件**:
- `ui/app/platform/console/dashboard/page.tsx` — 新增 org/team 信息卡片
- `ui/app/platform/components/consoleSidebar.tsx` — 新增导航项
- `ui/lib/platform/config.ts` — 新增 nav items

**核心功能**:
1. **Dashboard 新增卡片**:
   - "我的组织" 卡片: 显示用户所属组织列表，点击跳转详情
   - "我的团队" 卡片: 显示用户所属团队列表，点击跳转详情
   - 角色标识: 显示当前用户在各组织/团队中的角色
2. **侧边栏新增导航项**:
   - "团队" (Teams) — 链接到用户所属团队列表
   - Admin 分组下新增 "组织管理" (Organizations) — 链接到 admin orgs 页面
3. **角色可见性**:
   - "组织管理" 仅 is_admin 可见
   - "团队" 所有登录用户可见

**交互细节**:
- Dashboard 的 org/team 卡片从 JWT claims 中解析（无需额外 API 调用）
- 如果用户不属于任何组织，显示空状态 + 提示"联系管理员邀请"
- 侧边栏 active 状态正确匹配嵌套路由

**后端接口**:
- 无新增（数据来自 JWT claims 和已有 API）

**权限**: `RequireAuth`（Dashboard），`is_admin`（Admin 导航项）

**验收标准**:
- [ ] Dashboard 正确显示用户的 org/team 信息
- [ ] 侧边栏导航项角色过滤正确
- [ ] 空状态提示友好
- [ ] 路由跳转正确

---

### Task 7: 登录/注册/邀请流程更新

> 适配新的认证端点和邀请流程

**目标**: 更新登录、注册、邀请接受页面，使用 v2 API 端点

**改动文件**:
- `ui/app/platform/login/page.tsx` — 更新 API 调用
- `ui/app/platform/register/page.tsx` — 更新 API 调用
- `ui/app/platform/verify-email/page.tsx` — 更新 API 调用
- `ui/app/platform/invite/invite-token/invite.tsx` — 更新 API 调用
- `ui/lib/store/apis/baseApi.ts` — 确认 401 隔离逻辑

**核心功能**:
1. **登录页**:
   - 调用 `POST /api/platform/login`
   - 成功后存储 JWT 到 localStorage
   - 解析 JWT claims → 存储用户信息
   - 跳转到 `/platform/console/dashboard`
2. **注册页**:
   - 调用 `POST /api/platform/register`
   - 成功后跳转到邮箱验证页
3. **邮箱验证页**:
   - 调用 `POST /api/platform/verify`
   - 成功后自动登录（存储 JWT）
4. **邀请接受页**:
   - 调用 `POST /api/platform/invitations/:token/accept`
   - 成功后提示"已加入组织/团队" + 跳转登录
5. **baseApi.ts 401 隔离**:
   - 确认 `/platform/*` 路径的 401 不会触发 workspace 的 clearAuthStorage

**交互细节**:
- 登录失败显示具体错误（凭据错误 / 邮箱未验证 / 账号被禁用）
- 注册表单: 邮箱 + 用户名 + 密码 + 确认密码 + 昵称(可选)
- 邮件验证页显示"未收到邮件？重新发送"按钮
- 邀请接受页需先登录（未登录跳转登录页，登录后自动回到邀请页）

**后端接口**:
| 操作 | 方法 | 端点 | 中间件 |
|------|------|------|--------|
| 登录 | POST | `/api/platform/login` | 无 |
| 注册 | POST | `/api/platform/register` | 无 |
| 验证邮箱 | POST | `/api/platform/verify` | 无 |
| 重发验证 | POST | `/auth/resend-verification` | 无 |
| 接受邀请 | POST | `/api/platform/invitations/:token/accept` | 无 |

**权限**: 无（公开页面）

**验收标准**:
- [ ] 登录成功后 JWT 正确存储
- [ ] JWT claims 正确解析并存储用户信息
- [ ] 401 隔离不影响 workspace 页面
- [ ] 邀请接受流程完整（未登录 → 登录 → 接受）
- [ ] 错误提示友好明确

---

## 任务依赖关系

```
Task 1 (API 层基础)
  ├── Task 2 (Admin Org 页面)
  ├── Task 3 (组织详情页面)
  │     └── Task 4 (团队详情页面)
  ├── Task 5 (VK 页面更新)
  ├── Task 6 (Dashboard + 导航)
  └── Task 7 (登录/注册/邀请)
```

**Task 1 必须最先完成**，其余任务可并行但建议按编号顺序执行以保持一致性。

---

## 执行顺序建议

1. **Task 1** — API 层基础（~2h）
2. **Task 7** — 登录/注册流程（~1.5h）— 验证 API 层可用
3. **Task 6** — Dashboard + 导航（~1h）— 搭建页面骨架
4. **Task 5** — VK 页面更新（~1.5h）— 验证核心 CRUD
5. **Task 2** — Admin Org 页面（~2h）
6. **Task 3** — 组织详情页面（~2h）
7. **Task 4** — 团队详情页面（~3h）— 最复杂，依赖 Task 3

**预估总工时**: ~13h

---

## 通用约定（所有任务遵循）

### UI 组件
- 使用 shadcn/ui 组件库（已在项目中配置）
- Dialog 用于创建/编辑表单
- AlertDialog 用于删除确认
- Card + Table 用于列表展示
- Badge 用于状态/角色标识
- Tabs 用于多视图切换

### 状态管理
- RTK Query 管理所有 API 调用
- 本地状态用 useState（表单、Dialog 开关）
- URL 参数用 nuqs（分页、筛选）

### 错误处理
- toast.error() 显示 API 错误
- 表单内联验证错误
- Loading 状态用 spinner

### 命名规范
- 页面组件: PascalCase（如 `OrgDetailPage`）
- Hook: camelCase，use 前缀（如 `useTeamRole`）
- API endpoints: camelCase（如 `platformListOrgs`）
- 路由文件: kebab-case（如 `admin/orgs/`）

### 文件结构
```
ui/app/platform/console/
├── admin/
│   ├── orgs/          ← Task 2 (新建)
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── packages/      ← 已有
│   ├── providers/     ← 已有
│   ├── users/         ← 已有
│   └── model-prices/  ← 已有
├── organizations/
│   ├── page.tsx       ← Task 3 (重构)
│   └── [orgId]/       ← Task 3 (新建)
│       ├── layout.tsx
│       └── page.tsx
├── teams/
│   └── [teamId]/      ← Task 4 (新建)
│       ├── layout.tsx
│       └── page.tsx
├── virtual-keys/      ← Task 5 (更新)
├── dashboard/         ← Task 6 (更新)
├── usage/             ← 已有
├── wallet/            ← 已有
└── user/              ← 已有
```
