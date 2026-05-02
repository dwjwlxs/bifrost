/**
 * Platform Auth Token Manager
 * Handles JWT token storage, retrieval, and user info for the platform pages.
 * Independent from the enterprise tokenManager — this is for the multi-user platform.
 */
import type { PlatformOrg, PlatformTeam, PlatformUserInfo } from "./types";

export type { PlatformOrg, PlatformTeam, PlatformUserInfo };

const TOKEN_KEY="***";
const USER_KEY = "platform_user";

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

	// Check JWT expiration — reject expired tokens at the routing level
	// so users are redirected to login immediately instead of getting a 401 later.
	const payload = decodePlatformToken(token);
	if (payload?.exp && payload.exp * 1000 < Date.now()) {
		// No setLoggedOut() needed here — this runs at route guard level before
		// any console page loads, so there are no in-flight API requests to guard against.
		clearLoggedInfo();
		return false;
	}

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

// Store token + decoded user info from a JWT access token.
// Convenience helper: setToken() → decodeAndStoreUser().
export function setLoggedInfo(token: string): void {
	if (typeof window === "undefined") return;
	localStorage.setItem(TOKEN_KEY, token);

	decodeAndStoreUser(token);
}

// Clear token and user info from localStorage.
export function clearLoggedInfo(): void {
	clearToken();
	clearUser();
}