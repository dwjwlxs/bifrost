/**
 * Platform module — barrel exports.
 *
 * All shared types are defined in ./types.ts — the single source of truth.
 * Consumers should import directly from the specific module when possible:
 *   import { usePlatformLoginMutation } from "@/lib/platform/platformApi";
 *   import { getUser, isAuthenticated } from "@/lib/platform/auth";
 *   import type { PlatformUserInfo, PlatformOrg } from "@/lib/platform/types";
 */

// Auth utilities
export {
	getToken,
	setToken,
	clearToken,
	setLoggedInfo as storeAuthFromToken,
	clearLoggedInfo as clearUserInfo,
	getUser,
	isAuthenticated,
	isTokenValid,
	markLoggedOut,
	isUserLoggedOut,
	clearLoggedOut,
	refreshSessionIfNeeded,
	isTokenExpiringSoon,
	isTokenExpired,
	getTokenExpiresIn,
	onAuthEvent,
} from "./auth";

// Auth state component
export { AuthGate, DefaultAuthSkeleton } from "@/components/authGate";

// Shared types (single source of truth)
export type { PlatformUserInfo, PlatformOrg, PlatformTeam } from "./types";

// API slice + full API response types + hooks
export * from "./platformApi";

// Role hooks
export * from "./hooks";