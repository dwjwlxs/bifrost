# C 端用户账号系统 — 实施方案与计划

> **版本**: v1.0  
> **日期**: 2026-04-30  
> **状态**: 规划中  
> **负责人**: —

---

## 目录

1. [需求背景与上下文](#1-需求背景与上下文)
2. [决策过程与依据](#2-决策过程与依据)
3. [系统架构设计](#3-系统架构设计)
4. [数据模型](#4-数据模型)
5. [API 设计](#5-api-设计)
6. [Epic / Story 分解](#6-epic--story-分解)
7. [迭代计划](#7-迭代计划)
8. [安全清单](#8-安全清单)
9. [延后事项（Post-MVP）](#9-延后事项post-mvp)
10. [风险与缓解](#10-风险与缓解)

---

## 1. 需求背景与上下文

### 1.1 业务背景

我们需要构建一个面向 C 端（消费者）用户的账号系统，支撑大规模用户注册、认证和会话管理。该系统将作为所有业务线的用户身份底座，需要满足以下核心诉求：

- **大规模**：预期用户量百万级以上，系统需具备水平扩展能力
- **多端接入**：Web、iOS、Android、小程序等多端统一认证
- **安全合规**：满足 GDPR / PIPL 等隐私法规要求
- **快速接入**：业务方只需对接标准认证协议即可接入

### 1.2 核心需求

| # | 需求 | 优先级 | 说明 |
|---|---|---|---|
| R1 | 邮箱 + 密码注册/登录 | P0 | 基础认证方式 |
| R2 | OAuth2 社交登录 | P0 | 至少支持 Weixin，降低注册门槛 |
| R3 | 手机号 + 短信验证码 | P0 | ~~特定市场（如中国大陆）的刚需~~ (mvp阶段不做) |
| R4 | 邮箱验证 | P0 | 6 位数字验证码，15 分钟有效 |
| R5 | 密码重置 | P0 | 通过邮箱发送重置链接 |
| R6 | JWT 认证体系 | P0 | Access Token + Refresh Token 机制 |
| R7 | 安全防护 | P0 | 限流、锁定、人机验证 |
| R8 | 会话管理 | P1 | 多设备会话查看与逐个撤销 |
| R9 | 个人资料管理 | P1 | 查看/修改基本信息 |
| R10 | 账号注销 | P1 | 软删除 + 30 天冷静期 |

### 1.3 非功能性需求

| 维度 | 目标 |
|---|---|
| **可用性** | 99.9% SLA |
| **性能** | 认证接口 P99 < 200ms（不含第三方依赖） |
| **扩展性** | 支持水平分片，单分片支持 500 万用户 |
| **安全性** | 通过 OWASP ASVS Level 2 认证 |

---

## 2. 决策过程与依据

### 2.1 JWT 签名算法：ES256（非对称）

**决策**：采用 ES256（ECDSA P-256）进行 JWT 签名，而非 HS256（HMAC 对称加密）。

**决策依据**：

| 考量维度 | HS256（对称） | ES256（非对称） | 决策倾向 |
|---|---|---|---|
| 安全模型 | 验证方也能签发 token | 验证方无法签发 token | ✅ 非对称 |
| 微服务适配 | 所有服务共享 secret | 公钥公开分发（JWKS） | ✅ 非对称 |
| 密钥泄露影响 | 全局沦陷 | 仅影响签发方 | ✅ 非对称 |
| 密钥轮换 | 需要同步更新所有服务 | Auth Server 单点轮换 | ✅ 非对称 |
| 性能 | ~0.001ms/次 | ~0.1ms/次 | — 差异可忽略 |
| Token 体积 | 较小 | 稍大（64 bytes 签名） | — 差异可忽略 |

**结论**：性能差异相比网络 I/O 可忽略不计，但非对称方案在安全性和扩展性上有决定性优势。从第一天就采用非对称方案，避免未来架构演进时的迁移成本。

### 2.2 Token 体系：双 Token + 轮换

**决策**：Access Token（短期 JWT）+ Refresh Token（长期，服务端存储，单次使用）。

| 参数 | Access Token | Refresh Token |
|---|---|---|
| 格式 | JWT (ES256) | 不透明随机字符串 |
| 有效期 | 15 分钟 | 30 天 |
| 存储 | 客户端内存 | 服务端 Redis + 客户端 HttpOnly Cookie |
| 轮换 | 短期自然过期 | 每次使用后旧 token 失效，发放新 token |

**为什么 Refresh Token 要轮换？**  
如果 Refresh Token 被窃取，攻击者和合法用户都能使用它。轮换机制下，一旦合法用户使用旧 token，服务端会检测到重放攻击（旧 token 已被标记为已使用），立即撤销该 token 家族下的所有 token，强制重新登录。

### 2.3 密码哈希：Argon2id

**决策**：使用 Argon2id，而非 bcrypt 或 scrypt。

| 算法 | 推荐度 | 原因 |
|---|---|---|
| Argon2id | ⭐⭐⭐⭐⭐ | 2015 年 Password Hashing Competition 冠军，抗 GPU/ASIC，兼顾侧信道安全 |
| bcrypt | ⭐⭐⭐ | 老牌可靠，但抗 GPU 能力不如 Argon2 |
| scrypt | ⭐⭐⭐ | 抗 ASIC 好，但不如 Argon2id 综合最优 |

**推荐参数**（OWASP 建议）：
- 内存：19 MB（`memory=19456`）
- 迭代：2（`iterations=2`）
- 并行度：1（`parallelism=1`）

### 2.4 用户 ID：UUID v7

**决策**：使用 UUID v7 作为用户主键。

| 方案 | 优点 | 缺点 |
|---|---|---|
| 自增整数 | 简单、索引友好 | 可预测、分布式冲突、暴露业务量 |
| UUID v4 | 不可预测 | 完全随机，索引碎片严重 |
| **UUID v7** | **时间有序 + 随机性，索引友好，无需协调** | 较新标准 |

UUID v7 前 48 位为毫秒时间戳，后 74 位为随机数，兼具有序性（B+ 树插入友好）和唯一性。

---

## 3. 系统架构设计

### 3.1 整体架构

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Web App     │   │  iOS/Android │   │   小程序       │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       └──────────┬───────┴──────────────────┘
                  │ HTTPS
                  ▼
         ┌────────────────┐
         │   API Gateway   │  ← 限流、WAF、CORS
         │   (Kong/Nginx)  │
         └────────┬───────┘
                  │
                  ▼
         ┌────────────────┐     ┌──────────────────┐
         │  Auth Service   │────▶│  JWKS Endpoint   │
         │  (签发 JWT)      │     │  /.well-known/   │
         └────────┬───────┘     │  jwks.json       │
                  │             └────────┬─────────┘
                  │                      │
       ┌──────────┼──────────────────────┘
       │          │ 获取公钥验证
       ▼          ▼
┌────────────┐  ┌────────────┐  ┌────────────┐
│  业务服务 A  │  │  业务服务 B  │  │  业务服务 C  │
└────────────┘  └────────────┘  └────────────┘

       │
       ▼
┌────────────┐  ┌────────────┐  ┌────────────┐
│ PostgreSQL │  │   Redis     │  │  消息队列    │
│ (主存储)    │  │ (会话/限流)  │  │ (异步任务)  │
└────────────┘  └────────────┘  └────────────┘
```

### 3.2 认证流程

#### 注册流程

```
Client                  Auth Server                Email/SMS
  │                        │                          │
  │  POST /auth/register   │                          │
  │───────────────────────▶│                          │
  │                        │  创建用户 (status=pending) │
  │                        │  生成验证码 (哈希存储)      │
  │                        │─────────────────────────▶│  发送验证码
  │     200 用户已创建       │                          │
  │◀───────────────────────│                          │
  │                        │                          │
  │  POST /auth/verify     │                          │
  │───────────────────────▶│                          │
  │                        │  校验哈希、检查过期/次数    │
  │                        │  更新 status=active       │
  │                        │  签发 JWT + Refresh Token │
  │     200 Token 返回      │                          │
  │◀───────────────────────│                          │
```

#### 登录流程

```
Client                  Auth Server                Redis
  │                        │                        │
  │  POST /auth/login      │                        │
  │  {email, password}     │                        │
  │───────────────────────▶│                        │
  │                        │  Argon2id 验证密码       │
  │                        │  检查账号状态             │
  │                        │  检查锁定状态             │
  │                        │  签发 JWT (ES256)       │
  │                        │  生成 Refresh Token     │
  │                        │──────────────────────▶│  存储 RT
  │     200 Token 返回      │                        │
  │◀───────────────────────│                        │
```

#### Token 轮换流程

```
Client                  Auth Server                Redis
  │                        │                        │
  │  POST /auth/refresh    │                        │
  │  {refresh_token}       │                        │
  │───────────────────────▶│                        │
  │                        │  查询 RT 是否存在        │
  │                        │◀──────────────────────│
  │                        │  检查是否已使用(重放检测) │
  │                        │  标记旧 RT 为已使用      │
  │                        │  签发新 JWT             │
  │                        │  生成新 RT              │
  │                        │──────────────────────▶│  存储新 RT
  │     200 新 Token 对     │                        │
  │◀───────────────────────│                        │
```

### 3.3 JWKS 公钥分发机制

```
Auth Server                          Resource Server
    │                                      │
    │  启动时加载 ES256 密钥对               │
    │  暴露 /.well-known/jwks.json         │
    │  { keys: [{ kid, kty, crv, x, y }] } │
    │                                      │
    │◀──────────── GET jwks.json ──────────│  首次验证时获取
    │                                      │  缓存公钥（Cache-Control: max-age=3600）
    │                                      │
    │  密钥轮换时：                          │
    │  1. 新增密钥对（新 kid）               │
    │  2. JWKS 返回新旧两个 key              │
    │  3. 旧 key 标记过期但仍可验证           │
    │  4. 过渡期后移除旧 key                 │
```

---

## 4. 数据模型

### 4.1 ER 图

```
┌─────────────────┐       ┌──────────────────┐
│     users        │       │    identities     │
├─────────────────┤       ├──────────────────┤
│ id (UUID v7) PK │◀──┐   │ id (UUID v7) PK  │
│ email           │   │   │ user_id (FK)     │
│ email_normalized│   │   │ provider (ENUM)  │
│ phone (E.164)   │   ├───│ provider_uid     │
│ password_hash   │   │   │ metadata (JSONB) │
│ status (ENUM)   │   │   │ created_at       │
│ created_at      │   │   └──────────────────┘
│ updated_at      │   │
│ deleted_at      │   │   ┌──────────────────┐
└─────────────────┘   │   │    sessions       │
                      │   ├──────────────────┤
                      ├───│ id (UUID v7) PK  │
                      │   │ user_id (FK)     │
                      │   │ refresh_token_hash│
                      │   │ token_family     │
                      │   │ device_info      │
                      │   │ ip_address       │
                      │   │ expires_at       │
                      │   │ created_at       │
                      │   └──────────────────┘
                      │
                      │   ┌──────────────────┐
                      │   │ verification_codes│
                      │   ├──────────────────┤
                      └───│ id (UUID v7) PK  │
                          │ user_id (FK)     │
                          │ code_type (ENUM) │
                          │ code_hash        │
                          │ attempts         │
                          │ expires_at       │
                          │ verified_at      │
                          │ created_at       │
                          └──────────────────┘
```

### 4.2 表结构定义

#### users

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL,
    email_normalized VARCHAR(255) UNIQUE NOT NULL,  -- 小写 + 去空格
    phone           VARCHAR(20),                     -- E.164 格式
    password_hash   VARCHAR(255),                    -- Argon2id, 社交登录可为 NULL
    status          VARCHAR(20) NOT NULL DEFAULT 'pending_verification'
                    CHECK (status IN ('pending_verification','active','suspended','deleted')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ                      -- 软删除标记
);

CREATE INDEX idx_users_email_normalized ON users(email_normalized) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_users_status ON users(status) WHERE deleted_at IS NULL;
```

#### identities（多身份表 — 支持同一用户多种登录方式）

```sql
CREATE TABLE identities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider        VARCHAR(20) NOT NULL CHECK (provider IN ('email','google','apple','phone')),
    provider_uid    VARCHAR(255) NOT NULL,  -- OAuth sub / 手机号
    metadata        JSONB DEFAULT '{}',     -- provider 特有数据
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider, provider_uid)
);

CREATE INDEX idx_identities_user_id ON identities(user_id);
```

#### sessions

```sql
CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  VARCHAR(64) NOT NULL,  -- SHA-256(原 token)
    token_family        UUID NOT NULL,          -- 同一家族的 RT 共享此 ID
    is_used             BOOLEAN DEFAULT FALSE,   -- 重放检测
    device_info         VARCHAR(500),
    ip_address          INET,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_refresh_token ON sessions(refresh_token_hash);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

#### verification_codes

```sql
CREATE TABLE verification_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,  -- 注册前可能无 user
    code_type       VARCHAR(20) NOT NULL CHECK (code_type IN ('email_verify','password_reset','phone_verify')),
    code_hash       VARCHAR(64) NOT NULL,  -- SHA-256(验证码)，不存明文
    recipient       VARCHAR(255) NOT NULL,  -- 邮箱或手机号
    attempts        SMALLINT DEFAULT 0,
    expires_at      TIMESTAMPTZ NOT NULL,
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_verification_codes_recipient ON verification_codes(recipient, code_type)
    WHERE verified_at IS NULL;
```

### 4.3 Redis 数据结构

| Key 模式 | 类型 | TTL | 用途 |
|---|---|---|---|
| `session:{rt_hash}` | Hash | 30d | Refresh Token 信息（快速验证） |
| `ratelimit:login:{ip}` | String (counter) | 15min | 登录限流计数 |
| `ratelimit:login:{email}` | String (counter) | 15min | 按账号限流 |
| `ratelimit:register:{ip}` | String (counter) | 1h | 注册限流 |
| `lockout:{user_id}` | String | 15min/指数退避 | 账号锁定标记 |
| `jwks:cache` | String | 1h | JWKS 缓存（Resource Server 侧） |

---

## 5. API 设计

### 5.1 认证接口

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | `/auth/register` | 邮箱/手机注册 | 无 |
| POST | `/auth/login` | 邮箱密码登录 | 无 |
| POST | `/auth/oauth/{provider}` | OAuth2 社交登录 | 无 |
| POST | `/auth/phone/login` | 手机号 + 验证码登录 | 无 |
| POST | `/auth/verify` | 提交验证码 | 无 |
| POST | `/auth/refresh` | Token 轮换 | 无（携带 RT） |
| POST | `/auth/logout` | 登出（撤销 RT） | Access Token |
| POST | `/auth/forgot-password` | 请求密码重置 | 无 |
| POST | `/auth/reset-password` | 提交新密码 | 无 |

### 5.2 用户接口

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/auth/me` | 获取当前用户资料 | Access Token |
| PATCH | `/auth/me` | 修改资料 | Access Token |
| POST | `/auth/me/change-email` | 发起邮箱变更 | Access Token |
| POST | `/auth/me/change-password` | 修改密码 | Access Token |
| DELETE | `/auth/me` | 请求注销账号 | Access Token |
| GET | `/auth/me/sessions` | 列出活跃会话 | Access Token |
| DELETE | `/auth/me/sessions/{id}` | 撤销指定会话 | Access Token |

### 5.3 JWKS 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/auth/.well-known/jwks.json` | 公钥分发（RFC 7517） |

### 5.4 JWT Payload 结构

```json
{
  "sub": "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  "iss": "https://auth.example.com",
  "aud": "https://api.example.com",
  "exp": 1714480200,
  "iat": 1714479300,
  "kid": "key-2026-04-v1",
  "scope": "read write",
  "session_id": "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"
}
```

> **注意**：JWT payload 是 Base64 编码（非加密），永远不要在 payload 中放入敏感信息（密码、手机号等）。

---

## 6. Epic / Story 分解

### Epic 1: 用户注册与认证（P0）

| Story ID | Story | 验收标准 | 故事点 |
|---|---|---|---|
| E1-S1 | 邮箱密码注册 | 输入邮箱+密码 → 创建用户(status=pending) → 发送验证码邮件 → 返回 200 | 5 |
| E1-S2 | 邮箱验证 | 输入验证码 → 校验哈希 → 状态变为 active → 签发 Token 对 | 3 |
| E1-S3 | 邮箱密码登录 | 输入邮箱+密码 → Argon2id 验证 → 检查状态/锁定 → 签发 Token 对 | 5 |
| E1-S4 | 验证码安全机制 | 6 位数字、15 分钟过期、哈希存储、最多 5 次尝试 | 2 |
| E1-S5 | Google OAuth2 登录 | 跳转 Google 授权 → 回调处理 → 创建/关联 identity → 签发 Token 对 | 5 |
| E1-S6 | 手机号 + 短信验证码登录 | 输入手机号 → 发送验证码 → 验证 → 创建/登录 → 签发 Token 对 | 5 |
| E1-S7 | 注册限流与人机验证 | 单 IP 每小时限 10 次注册，集成 Turnstile 验证 | 3 |

### Epic 2: Token 体系与 JWKS（P0）

| Story ID | Story | 验收标准 | 故事点 |
|---|---|---|---|
| E2-S1 | JWT 签发（ES256） | Auth Server 启动时加载 ES256 密钥对，签发包含标准 claims 的 JWT | 5 |
| E2-S2 | JWKS Endpoint | 暴露 `/.well-known/jwks.json`，返回公钥（含 kid），支持 Cache-Control | 3 |
| E2-S3 | Refresh Token 轮换 | 使用 RT 换取新 Token 对，旧 RT 标记为已使用，检测重放攻击 | 5 |
| E2-S4 | Token 家族重放检测 | 检测到 RT 重用 → 撤销该 token_family 下所有 session → 强制重新登录 | 3 |
| E2-S5 | 密钥轮换机制 | 支持新旧密钥并存过渡（JWKS 多 kid），过渡期后自动移除旧 key | 3 |

### Epic 3: 密码与安全（P0）

| Story ID | Story | 验收标准 | 故事点 |
|---|---|---|---|
| E3-S1 | 密码哈希（Argon2id） | 注册/修改密码时使用 Argon2id 哈希，参数符合 OWASP 建议 | 3 |
| E3-S2 | 密码重置 | 请求重置 → 发送邮件（含时效 token）→ 验证 token → 设置新密码 | 5 |
| E3-S3 | 登录失败锁定 | 连续 5 次失败 → 账号锁定 15 分钟 → 指数退避 | 3 |
| E3-S4 | 登录限流 | 单 IP 15 分钟内限 20 次登录请求，单账号 15 分钟限 10 次 | 2 |
| E3-S5 | 已泄露密码检查 | 注册/修改密码时通过 HaveIBeenPwned k-anonymity API 检查 | 2 |

### Epic 4: 会话与资料管理（P1）

| Story ID | Story | 验收标准 | 故事点 |
|---|---|---|---|
| E4-S1 | 活跃会话列表 | 返回当前用户所有未过期 session（设备、IP、时间） | 3 |
| E4-S2 | 逐个撤销会话 | 删除指定 session → 对应 RT 失效 | 2 |
| E4-S3 | 登出 | 撤销当前 RT → 清除客户端状态 | 2 |
| E4-S4 | 个人资料查看/修改 | GET/PATCH /me 返回/更新用户基本信息 | 2 |
| E4-S5 | 修改邮箱 | 发起变更 → 新邮箱接收验证码 → 验证后替换 → 旧邮箱收到通知 | 5 |
| E4-S6 | 修改密码 | 验证旧密码 → 设置新密码 → 撤销所有其他 session | 3 |
| E4-S7 | 账号注销 | 标记软删除 → 30 天冷静期 → 定时任务硬删除 → 发送确认邮件 | 5 |

---

## 7. 迭代计划

### Sprint 1（2 周）— 核心认证闭环

**目标**：用户可以通过邮箱密码注册、验证、登录，获得有效 JWT。

| Story | 预估 |
|---|---|
| E1-S1 邮箱密码注册 | 5pt |
| E1-S2 邮箱验证 | 3pt |
| E1-S3 邮箱密码登录 | 5pt |
| E1-S4 验证码安全机制 | 2pt |
| E3-S1 密码哈希（Argon2id） | 3pt |

**交付物**：可运行的注册 → 验证 → 登录流程，签发 JWT。

---

### Sprint 2（2 周）— Token 体系与安全防护

**目标**：完善 Token 生命周期管理，建立安全基线。

| Story | 预估 |
|---|---|
| E2-S1 JWT 签发（ES256） | 5pt |
| E2-S2 JWKS Endpoint | 3pt |
| E2-S3 Refresh Token 轮换 | 5pt |
| E2-S4 Token 家族重放检测 | 3pt |
| E3-S3 登录失败锁定 | 3pt |
| E3-S4 登录限流 | 2pt |

**交付物**：完整 Token 生命周期（签发 → 验证 → 轮换 → 撤销），JWKS 可被外部服务消费。

---

### Sprint 3（2 周）— 社交登录与密码重置

**目标**：降低注册门槛，完善密码安全。

| Story | 预估 |
|---|---|
| E1-S5 Weixin OAuth2 登录 | 5pt |
| E1-S6 ~~手机号 + 短信验证码登录~~ | ~~5pt~~ |
| E3-S2 密码重置 | 5pt |
| E1-S7 注册限流与人机验证 | 3pt |

**交付物**：多方式注册/登录，密码重置自助流程。

---

### Sprint 4（2 周）— 会话管理与资料

**目标**：用户可自主管理会话和个人信息。

| Story | 预估 |
|---|---|
| E4-S1 活跃会话列表 | 3pt |
| E4-S2 逐个撤销会话 | 2pt |
| E4-S3 登出 | 2pt |
| E4-S4 个人资料查看/修改 | 2pt |
| E4-S5 修改邮箱 | 5pt |
| E4-S6 修改密码 | 3pt |
| E3-S5 已泄露密码检查 | 2pt |

**交付物**：完整的用户自助管理功能。

---

### Sprint 5（2 周）— 账号生命周期与密钥轮换

**目标**：完善账号生命周期管理，支持密钥平滑轮换。

| Story | 预估 |
|---|---|
| E4-S7 账号注销 | 5pt |
| E2-S5 密钥轮换机制 | 3pt |

**交付物**：合规的账号注销流程，生产级密钥轮换能力。

---

### 里程碑总览

```
Sprint 1          Sprint 2          Sprint 3          Sprint 4          Sprint 5
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐
│ 核心认证  │─────▶│ Token    │─────▶│ 社交登录 │─────▶│ 会话管理 │─────▶│ 账号生命 │
│ 闭环     │      │ 体系     │      │ 密码重置 │      │ 个人资料 │      │ 密钥轮换 │
└─────────┘      └─────────┘      └─────────┘      └─────────┘      └─────────┘
   MVP Alpha         MVP Beta        MVP RC1          MVP RC2         MVP Release
```

---

## 8. 安全清单

### 8.1 认证安全

- [ ] 所有密码使用 Argon2id 哈希（参数符合 OWASP）
- [ ] JWT 使用 ES256 签名，私钥仅 Auth Server 持有
- [ ] Access Token 有效期 ≤ 15 分钟
- [ ] Refresh Token 单次使用 + 轮换
- [ ] Token 家族重放检测 → 全家撤销
- [ ] 验证码哈希存储，不存明文
- [ ] 验证码 15 分钟过期，最多 5 次尝试

### 8.2 传输与存储安全

- [ ] 全链路 HTTPS（HSTS）
- [ ] Refresh Token 通过 HttpOnly + Secure + SameSite=Lax 的 Cookie 传递
- [ ] Access Token 仅存内存（不存 localStorage，防 XSS）
- [ ] 数据库敏感字段加密（如 phone）

### 8.3 防护机制

- [ ] 登录限流（IP + 账号双维度）
- [ ] 注册限流 + 人机验证
- [ ] 连续失败锁定（指数退避）
- [ ] 已泄露密码检查
- [ ] 邮箱规范化处理（防止大小写绕过）

### 8.4 合规

- [ ] 账号注销（软删除 + 30 天冷静期 + 硬删除）
- [ ] 用户数据导出接口（预留）
- [ ] 隐私政策确认流程
- [ ] 审计日志（认证事件全量记录）

---

## 9. 延后事项（Post-MVP）

| 功能 | 目标迭代 | 说明 |
|---|---|---|
| WebAuthn / Passkeys | V2 | FIDO2 无密码认证，iOS/Android/浏览器均已支持 |
| MFA（TOTP） | V2 | Google Authenticator 兼容的二次验证 |
| MFA（SMS） | V2 | 手机号作为第二因子 |
| 账号关联（合并） | V2 | 多种登录方式关联到同一账号 |
| Apple Sign In | V2 | iOS 上架必需，OAuth2 逻辑类似 Google |
| 管理后台 | V2 | 用户搜索、封禁、 impersonate |
| 数据导出 | V2 | GDPR Art. 20 合规 |
| 高级风控 | V3 | 设备指纹、行为分析、ML 异常检测 |
| 审计日志查询 API | V2 | 供合规和安全团队查询 |
| 分片策略落地 | V2 | 按 user_id 哈希分片，准备数据 |
| 手机号 + 短信验证码登录 | V2 | 中国大陆市场 |
| 三方登录支持Google账号 | V1.5 | 美洲市场等 |

---

## 10. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|---|---|---|---|
| 短信服务商故障/延迟 | 用户无法登录 | 中 | 多供应商 fallback + 队列重试 + 降级为邮箱验证 |
| ES256 密钥泄露 | 攻击者可伪造 token | 低 | 监控 JWKS 访问异常 + 密钥轮换机制 + 旧 key 快速撤销 |
| JWT 库兼容性问题 | 部分客户端无法验证 | 低 | 使用标准库（node-jose / go-jose），避免自实现 |
| 数据库单点故障 | 服务不可用 | 中 | PostgreSQL 主从 + 自动 failover + 读写分离 |
| Redis 宕机 | 无法验证 RT | 中 | Redis Sentinel / Cluster + RT 数据双写 PG（降级读 PG） |
| 大规模凭证填充攻击 | 账号安全风险 | 中 | 限流 + 泄露密码检查 + CAPTCHA + 异常登录通知 |

---

## 附录 A：技术选型参考

| 组件 | 推荐方案 | 备选 |
|---|---|---|
| 语言/框架 | Go (chi/echo) 或 Node.js (Fastify) | Rust (Actix) |
| 数据库 | PostgreSQL 16+ | CockroachDB（原生分布式） |
| 缓存 | Redis 7+ (Sentinel) | Dragonfly (用到缓存的场景使用接口机制，支持用关系数据库替换) |
| 消息队列 | NATS / Redis Streams | Kafka（过度） |
| JWT 库 | go-jose / node-jose | — |
| 密码哈希 | golang.org/x/crypto/argon2id | bcrypt（降级） |
| 人机验证 | Cloudflare Turnstile | reCAPTCHA v3 |
| 短信 | Twilio + 本地供应商 | Alibaba SMS |
| 邮件 | AWS SES / Resend | SendGrid |

## 附录 B: 开源方案

按**使用层次**从完整平台到基础库，开源认证方案分为四类：

---

## 一、完整 IAM 平台（开箱即用，自托管）

### 1. Ory (Kratos + Hydra) — 社区认可度最高

| 维度 | 详情 |
|---|---|
| GitHub Stars | Kratos ~11k, Hydra ~15k |
| 语言 | Go |
| 协议 | Apache 2.0 |
| OIDC 认证 | ✅ Hydra 通过 OpenID Certified 认证 |

**组件分工：**
- **Ory Kratos** — 身份管理（注册、登录、邮箱验证、密码重置、MFA、账号恢复）
- **Ory Hydra** — OAuth 2.0 & OpenID Connect Provider（授权码、客户端凭证等全部 grant type）
- **Ory Oathkeeper** — 身份访问代理（API Gateway 的认证中间件）
- **Ory Keto** — 关系型权限引擎（Zanzibar 模型）

**优点：**
- Go 原生，云原生设计（Kubernetes 友好）
- Hydra 是唯一通过 OpenID Foundation 认证的 Go 实现
- 完全自托管，数据主权在自己手里
- API-first，有官方 Go SDK

**缺点：**
- 运维复杂度高（需独立运行 Kratos + Hydra + DB + 邮件服务）
- 不支持 SAML SSO
- 无内置管理后台 UI（需自建或用 Ory Cloud）
- 学习曲线陡峭

**适合：** 需要完整 OAuth2/OIDC 协议栈、重视合规认证的团队

---

### 2. Casdoor — Go 原生 IAM，带管理 UI

| 维度 | 详情 |
|---|---|
| GitHub Stars | ~10k |
| 语言 | Go (后端) + React (前端) |
| 协议 | Apache 2.0 |

**特点：**
- 内置管理后台 UI（用户、组织、应用、权限管理）
- 支持 OAuth2、OIDC、SAML SSO
- 多认证方式：密码、社交登录、LDAP、邮件验证码
- 多租户（组织 + 应用管理）
- 官方 Go SDK

**优点：** 开箱即用的管理界面，部署相对简单  
**缺点：** 社区规模小于 Ory，文档偏弱，SAML 成熟度不足

**适合：** 需要管理后台、不想从零搭建 UI 的团队

---

### 3. Zitadel — 云原生 Keycloak 替代

| 维度 | 详情 |
|---|---|
| GitHub Stars | ~9k |
| 语言 | Go |
| 协议 | Apache 2.0 |

**特点：**
- 定位为 Keycloak 的 Go 替代品
- 原生支持多租户（Instance → Organization → Project → User）
- 支持 OIDC、SAML 2.0、JWT Profile
- 内置管理控制台
- Event Sourcing 架构，完整审计追踪

**优点：** 架构现代，审计能力强，多租户设计优秀  
**缺点：** 相对较新，生态和社区资源少于 Keycloak/Ory

**适合：** 需要多租户、审计追踪、SAML 支持的场景

---

### 对比总结

| 维度 | Ory (Kratos+Hydra) | Casdoor | Zitadel |
|---|---|---|---|
| OIDC 认证 | ✅ 官方认证 | ❌ | ❌ |
| SAML SSO | ❌ | ⚠️ 基础 | ✅ |
| 管理后台 | ❌ 需自建 | ✅ 内置 | ✅ 内置 |
| 多租户 | ⚠️ 需自建 | ✅ | ✅ 原生 |
| 运维复杂度 | 高 | 中 | 中 |
| 社区成熟度 | 最高 | 中 | 中高 |
| Go 原生 | ✅ | ✅ | ✅ |

---

## 二、OAuth2/OIDC SDK 库（嵌入到自己服务中）

### 1. Ory Fosite — 最权威的 Go OAuth2 SDK

| 维度 | 详情 |
|---|---|
| GitHub Stars | ~8k |
| 语言 | Go |
| 协议 | Apache 2.0 |

**定位：** 不是独立服务，而是一个 **可扩展的 OAuth 2.0 + OIDC SDK**，让你在自己的 Go 服务中实现 OAuth2 Provider。

**支持的 Grant Types：**
- Authorization Code（含 PKCE）
- Implicit
- Client Credentials
- Refresh Token
- JWT Assertion（RFC 7523）
- Resource Owner Password Credentials

**优点：**
- Ory Hydra 的底层引擎，经过大规模生产验证
- 高度可扩展（自定义存储、JWT 签发逻辑）
- 安全优先设计（PKCE 强制、token 绑定）

**缺点：**
- 是 SDK 不是服务，需要自己写 HTTP 层和存储实现
- 学习曲线较陡

**适合：** 需要在自己的 Go 服务中内嵌 OAuth2 Provider 能力，不想部署独立 Hydra 服务

### 2. go-oauth2/oauth2 — 轻量 OAuth2 Server 框架

| 维度 | 详情 |
|---|---|
| GitHub Stars | ~4k |
| 语言 | Go |
| 协议 | MIT |

**特点：** 更轻量的 OAuth2 Server 框架，支持多种存储后端（Redis、MongoDB、PostgreSQL 等），配置灵活。

**适合：** 快速搭建一个 OAuth2 Server，不需要完整 OIDC 合规性

---

## 三、JWT / JWKS 基础库

### 1. go-jose/go-jose — JOSE 标准实现（推荐）

| 维度 | 详情 |
|---|---|
| GitHub Stars | ~2k |
| 维护者 | go-jose 社区（原 Square 维护） |
| 协议 | Apache 2.0 |

**支持：** JWS（签名）、JWE（加密）、JWK、JWKS  
**算法：** RS256/384/512、PS256/384/512、ES256/384/512、EdDSA、HS256/384/512  
**推荐理由：** ES256 签发 + JWKS 公钥分发的首选库，安全审计通过，被 Ory、Smallstep 等项目使用

### 2. golang-jwt/jwt — 最流行的 JWT 库

| 维度 | 详情 |
|---|---|
| GitHub Stars | ~7k |
| 协议 | MIT |

**特点：** 简单易用，社区最大。支持 ES256 等 ECDSA 算法。  
**局限：** 不支持 JWKS 原生管理，JWE 不支持

### 3. kataras/jwt — 高性能 JWT + JWKS

| 维度 | 详情 |
|---|---|
| 特点 | 内置 JWKS 自动轮换、Key RSA/ECDSA 切换，API 简洁 |

---

## 四、授权库

### Casbin — 策略引擎

| 维度 | 详情 |
|---|---|
| GitHub Stars | ~18k |
| 语言 | Go |
| 协议 | Apache 2.0 |

**支持模型：** ACL、RBAC、ABAC、RESTful 等  
**特点：** 纯授权引擎（不管认证），支持多种 Adapter（PostgreSQL、Redis、S3 等），与认证解耦

---

## 五、方案选型建议

根据你的账号系统规模和团队情况，有两条路线：

### 路线 A：自建服务（更灵活、更可控）

```
推荐组合：
├── 认证层：自行实现（注册/登录/验证码/密码重置）
├── Token 层：go-jose（ES256 签发 + JWKS）
├── OAuth2（如需）：Fosite（嵌入自有服务）
├── 授权层：Casbin（RBAC/ABAC）
├── 密码哈希：golang.org/x/crypto/argon2id
└── 存储：PostgreSQL + Redis
```

**适合：** 需要完全掌控认证流程、自定义逻辑多、不想引入重型外部服务

### 路线 B：采用 IAM 平台（更快上线）

```
推荐组合：
├── 身份管理：Ory Kratos（注册/登录/MFA/账号恢复）
├── OAuth2/OIDC：Ory Hydra（如果需要对外提供 OAuth2）
├── 授权层：Ory Keto 或 Casbin
└── 存储：Ory 自带 PostgreSQL/CockroachDB 支持
```

**适合：** 需要标准 OAuth2/OIDC 协议合规、快速上线、团队 DevOps 能力强

---

### 针对 MVP 建议

假设已经明确了数据模型和 API 设计，且 MVP 阶段的核心需求是注册/登录/Token 体系/密码重置。**建议走路线 A**，原因：

1. **MVP 不需要完整 OAuth2 Provider** — 只需要签发和验证自己的 JWT，不需要对外提供 OAuth2 授权码流程
2. **自定义逻辑多** — 手机号验证码、邮箱验证、Argon2id、ES256 + JWKS 等都有明确设计，自建更灵活
3. **渐进式引入** — 未来如果需要 OAuth2 Provider 能力，再用 Fosite 嵌入即可，不冲突
4. **核心库已经很成熟** — `go-jose`（ES256 + JWKS）+ `golang.org/x/crypto`（Argon2id）+ `golang-jwt/jwt`（验证）这些基础库足够覆盖 MVP


## 附录 C：参考标准

- [RFC 7519](https://tools.ietf.org/html/rfc7519) — JSON Web Token
- [RFC 7517](https://tools.ietf.org/html/rfc7517) — JSON Web Key
- [RFC 7518](https://tools.ietf.org/html/rfc7518) — JSON Web Algorithms
- [RFC 6749](https://tools.ietf.org/html/rfc6749) — OAuth 2.0
- [RFC 7636](https://tools.ietf.org/html/rfc7636) — PKCE
- [OWASP ASVS v4.0](https://owasp.org/www-project-application-security-verification-standard/) — 应用安全验证标准
- [OWASP Auth Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
