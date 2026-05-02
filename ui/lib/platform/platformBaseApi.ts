/**
 * Platform Base API — independent RTK Query instance for the multi-user platform.
 * Own reducerPath, baseQuery, and tagTypes to avoid circular deps with workspace.
 */
import { getApiBaseUrl } from "@/lib/utils/port";
import { createApi, fetchBaseQuery, BaseQueryFn } from "@reduxjs/toolkit/query/react";
import { getToken, setToken, clearToken } from "./auth";
import type { FetchArgs, FetchBaseQueryError } from "@reduxjs/toolkit/query";

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
			body: JSON.stringify({ refresh_token: "" }),
		});

		if (!resp.ok) {
			// Refresh token invalid or expired — clear everything and return false
			clearToken();
			return false;
		}

		const json = await resp.json();
		if (json.code !== "0" || !json.data?.access_token) {
			clearToken();
			return false;
		}

		// Store new access token (refresh token is set via httpOnly cookie by the backend)
		setToken(json.data.access_token);
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
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
	args,
	api,
	extraOptions,
) => {
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
		}
		// If refresh failed, result stays as 401 — caller handles logout if needed
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
