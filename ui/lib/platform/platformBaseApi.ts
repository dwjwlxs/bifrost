/**
 * Platform Base API — independent RTK Query instance for the multi-user platform.
 * Own reducerPath, baseQuery, and tagTypes to avoid circular deps with workspace.
 */
import { getApiBaseUrl } from "@/lib/utils/port";
import { createApi, fetchBaseQuery, BaseQueryFn } from "@reduxjs/toolkit/query/react";
import { getToken, setLoggedInfo, clearLoggedInfo, isUserLoggedOut } from "./auth";
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
	if (platformRouter) {
		console.warn("[platformBaseApi] setPlatformRouter called more than once — overwriting previous reference");
	}
	platformRouter = router;
}

export function setPlatformStore(s: { dispatch: (action: { type: string }) => void }) {
	if (platformStore) {
		console.warn("[platformBaseApi] setPlatformStore called more than once — overwriting previous reference");
	}
	platformStore = s;
}

// Shared fetchBaseQuery instance — same config used for initial request and retry after refresh.
const rawBaseQuery = fetchBaseQuery({
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
});

// Shared promise ref to prevent concurrent refresh races —
// if multiple requests get 401 simultaneously, only one triggers refresh
let refreshPromise: Promise<boolean> | null = null;


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
			body: JSON.stringify({ refresh_token: "" }), // backend checks body as JSON object for no cookie scene
		});

		if (!resp.ok) {
			// Refresh token invalid or expired — clear auth state
			clearLoggedInfo();
			return false;
		}

		const json = await resp.json();
		if (json.code !== "0" || !json.data?.access_token) {
			// Malformed response — treat as auth failure
			clearLoggedInfo();
			return false;
		}

		// Store new access token + user info (refresh token set via httpOnly cookie by backend)
		setLoggedInfo(json.data.access_token);
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
	let result = await rawBaseQuery(args, api, extraOptions);

	// 401 → try to refresh once (unless the user has explicitly logged out)
	if (result.error?.status === 401) {
		// If the user initiated a logout, skip refresh — in-flight requests
		// returning 401 after logout must not trigger a refresh-token roundtrip.
		if (isUserLoggedOut()) {
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
			result = await rawBaseQuery(args, api, extraOptions);
		} else {
			// Refresh also failed — force logout + redirect to login page.
			// We must call router.navigate() imperatively because baseQuery
			// runs outside React component context — useNavigate() is invalid here.
			// NOTE: We cannot import platformApi here (circular dep), so we
			// dispatch the RTK Query internal resetApiState action directly.
			clearLoggedInfo();
			if (!platformRouter) {
				console.error("[platformBaseApi] 401 refresh failed but platformRouter not injected — cannot redirect to login. Call setPlatformRouter() in main.tsx.");
			} else {
				platformRouter.navigate({ to: "/platform/login", replace: true });
			}
			if (!platformStore) {
				console.error("[platformBaseApi] 401 refresh failed but platformStore not injected — cannot reset API state. Call setPlatformStore() in main.tsx.");
			} else {
				platformStore.dispatch({ type: "platformApi/resetApiState" });
			}
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