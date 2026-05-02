/**
 * Billing endpoints — user-facing packages/balance/usage and admin billing/model prices.
 */
import { platformBaseApi } from "../platformBaseApi";
import type {
	PlatformPackage,
	PlatformUserPackage,
	PlatformBalance,
	PlatformBalanceHistoryItem,
	PlatformUsageStats,
	PlatformTokenUsage,
	PlatformModelPrice,
} from "./types";

const billingApi = platformBaseApi.injectEndpoints({
	endpoints: (builder) => ({
		// ── User-facing ────────────────────────────────────────────
		platformListPackages: builder.query<PlatformPackage[], void>({
			query: () => ({ url: "/packages", method: "GET" }),
			transformResponse: (response: { data?: PlatformPackage[] }) => response.data ?? [],
			providesTags: ["Packages"],
		}),

		platformGetBalance: builder.query<PlatformBalance, void>({
			query: () => ({ url: "/balance", method: "GET" }),
			transformResponse: (response: { data?: PlatformBalance }) =>
				response.data ?? { balance: 0, package_credits: 0, total_credits: 0, currency: "USD" },
			providesTags: ["Balance"],
		}),

		platformGetBalanceHistory: builder.query<
			{ items: PlatformBalanceHistoryItem[]; total: number },
			{ offset?: number; limit?: number }
		>({
			query: (params) => ({
				url: "/balance/history",
				method: "GET",
				params: {
					...(params?.offset !== undefined && { offset: params.offset }),
					...(params?.limit && { limit: params.limit }),
				},
			}),
			transformResponse: (response: { data?: { items?: PlatformBalanceHistoryItem[]; total?: number } }) => ({
				items: response.data?.items ?? [],
				total: response.data?.total ?? 0,
			}),
			providesTags: ["Balance"],
		}),

		platformListUserPackages: builder.query<PlatformUserPackage[], void>({
			query: () => ({ url: "/user/packages", method: "GET" }),
			transformResponse: (response: { data?: PlatformUserPackage[] }) => response.data ?? [],
			providesTags: ["Packages"],
		}),

		platformGetTokenUsage: builder.query<
			{ items: PlatformTokenUsage[]; total: number },
			{ offset?: number; limit?: number; model?: string; provider?: string }
		>({
			query: (params) => ({
				url: "/token-usage",
				method: "GET",
				params: {
					...(params?.offset !== undefined && { offset: params.offset }),
					...(params?.limit && { limit: params.limit }),
					...(params?.model && { model: params.model }),
					...(params?.provider && { provider: params.provider }),
				},
			}),
			transformResponse: (response: { data?: { items?: PlatformTokenUsage[]; total?: number } }) => ({
				items: response.data?.items ?? [],
				total: response.data?.total ?? 0,
			}),
			providesTags: ["UsageStats"],
		}),

		platformGetUsageStats: builder.query<PlatformUsageStats, { start_date?: string; end_date?: string; group_by?: string }>({
			query: (params) => ({
				url: "/usage/stats",
				method: "GET",
				params: {
					...(params?.start_date && { start_date: params.start_date }),
					...(params?.end_date && { end_date: params.end_date }),
					...(params?.group_by && { group_by: params.group_by }),
				},
			}),
			transformResponse: (response: { data?: PlatformUsageStats }) =>
				response.data ?? {
					start_date: "",
					end_date: "",
					group_by: "day",
					summary: { total_calls: 0, total_tokens: 0, total_credits: 0 },
					details: [],
				},
			providesTags: ["UsageStats"],
		}),

		// ── Admin: Billing ─────────────────────────────────────────
		platformAdminCreatePackage: builder.mutation<{ code: string; message: string }, Omit<PlatformPackage, "id" | "created_at">>({
			query: (body) => ({ url: "/admin/package/create", method: "POST", body }),
			invalidatesTags: ["Packages"],
		}),

		platformAdminUpdatePackage: builder.mutation<{ code: string; message: string }, Partial<PlatformPackage> & { id: number }>({
			query: ({ id, ...body }) => ({ url: "/admin/package/update", method: "PUT", body: { id, ...body } }),
			invalidatesTags: ["Packages"],
		}),

		platformAdminDeletePackage: builder.mutation<{ code: string; message: string }, number>({
			query: (id) => ({ url: `/admin/package/delete/${id}`, method: "DELETE" }),
			invalidatesTags: ["Packages"],
		}),

		platformAdminListModelPrices: builder.query<PlatformModelPrice[], void>({
			query: () => ({ url: "/admin/model-prices", method: "GET" }),
			transformResponse: (response: { data?: PlatformModelPrice[] }) => response.data ?? [],
			providesTags: ["ModelPrices"],
		}),

		platformAdminUpsertModelPrice: builder.mutation<
			{ code: string; message: string },
			{ model: string; provider: string; input_token_price: number; output_token_price: number }
		>({
			query: (body) => ({ url: "/admin/model-prices", method: "POST", body }),
			invalidatesTags: ["ModelPrices"],
		}),

		platformAdminDeleteModelPrice: builder.mutation<{ code: string; message: string }, number>({
			query: (id) => ({ url: `/admin/model-prices/${id}`, method: "DELETE" }),
			invalidatesTags: ["ModelPrices"],
		}),

		platformAdminGetUsageStats: builder.query<
			PlatformUsageStats,
			{
				start_date?: string;
				end_date?: string;
				group_by?: string;
				user_id?: string;
				customer_id?: string;
				team_id?: string;
			}
		>({
			query: (params) => ({
				url: "/admin/usage/stats",
				method: "GET",
				params: {
					...(params?.start_date && { start_date: params.start_date }),
					...(params?.end_date && { end_date: params.end_date }),
					...(params?.group_by && { group_by: params.group_by }),
					...(params?.user_id && { user_id: params.user_id }),
					...(params?.customer_id && { customer_id: params.customer_id }),
					...(params?.team_id && { team_id: params.team_id }),
				},
			}),
			transformResponse: (response: { data?: PlatformUsageStats }) =>
				response.data ?? {
					start_date: "",
					end_date: "",
					group_by: "day",
					summary: { total_calls: 0, total_tokens: 0, total_credits: 0 },
					details: [],
				},
			providesTags: ["UsageStats"],
		}),
	}),
});

export const {
	usePlatformListPackagesQuery,
	usePlatformGetBalanceQuery,
	usePlatformGetBalanceHistoryQuery,
	usePlatformListUserPackagesQuery,
	usePlatformGetTokenUsageQuery,
	usePlatformGetUsageStatsQuery,
	usePlatformAdminCreatePackageMutation,
	usePlatformAdminUpdatePackageMutation,
	usePlatformAdminDeletePackageMutation,
	usePlatformAdminListModelPricesQuery,
	usePlatformAdminUpsertModelPriceMutation,
	usePlatformAdminDeleteModelPriceMutation,
	usePlatformAdminGetUsageStatsQuery,
} = billingApi;
