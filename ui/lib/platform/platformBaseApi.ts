/**
 * Platform Base API — independent RTK Query instance for the multi-user platform.
 * Own reducerPath, baseQuery, and tagTypes to avoid circular deps with workspace.
 */
import { getApiBaseUrl } from "@/lib/utils/port";
import { createApi, fetchBaseQuery, BaseQueryFn } from "@reduxjs/toolkit/query/react";
import { getToken, setUserInfo, clearUserInfo } from "./auth";
import type { FetchArgs, FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { Router } from "@tanstack/react-router";

// ─── Global router & store refs ────────────────────────────────────────
// Injected from main.tsx after creation. Allows baseQuery (a plain
// async fn running outside React component context) to navigate
// and dispatch actions on 401 + refresh-failure.
// We cannot import store directly — that creates a circular dep:
// store → platformApi (via reducer) → platformBaseApi → store.
let platformRouter: Router | null = null;
let platformStore: { dispatch: (action: { type: string }) => void } | null = null;

export function setPlatformRouter(router: Router) {
	platformRouter = router;
}

export function setPlatformStore(s: { dispatch: (action: { type: string }) => void }) {
	platformStore = s;
}

// Shared promise ref to prevent concurrent refresh races —
// if multiple requests get 401 simultaneously, only one triggers refresh
let refreshPromise: Promise<boolean> | null = null;

// Module-level flag — set during logout to block any in-flight refresh attempts.
// resetApiState() does NOT abort running fetch() calls, so 401 responses from
// console-page queries (virtual-keys, orgs, etc.) can arrive after logout.
// Without this guard, tryRefreshToken() would succeed (httpOnly cookie still valid)
// and setUserInfo() would repopulate localStorage, silently "un-logging-out" the user.
let isLoggedOut = false;

export function setLoggedOut() {
	isLoggedOut = true;
}

export function clearLoggedOut() {
	isLoggedOut = false;
}

/**
 * Attempt to refresh the access token using the httpOnly refresh token cookie.
 * The browser automatically sends the cookie with the request.
 * Returns true if refresh succeeded (new token stored), false otherwise.
 */
async function tryRefreshToken(): Promise<boolean> {
	try {
		const baseUrl = getApiBaseUrl();
		// credentials: "include" ensures the httpOnly cookie is sent automatically
		const resp = await fetch(`${baseUrl}/platform/refresh-token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ refresh_token: "" }),
		});

		if (!resp.ok) {
			// Refresh token invalid or expired — clear auth state
			clearUserInfo();
			return false;
		}

		const json = await resp.json();
		if (json.code !== "0" || !json.data?.access_token) {
			// Malformed response — treat as auth failure
			clearUserInfo();
			return false;
		}

		// Store new access token + user info (refresh token set via httpOnly cookie by backend)
		setUserInfo(json.data.access_token);
		return true;
	} catch {
		return false;
	}
}

/**
 * Custom baseQuery that:
 * 1. Uses the stored access token in every request
 * 2. On 401, attempts a token refresh then retries once
 * 3. On refresh failure (e.g. refresh token expired), clears auth state
 */
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extraOptions) => {
	// Build the underlying fetchBaseQuery once; it reads getToken() from localStorage
	let result = await fetchBaseQuery({
		baseUrl: getApiBaseUrl(),
		credentials: "include",
		prepareHeaders: (headers) => {
			headers.set("Content-Type", "application/json");
			const token = getToken();
			if (token) {
				headers.set("Authorization", `Bearer ${token}`);
			}
			return headers;
		},
	})(args, api, extraOptions);

	// 401 → try to refresh once
	if (result.error?.status === 401) {
		// If the user has already logged out, skip refresh entirely.
		// The httpOnly cookie is still valid, but clearUserInfo() has already run —
		// letting tryRefreshToken() succeed would repopulate localStorage and undo the logout.
		if (isLoggedOut) {
			return result;
		}

		// If a refresh is already in flight, wait for it instead of starting another
		let refreshed = false;
		if (!refreshPromise) {
			refreshPromise = tryRefreshToken().then((ok) => {
				refreshed = ok;
				refreshPromise = null;
				return ok;
			});
		} else {
			refreshed = await refreshPromise;
		}

		if (refreshed) {
			// Retry the original request with the new token
			result = await fetchBaseQuery({
				baseUrl: getApiBaseUrl(),
				credentials: "include",
				prepareHeaders: (headers) => {
					headers.set("Content-Type", "application/json");
					const token = getToken();
					if (token) {
						headers.set("Authorization", `Bearer ${token}`);
					}
					return headers;
				},
			})(args, api, extraOptions);
		} else {
			// Refresh also failed — force logout + redirect to login page.
			// We must call router.navigate() imperatively because baseQuery
			// runs outside React component context — useNavigate() is invalid here.
			// NOTE: We cannot import platformApi here (circular dep), so we
			// dispatch the RTK Query internal resetApiState action directly.
			setLoggedOut();
			clearUserInfo();
			platformRouter?.navigate({ to: "/platform/login", replace: true });
			platformStore?.dispatch({ type: "platformApi/resetApiState" });
		}
	}

	return result;
};

export const platformBaseApi = createApi({
	reducerPath: "platformApi",
	baseQuery: baseQuery,
	tagTypes: [
		"CurrentUser",
		"VirtualKeys",
		"Orgs",
		"Teams",
		"Users",
		"Roles",
		"Packages",
		"Balance",
		"ModelPrices",
		"UsageStats",
		"ProviderKeys",
		"Budgets",
	],
	endpoints: () => ({}),
});