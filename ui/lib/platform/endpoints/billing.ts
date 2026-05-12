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
	PlatformRechargeResponse,
	PlatformPurchaseResponse,
	PlatformEntityPackage,
	PlatformGateway,
	PlatformStabilityResponse,
	PlatformAdminStabilityResponse,
} from "./types";
import type {
	PricingOverride,
	CreatePricingOverrideRequest,
	UpdatePricingOverrideRequest,
} from "@/lib/types/governance";

const billingApi = platformBaseApi.injectEndpoints({
	endpoints: (builder) => ({
		// ── User-facing ────────────────────────────────────────────
		platformListPackages: builder.query<PlatformPackage[], { is_active?: boolean } | void>({
			query: (params) => ({
				url: "/billing/packages",
				method: "GET",
				params: {
					...(params && "is_active" in params && params.is_active !== undefined ? { is_active: params.is_active } : {}),
				},
			}),
			transformResponse: (response: { data?: { items?: PlatformPackage[] } }) => response.data?.items ?? [],
			providesTags: ["Packages"],
		}),

		platformGetBalance: builder.query<PlatformBalance, void>({
			query: () => ({ url: "/billing/balance", method: "GET" }),
			transformResponse: (response: { data?: PlatformBalance }) =>
				response.data ?? { balance: 0, balance_credits: 0, package_credits: 0, total_credits: 0 },
			providesTags: ["Balance"],
		}),

		platformGetBalanceHistory: builder.query<{ items: PlatformBalanceHistoryItem[]; total: number }, { offset?: number; limit?: number }>({
			query: (params) => ({
				url: "/billing/balance/history",
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
			query: () => ({ url: "/billing/user/packages", method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformUserPackage[] } }) => response.data?.items ?? [],
			providesTags: ["Packages"],
		}),

		platformGetTokenUsage: builder.query<
			{ items: PlatformTokenUsage[]; total: number },
			{ offset?: number; limit?: number; model?: string; provider?: string }
		>({
			query: (params) => ({
				url: "/billing/token-usage",
				method: "GET",
				params: {
					...(params?.offset !== undefined && { offset: params.offset }),
					...(params?.limit && { limit: params.limit }),
					...(params?.model && { model: params.model }),
					...(params?.provider && { provider: params.provider }),
				},
			}),
			transformResponse: (response: { data?: { list?: PlatformTokenUsage[]; total?: number } }) => ({
				items: response.data?.list ?? [],
				total: response.data?.total ?? 0,
			}),
			providesTags: ["UsageStats"],
		}),

		platformGetUsageStats: builder.query<PlatformUsageStats, { start_date?: string; end_date?: string; group_by?: string }>({
			query: (params) => ({
				url: "/platform/usage/me/stats",
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

		// ── Entity Packages (IV-B-2) ─────────────────────────────
		platformListEntityPackages: builder.query<
			{ items: PlatformEntityPackage[]; total: number },
			{ status?: string; tenant_type?: "personal" | "organization"; tenant_id?: string; offset?: number; limit?: number }
		>({
			query: (params) => ({
				url: "/billing/entity-packages",
				method: "GET",
				params: {
					...(params?.status && { status: params.status }),
					...(params?.tenant_type && { tenant_type: params.tenant_type }),
					...(params?.tenant_id && { tenant_id: params.tenant_id }),
					...(params?.offset !== undefined && { offset: params.offset }),
					...(params?.limit && { limit: params.limit }),
				},
			}),
			transformResponse: (response: { data?: { items?: PlatformEntityPackage[]; total?: number } }) => ({
				items: response.data?.items ?? [],
				total: response.data?.total ?? 0,
			}),
			providesTags: ["Packages", "Balance"],
		}),

		// ── Recharge (IV-A-1) ──────────────────────────────────────
		platformCreateRecharge: builder.mutation<
			PlatformRechargeResponse,
			{ amount: number; preferred_currency?: string; return_url?: string; tenant_type: string; tenant_id: string; gateway?: string }
		>({
			query: (body) => ({
				url: "/billing/recharge",
				method: "POST",
				body: {
					amount: body.amount,
					credits: body.amount * 100, // 1 credit = $0.01
					...(body.preferred_currency && { preferred_currency: body.preferred_currency }),
					...(body.return_url && { return_url: body.return_url }),
					...(body.gateway && { gateway: body.gateway }),
					tenant_type: body.tenant_type,
					tenant_id: body.tenant_id,
				},
			}),
			transformResponse: (response: { data?: PlatformRechargeResponse }) => response.data ?? ({} as PlatformRechargeResponse),
			invalidatesTags: ["Balance"],
		}),

		// ── Purchase (IV-A-2) ──────────────────────────────────────
		platformCreatePurchase: builder.mutation<
			PlatformPurchaseResponse,
			{ package_id: string; preferred_currency?: string; return_url?: string; tenant_type: string; tenant_id: string; gateway?: string }
		>({
			query: (body) => ({
				url: "/billing/purchases",
				method: "POST",
				body: {
					package_id: body.package_id,
					...(body.preferred_currency && { preferred_currency: body.preferred_currency }),
					...(body.return_url && { return_url: body.return_url }),
					tenant_type: body.tenant_type,
					tenant_id: body.tenant_id,
					...(body.gateway && { gateway: body.gateway }),
				},
			}),
			transformResponse: (response: { data?: PlatformPurchaseResponse }) => response.data ?? ({} as PlatformPurchaseResponse),
			invalidatesTags: ["Packages", "Balance"],
		}),

		// ── Orders ─────────────────────────────────────────────────
		platformListOrders: builder.query<
			{ items: PlatformPurchaseResponse[]; total: number },
			{ offset?: number; limit?: number; type?: string; status?: string }
		>({
			query: (params) => ({
				url: "/billing/orders",
				method: "GET",
				params: {
					...(params?.offset !== undefined && { offset: params.offset }),
					...(params?.limit && { limit: params.limit }),
					...(params?.type && { type: params.type }),
					...(params?.status && { status: params.status }),
				},
			}),
			transformResponse: (response: { data?: { items?: PlatformPurchaseResponse[]; total?: number } }) => ({
				items: response.data?.items ?? [],
				total: response.data?.total ?? 0,
			}),
			providesTags: ["Balance"],
		}),

		platformCancelOrder: builder.mutation<{ code: string; message: string }, number>({
			query: (orderId) => ({ url: `/billing/orders/${orderId}/cancel`, method: "POST" }),
			invalidatesTags: ["Balance"],
		}),

		platformConfirmOrder: builder.mutation<
			{ code: string; message: string; data?: { order?: Record<string, unknown>; entity_package?: Record<string, unknown> } },
			number
		>({
			query: (orderId) => ({ url: `/billing/orders/${orderId}/confirm`, method: "POST" }),
			invalidatesTags: ["Balance", "Packages"],
		}),

		platformRetryPay: builder.mutation<{ code: string; message: string; data?: PlatformPurchaseResponse }, number>({
			query: (orderId) => ({ url: `/billing/orders/${orderId}/retry-pay`, method: "POST" }),
			invalidatesTags: ["Balance"],
		}),

		platformListGateways: builder.query<PlatformGateway[], void>({
			query: () => ({ url: "/billing/gateways", method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformGateway[] } }) =>
				(response.data?.items ?? []).sort((a, b) => a.gateway.localeCompare(b.gateway)),
		}),

		// ── Admin: Billing ─────────────────────────────────────────
		platformAdminCreatePackage: builder.mutation<
			{ code: string; message: string; data?: PlatformPackage },
			Omit<PlatformPackage, "id" | "created_at">
		>({
			query: (body) => ({ url: "/billing/packages", method: "POST", body }),
			invalidatesTags: ["Packages"],
		}),

		platformAdminUpdatePackage: builder.mutation<
			{ code: string; message: string },
			Partial<Omit<PlatformPackage, "id" | "created_at"> & { id: string }>
		>({
			query: ({ id, ...body }) => ({ url: `/billing/packages/${id}`, method: "PUT", body }),
			invalidatesTags: ["Packages"],
		}),

		platformAdminDeletePackage: builder.mutation<{ code: string; message: string }, string>({
			query: (id) => ({ url: `/billing/packages/${id}`, method: "DELETE" }),
			invalidatesTags: ["Packages"],
		}),

		platformAdminListModelPrices: builder.query<
			{ items: PricingOverride[]; total: number },
			{ offset?: number; limit?: number; search?: string; scope_kind?: string }
		>({
			query: (params) => ({
				url: "/billing/admin/model-prices",
				method: "GET",
				params: {
					...(params?.offset !== undefined && { offset: params.offset }),
					...(params?.limit !== undefined && { limit: params.limit }),
					...(params?.search && { search: params.search }),
					...(params?.scope_kind && { scope_kind: params.scope_kind }),
				},
			}),
			transformResponse: (response: { pricing_overrides?: PricingOverride[]; total_count?: number }) => ({
				items: response.pricing_overrides ?? [],
				total: response.total_count ?? 0,
			}),
			providesTags: ["ModelPrices"],
		}),

		platformAdminCreateModelPrice: builder.mutation<
			{ message: string; pricing_override: PricingOverride },
			CreatePricingOverrideRequest
		>({
			query: (body) => ({ url: "/billing/admin/model-prices", method: "POST", body }),
			invalidatesTags: ["ModelPrices"],
		}),

		platformAdminUpdateModelPrice: builder.mutation<
			{ message: string; pricing_override: PricingOverride },
			{ id: string; data: UpdatePricingOverrideRequest }
		>({
			query: ({ id, data }) => ({ url: `/billing/admin/model-prices/${id}`, method: "PUT", body: data }),
			invalidatesTags: ["ModelPrices"],
		}),

		platformAdminDeleteModelPrice: builder.mutation<
			{ message: string },
			string
		>({
			query: (id) => ({ url: `/billing/admin/model-prices/${id}`, method: "DELETE" }),
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
				url: "/platform/usage/admin/stats",
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

		// ── Usage Stability ────────────────────────────────────────────
		platformGetUsageStability: builder.query<
			PlatformStabilityResponse,
			{ start_date: string; end_date: string; dimension?: "all" | "provider" | "model" }
		>({
			query: (params) => ({
				url: "/platform/usage/me/stability",
				method: "GET",
				params: {
					start_date: params.start_date,
					end_date: params.end_date,
					...(params?.dimension && { dimension: params.dimension }),
				},
			}),
			transformResponse: (response: { data?: PlatformStabilityResponse }) =>
				response.data ?? {
					start_date: "",
					end_date: "",
					summary: { avg_latency: 0, p90_latency: 0, p95_latency: 0, p99_latency: 0, success_rate: 0, total_success: 0, total_error: 0 },
					daily: [],
				},
			providesTags: ["UsageStats"],
		}),

		platformAdminGetUsageStability: builder.query<
			PlatformAdminStabilityResponse,
			{
				start_date: string;
				end_date: string;
				dimension?: "all" | "provider" | "model";
				user_id?: string;
				customer_id?: string;
				team_id?: string;
			}
		>({
			query: (params) => ({
				url: "/platform/usage/admin/stability",
				method: "GET",
				params: {
					start_date: params.start_date,
					end_date: params.end_date,
					...(params?.dimension && { dimension: params.dimension }),
					...(params?.user_id && { user_id: params.user_id }),
					...(params?.customer_id && { customer_id: params.customer_id }),
					...(params?.team_id && { team_id: params.team_id }),
				},
			}),
			transformResponse: (response: { data?: PlatformAdminStabilityResponse }) =>
				response.data ?? {
					start_date: "",
					end_date: "",
					summary: { avg_latency: 0, p90_latency: 0, p95_latency: 0, p99_latency: 0, success_rate: 0, total_success: 0, total_error: 0 },
					daily: [],
				},
			providesTags: ["UsageStats"],
		}),
	}),
});

export const {
	usePlatformListPackagesQuery,
	usePlatformGetBalanceQuery,
	usePlatformGetBalanceHistoryQuery,
	usePlatformListEntityPackagesQuery,
	usePlatformListUserPackagesQuery,
	usePlatformGetTokenUsageQuery,
	usePlatformGetUsageStatsQuery,
	usePlatformCreateRechargeMutation,
	usePlatformCreatePurchaseMutation,
	usePlatformListOrdersQuery,
	usePlatformCancelOrderMutation,
	usePlatformConfirmOrderMutation,
	usePlatformRetryPayMutation,
	usePlatformListGatewaysQuery,
	usePlatformAdminCreatePackageMutation,
	usePlatformAdminUpdatePackageMutation,
	usePlatformAdminDeletePackageMutation,
	usePlatformAdminListModelPricesQuery,
	usePlatformAdminCreateModelPriceMutation,
	usePlatformAdminUpdateModelPriceMutation,
	usePlatformAdminDeleteModelPriceMutation,
	usePlatformAdminGetUsageStatsQuery,
	usePlatformGetUsageStabilityQuery,
	usePlatformAdminGetUsageStabilityQuery,
} = billingApi;