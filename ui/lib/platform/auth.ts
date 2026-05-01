/**
 * Platform Auth Token Manager
 * Handles JWT token storage, retrieval, and user info for the platform pages.
 * Independent from the enterprise tokenManager — this is for the multi-user platform.
 */

const TOKEN_KEY = "platform_token";
const USER_KEY = "platform_user";

export interface PlatformUser {
	id: number;
	email: string;
	username: string;
	nickname: string;
	balance: number;
	is_admin: boolean;
	role: string;
	customer_id?: string;
	team_id?: string;
	status: string;
	email_verified: boolean;
	created_at: string;
	updated_at: string;
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
	localStorage.removeItem(USER_KEY);
}

export function getUser(): PlatformUser | null {
	if (typeof window === "undefined") return null;
	const raw = localStorage.getItem(USER_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PlatformUser;
	} catch {
		return null;
	}
}

export function setUser(user: PlatformUser): void {
	if (typeof window === "undefined") return;
	localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function isAuthenticated(): boolean {
	return !!getToken();
}