    好了，所有关键文件都读完了。以下是针对骨架 + 认证链路的 Review。



    Platform 前端骨架 + 认证链路 Review

    一、整体骨架评价


    ui/lib/platform/
    ├── auth.ts              # Token/User CRUD (localStorage)
    ├── platformBaseApi.ts   # RTK Query baseQuery + 401 refresh + 全局router/store注入
    ├── platformApi.ts       # 所有endpoint定义 (863行)
    ├── hooks.ts             # useLogout + 角色hooks
    ├── config.ts            # 导航配置
    └── index.ts             # barrel export

    ui/app/platform/
    ├── layout.tsx           # beforeLoad路由守卫 (isAuthenticated检查)
    ├── login/page.tsx       # 登录页
    ├── register/page.tsx    # 注册页
    ├── console/layout.tsx   # console子路由守卫 (getToken检查)
    ├── components/
    │   ├── platformLayout.tsx        # Header + Providers
    │   ├── consoleSidebar.tsx        # 侧边栏
    │   ├── consoleSidebarContext.tsx  # 侧边栏折叠Context
    │   └── EmailVerificationDialog.tsx # 邮箱验证弹窗


    骨架分层清晰：lib层负责数据/状态，app层负责路由/UI。没有大问题。



    二、逐项审查

    1. 注册流程

    路径: register/page.tsx → platformRegister → EmailVerificationDialog → verifyEmail → onVerified(token)

    问题:

    (a) 登录状态检查有竞态风险 — L26-29:
    typescript
    useEffect(() => {
        if (getToken()) {
            navigate({ to: "/platform/console/dashboard" });
        }
    }, [navigate]);

    getToken() 是同步读localStorage，但如果用户在另一个tab登录了，当前tab不会感知。这不是严重bug，但建议用 TanStack Router 的 beforeLoad 统一处理（和 platform/layout.tsx 已有的
逻辑重复）。

    (b) 注册后的token处理不一致 — L47-51: 注册成功后只弹toast+打开验证弹窗，不调用 clearLoggedOut() 或 setUserInfo()。但如果后端在注册时直接返回了token（注册即登录场景），当前
代码不会处理。目前因为注册必验证，所以没触发，但如果后端逻辑变了就会出bug。

    (c) 邮箱验证后的refresh_token被丢弃 — EmailVerificationDialog.tsx L135-136:
    typescript
    const { access_token, refresh_token } = res.data;
    onVerified(access_token, refresh_token);

    而 login/page.tsx L114-118 的 onVerified 回调:
    typescript
    onVerified={(token: string, _refreshToken: string) => {
        clearLoggedOut();
        setUserInfo(token);

    refresh_token 参数被 _ 前缀标注为忽略。注释说"Refresh token is set via httpOnly cookie by the backend"。这意味着前端假设后端在验证邮箱时也会通过Set-Cookie设置httpOnly refresh token。如果后端没做这个，refresh token就丢失了，用户在access token过期后会立即被踢回登录页。建议确认后端行为。



    2. 登录流程

    路径: login/page.tsx → platformLogin → clearLoggedOut() → setUserInfo(access_token) → navigate

    整体流程正确。clearLoggedOut() 在 setUserInfo() 之前调用，确保后续401能触发refresh。

    问题:

    (a) fetchBaseQuery 重复创建 — platformBaseApi.ts L92-103 和 L128-139 完全相同的 fetchBaseQuery({ ... }) 配置写了两遍。违反DRY。应提取为工厂函数：

    typescript
    const makeBaseQuery = () => fetchBaseQuery({
        baseUrl: getApiBaseUrl(),
        credentials: "include",
        prepareHeaders: (headers) => { / ... / },
    });


    (b) redirect参数缺少类型安全 — login/page.tsx L15-16:
    typescript
    const searchParams = useSearch({ from: "/platform/login" });
    const redirect = (searchParams as { redirect?: string }).redirect;

    as 类型断言绕过了TanStack Router的validateSearch。应在路由定义中声明search params的schema。



    3. 登出流程

    路径: hooks.ts → useLogout() → setLoggedOut() → clearUserInfo() → navigate → resetApiState

    问题:

    (a) 双重登出路径不一致 — 存在两条登出路径：
    - 主动登出（hooks.ts useLogout）: setLoggedOut() → clearUserInfo() → navigate → store.dispatch(platformApi.util.resetApiState())
    - 被动登出（platformBaseApi.ts 401+refresh失败）: setLoggedOut() → clearUserInfo() → platformRouter?.navigate() → platformStore?.dispatch({ type: "platformApi/resetApiState" })

    两条路径做了同样的事，但实现不同：一个用 platformApi.util.resetApiState()，另一个用 action type string "platformApi/resetApiState"。后者是为了避免循环依赖的workaround，但这
种隐式知识很容易被遗忘。建议在 platformBaseApi.ts 加醒目注释说明为什么用string而非API引用。

    (b) useLogout 中 navigate 在 resetApiState 之前 — hooks.ts L28-30:
    typescript
    navigate({ to: redirectTo }); // 先跳转
    store.dispatch(platformApi.util.resetApiState()); // 后清理

    注释说"先跳转 → console组件卸载，订阅取消 → resetApiState不会触发新请求"。这个顺序是对的，但如果navigate是异步的（TanStack Router的navigate返回promise），理论上存在微小窗口
期。当前实际使用中没有出问题，算轻微风险。

    (c) hooks.ts 直接 import store — L8:
    typescript
    import { store } from "@/lib/store";

    而 platformBaseApi.ts 为了避免循环依赖用了延迟注入 platformStore。同一个代码库中两套不同的store获取方式，违反一致性原则。hooks.ts 虽然不会触发循环依赖（因为hooks.ts不参与store初始化链），但维护者可能不理解为什么一个地方能直接import，另一个地方不行。



    4. 认证 & Token管理

    路径: auth.ts → localStorage (token + user) / httpOnly cookie (refresh token)

    问题:

    (a) PlatformUserInfo 在两处重复定义 — auth.ts 定义了 PlatformUserInfo 接口，EmailVerificationDialog.tsx L7 从 platformApi.ts import PlatformUserInfo：
    typescript
    import type { PlatformUserInfo } from "@/lib/platform/platformApi";

    而 users/page.tsx L13 从 auth.ts import：
    typescript
    import { type PlatformUserInfo } from "@/lib/lib/platform/auth";

    platformApi.ts 是 re-export（export type { PlatformUserInfo } from "./auth"），所以类型一致。但import来源不统一，容易让新人困惑类型是否相同。

    (b) setUserInfo 做了两件事 — auth.ts L196-201:
    typescript
    export function setUserInfo(token: string): void {
        localStorage.setItem(TOKEN_KEY, token);
        decodeAndStoreUser(token);
    }

    同时设置token AND 解码JWT存user。函数名 setUserInfo 暗示只设置用户信息，但实际也设置了token。与 setToken()（只设token）和 setUser()（只设user）职责重叠。建议改名或拆分。

    (c) JWT解码无过期检查 — auth.ts 的 decodePlatformToken() 和 userFromJWT() 都不检查 exp。一个已过期的JWT仍会被解码、存储为有效user。虽然后续API请求会因为401触发refresh，但在
 platform/layout.tsx 的 beforeLoad 中 isAuthenticated() 只检查token存在性（!!getToken()），不检查过期。这意味着过期的token也能通过路由守卫进入console页面，然后看到一堆401错误后
才被刷新/踢出。用户体验不好。

    (d) refresh token 请求发送空字符串 — platformBaseApi.ts L60:
    typescript
    body: JSON.stringify({ refresh_token: "" }),

    注释说refresh token通过httpOnly cookie发送。但body中发空字符串看起来很奇怪。如果后端不读body只读cookie，那这个body是多余的。如果后端在某些场景会读body，空字符串可能导致问题
。



    5. Session保持

    当前机制:
    - Access token: localStorage, 过期后401 → 自动refresh
    - Refresh token: httpOnly cookie, 自动随请求发送
    - 并发401: refreshPromise 单例锁，防止多个请求同时refresh
    - 主动登出: isLoggedOut flag阻止过期请求的refresh尝试

    问题:

    (a) 没有token过期前的主动刷新 — 当前是被动式（401后才refresh）。如果用户长时间停留在页面不操作，token过期后下一次操作会先失败一次再refresh。建议加入定时器，在token快过期前
（如5分钟）主动refresh。

    (b) refreshPromise 竞态的边界case — L116-124:
    typescript
    if (!refreshPromise) {
        refreshPromise = tryRefreshToken().then((ok) => {
            refreshed = ok;
            refreshPromise = null;
            return ok;
        });
    } else {
        refreshed = await refreshPromise;
    }

    refreshed 变量在 then callback里赋值，但外层的 if (refreshed) 判断是同步读取。这个逻辑其实是正确的（refreshed 在 if 判断前已被await赋值），但 let refreshed = false 的初始化
看起来是多余的（因为两个分支都会赋值），代码可读性不够好。可以用 const refreshed = await (refreshPromise ?? (refreshPromise = tryRefreshToken(...))) 简化。

    (c) 刷新成功后不更新路由守卫状态 — 当token刷新成功后，isAuthenticated() 会返回true（因为token在localStorage中），但如果用户刚好在登录页（比如在登录页时token过期触发了401 refresh），刷新成功后不会自动跳回console。目前不是大问题，因为登录页的 useEffect(() => { if (getToken()) navigate(...) }) 会处理。



    6. 架构层面

    (a) platformApi.ts 863行单文件 — 所有endpoint在一个文件中。随着功能增长会越来越难维护。建议按领域拆分：

    platformApi/
    ├── index.ts          # createApi + export
    ├── auth.ts           # login/register/verify
    ├── users.ts          # admin users CRUD
    ├── orgs.ts           # organizations/teams
    ├── billing.ts        # packages/balance/usage
    └── providers.ts      # provider keys

    RTK Query 的 injectEndpoints 天然支持这种拆分。

    (b) 路由守卫重复 — platform/layout.tsx 用 isAuthenticated() 检查，console/layout.tsx 用 getToken() 检查，两者做同一件事但用不同API。应统一使用 isAuthenticated() 或统一在顶
层 beforeLoad 处理。

    (c) 全局变量注入模式有脆弱性 — platformRouter/platformStore 是模块级 let 变量，通过 setPlatformRouter()/setPlatformStore() 注入。如果 main.tsx 注入顺序有问题或者忘记调用，
401后的跳转会静默失败（platformRouter?.navigate() 可选链）。建议至少加个开发模式的console.warn，在需要跳转时发现router未注入。



    三、优先级排序

    | 优先级 | 问题 | 影响 |
    |--------|------|------|
    | P0 | refresh_token验证时被丢弃，需确认后端Set-Cookie行为 | 用户验证后可能无法refresh |
    | P0 | JWT过期无主动检查，路由守卫放行过期token | 用户体验差，先看到错误再被踢 |
    | P1 | fetchBaseQuery重复创建 | DRY违反，改一处忘另一处 |
    | P1 | platformApi.ts 863行单文件 | 可维护性差 |
    | P1 | 路由守卫重复(isAuthenticated vs getToken) | 一致性差 |
    | P2 | 全局router/store注入缺少开发模式告警 | 静默失败难排查 |
    | P2 | setUserInfo命名误导 | 新人理解成本 |
    | P2 | PlatformUserInfo import来源不统一 | 认知负担 |
    | P3 | refresh请求body发空字符串 | 代码怪味 |
    | P3 | 登出双路径不一致 | 维护成本 |

