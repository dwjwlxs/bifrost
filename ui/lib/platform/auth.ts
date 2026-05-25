/**
 * Platform Auth Token Manager
 * Handles JWT token storage, retrieval, and user info for the platform pages.
 * Independent from the enterprise tokenManager — this is for the multi-user platform.
 */
import type { PlatformOrg, PlatformTeam, PlatformUserInfo } from "./types";

export type { PlatformOrg, PlatformTeam, PlatformUserInfo };

const TOKEN_KEY = "***";
const USER_KEY = "platform_user";

// ─── Auth State Events (for multi-tab sync + reactive updates) ──────────
// Use Map to support multiple listeners per event type
type AuthEventType = "logout" | "login" | "user_update";
type AuthEventListener = (data?: unknown) => void;
const authListeners = new Map<AuthEventType, Set<AuthEventListener>>();

function emitAuthEvent(type: AuthEventType, data?: unknown): void {
  authListeners.get(type)?.forEach((listener) => listener(data));
}

export function onAuthEvent(type: AuthEventType, listener: AuthEventListener): () => void {
  if (!authListeners.has(type)) {
    authListeners.set(type, new Set());
  }
  authListeners.get(type)!.add(listener);
  return () => authListeners.get(type)?.delete(listener);
}

// ─── Multi-Tab Sync ────────────────────────────────────────────────────
// Listen for storage events from other tabs.
// Guarded against HMR double-registration by checking a module-level flag.
let storageListenerRegistered = false;
if (typeof window !== "undefined" && !storageListenerRegistered) {
	storageListenerRegistered = true;
	window.addEventListener("storage", (e: StorageEvent) => {
		if (e.key === TOKEN_KEY && e.newValue === null) {
			// Another tab cleared the token → broadcast logout
			clearUser();
			emitAuthEvent("logout");
		} else if (e.key === TOKEN_KEY && e.newValue !== null) {
			// Another tab set a new token → re-decode user and broadcast login
			decodeAndStoreUser(e.newValue);
			emitAuthEvent("login");
		} else if (e.key === USER_KEY && e.newValue === null) {
			clearUser();
			emitAuthEvent("logout");
		} else if (e.key === USER_KEY && e.newValue !== null) {
			// Another tab set new user data → broadcast user_update.
			// "login" is already emitted by the TOKEN_KEY handler (which always
			// runs first), so skip it here to avoid duplicate events.
			emitAuthEvent("user_update");
		}
	});
}

// ─── Logout guard ──────────────────────────────────────────────────────
// Module-level flag set on explicit logout. Prevents in-flight or
// post-unmount 401s from triggering a token refresh after the user has
// already chosen to sign out. Cleared on successful login / refresh.
let isLoggedOut = false;

/** Mark the session as explicitly logged out (skips refresh on 401). */
export function markLoggedOut(): void {
	isLoggedOut = true;
}

/** Returns true if the user has explicitly logged out and refresh should be skipped. */
export function isUserLoggedOut(): boolean {
	return isLoggedOut;
}

export function clearLoggedOut(): void {
	isLoggedOut = false;
}

/** JWT payload from platform login endpoint (non-verifying decode for UI use). */
interface PlatformJWTPayload {
	sub: string; // user ID as string
	is_admin: boolean;
	orgs?: Array<{ id: string; role: string }>;
	teams?: Array<{ id: string; role: string }>;
	auth_token?: string;
	email?: string;
	user_name?: string;
	display_name?: string;
	exp?: number;
	iat?: number;
	jti?: string;
}

/**
 * Decode a platform JWT payload WITHOUT signature verification.
 * Safe for client-side UI use — the backend has already verified the signature.
 * Returns null if the token is malformed.
 */
export function decodePlatformToken(token: string): PlatformJWTPayload | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		// JWT uses base64url encoding: replace - with +, _ with /, and pad if needed
		let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
		const decoded = atob(padded);
		return JSON.parse(decoded) as PlatformJWTPayload;
	} catch {
		return null;
	}
}

/**
 * Build a minimal PlatformUserInfo from a decoded JWT payload.
 * Used immediately after login — full profile (balance, etc.) comes from the
 * profile API when the user visits the console dashboard.
 */
export function userFromJWT(payload: PlatformJWTPayload): PlatformUserInfo {
	const now = new Date().toISOString();

	// Build orgs array
	const orgs: PlatformOrg[] = (payload.orgs ?? []).map((o) => ({
		id: o.id,
		role: (o.role as "admin" | "member") ?? "member",
	}));

	// Build teams array
	const teams: PlatformTeam[] = (payload.teams ?? []).map((t) => ({
		id: t.id,
		role: (t.role as "admin" | "member") ?? "member",
	}));

	// Derive display role: admin > org_admin > team_admin > team_member > user
	let role = "user";
	if (payload.is_admin) {
		role = "admin";
	} else if (orgs.some((o) => o.role === "admin")) {
		role = "customer_owner";
	} else if (teams.some((t) => t.role === "admin")) {
		role = "team_admin";
	} else if (orgs.length > 0 || teams.length > 0) {
		role = "team_member";
	}

	return {
		id: payload.sub,
		email: payload.email || "",
		username: payload.user_name || payload.email?.split("@")[0] || "user",
		nickname: payload.display_name || "",
		balance: 0,
		is_admin: payload.is_admin ?? false,
		role,
		orgs,
		teams,
		// Legacy fields: primary org/team for backward compat
		customer_id: orgs[0]?.id,
		team_id: teams[0]?.id,
		status: "active",
		is_email_verified: true,
		created_at: now,
		updated_at: now,
	};
}

export function getToken(): string | null {
	if (typeof window === "undefined") return null;
	return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
	if (typeof window === "undefined") return;
	localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
	if (typeof window === "undefined") return;
	localStorage.removeItem(TOKEN_KEY);
}

/**
 * Decode a platform JWT and store user in localStorage.
 * Convenience helper: decodeJWT() → userFromJWT() → setUser().
 * Safe for client-side UI use — backend has already verified the signature.
 */
export function decodeAndStoreUser(token: string): void {
	const payload = decodePlatformToken(token);
	if (payload) {
		setUser(userFromJWT(payload));
	}
}

export function getUser(): PlatformUserInfo | null {
	if (typeof window === "undefined") return null;
	const raw = localStorage.getItem(USER_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PlatformUserInfo;
	} catch {
		return null;
	}
}

export function setUser(user: PlatformUserInfo): void {
	if (typeof window === "undefined") return;
	localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearUser(): void {
	if (typeof window === "undefined") return;
	localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
	const token = getToken();
	if (!token) return false;

	// When the JWT is expired, do NOT clear localStorage or return false here.
	// The user may still have a valid refresh token (httpOnly cookie), and the
	// API layer (platformBaseQuery) handles 401 → refresh-token flow automatically.
	// Returning false at this point would skip refresh entirely and redirect to
	// login immediately — a poor UX when the session is still recoverable.
	// If refresh also fails, the baseQuery will clear auth state and redirect.
	//
	// We still return true so the route guard lets the page load; the first API
	// call will trigger 401 → refresh → retry (or redirect on refresh failure).
	return true;
}

/**
 * Clear a cookie by name.
 * Uses `Max-Age=0` (immune to client clock skew, unlike a fixed past `expires`),
 * and accepts optional `path`/`domain` so cookies set with non-default scopes
 * can also be cleared.
 */
export function clearCookie(name: string, options: { path?: string; domain?: string } = {}): void {
	if (typeof window === "undefined") return;
	const { path = "/", domain } = options;
	const parts = [`${encodeURIComponent(name)}=`, "Max-Age=0", `Path=${path}`];
	if (domain) parts.push(`Domain=${domain}`);
	document.cookie = parts.join("; ");
}

// ─── Token Expiry Helpers ─────────────────────────────────────────────

/** Buffer in seconds before actual expiry to trigger proactive refresh */
const REFRESH_BUFFER_SECONDS = 5 * 60; // 5 minutes

/** Returns seconds until token expires, or null if no token / malformed */
export function getTokenExpiresIn(): number | null {
	const token = getToken();
	if (!token) return null;
	const payload = decodePlatformToken(token);
	if (!payload?.exp) return null;
	return payload.exp - Math.floor(Date.now() / 1000);
}

/** Returns true if token is expired or will expire within the buffer */
export function isTokenExpiringSoon(): boolean {
	const expiresIn = getTokenExpiresIn();
	if (expiresIn === null) return false;
	return expiresIn <= REFRESH_BUFFER_SECONDS;
}

/** Returns true if token is already expired */
export function isTokenExpired(): boolean {
	const expiresIn = getTokenExpiresIn();
	if (expiresIn === null) return false;
	return expiresIn <= 0;
}

/**
 * Returns true if the token exists AND is not expired.
 * Use this for route guard decisions where you want to reject
 * both unauthenticated AND expired-session users before page load.
 */
export function isTokenValid(): boolean {
	const token = getToken();
	if (!token) return false;
	// Expired? Reject immediately — don't let the page mount only to be kicked by 401.
	return !isTokenExpired();
}

// ─── Proactive Session Refresh ────────────────────────────────────────

// Shared promise ref for proactive refresh (different from baseQuery's refreshPromise)
let proactiveRefreshPromise: Promise<boolean> | null = null;

/**
 * Proactively refresh the session if the token is expiring soon.
 * Call this on app init and on visibility change.
 * Idempotent — concurrent calls share the same promise.
 */
export async function refreshSessionIfNeeded(): Promise<boolean> {
	// If no token at all, nothing to refresh
	if (!getToken()) return false;

	if (!isTokenExpiringSoon() && !isTokenExpired()) return true;

	// If already refreshing, wait for it
	if (proactiveRefreshPromise) {
		return proactiveRefreshPromise;
	}

	const { getApiBaseUrl } = await import("@/lib/utils/port");
	const baseUrl = getApiBaseUrl();

	proactiveRefreshPromise = fetch(`${baseUrl}/platform/refresh-token`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify({ refresh_token: "" }),
	})
		.then(async (resp) => {
			if (!resp.ok) {
				clearLoggedInfo();
				return false;
			}
			const json = await resp.json();
			if (json.code !== "0" || !json.data?.access_token) {
				clearLoggedInfo();
				return false;
			}
			setLoggedInfo(json.data.access_token);
			return true;
		})
		.catch(() => {
			// Network/parse error — token may still be valid, don't clear
			return false;
		})
		.finally(() => {
			proactiveRefreshPromise = null;
		});

	return proactiveRefreshPromise;
}

// Store token + decoded user info from a JWT access token.
// Convenience helper: setToken() → decodeAndStoreUser().
// Also clears the isLoggedOut flag — used after login or successful refresh.
// Emits "login" event for reactive UI updates and multi-tab sync.
export function setLoggedInfo(token: string): void {
	if (typeof window === "undefined") return;
	isLoggedOut = false;
	localStorage.setItem(TOKEN_KEY, token);

	decodeAndStoreUser(token);
	emitAuthEvent("login");
}

// Clear token and user info from localStorage.
// NOTE: does NOT reset the isLoggedOut flag — that stays true until the
// next successful login (setLoggedInfo). This prevents in-flight query
// re-subscriptions from firing between clearLoggedInfo and navigate().
// Emits "logout" event for reactive UI updates and multi-tab sync.
export function clearLoggedInfo(): void {
	clearToken();
	clearUser();
	emitAuthEvent("logout");
}