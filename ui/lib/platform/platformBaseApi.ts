/**
 * Platform Base API — independent RTK Query instance for the multi-user platform.
 * Own reducerPath, baseQuery, and tagTypes to avoid circular deps with workspace.
 */
import { getApiBaseUrl } from "@/lib/utils/port";
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

const baseQuery = fetchBaseQuery({
	baseUrl: getApiBaseUrl(),
	credentials: "include",
	prepareHeaders: async (headers) => {
		headers.set("Content-Type", "application/json");
		return headers;
	},
});

export const platformBaseApi = createApi({
	reducerPath: "platformApi",
	baseQuery,
	tagTypes: [
		"CurrentUser",
		"VirtualKeys",
		"Customers",
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
