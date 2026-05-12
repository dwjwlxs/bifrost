/**
 * Usage analytics endpoints — unified org + team overview and breakdown.
 * New API replacing the old /billing/admin/org/usage/* endpoints.
 */
import { platformBaseApi } from "../platformBaseApi";
import type {
	PlatformUsageOverviewResponse,
	PlatformUsageBreakdownResponse,
	PlatformMeStats,
	PlatformMeHistogram,
	PlatformMeDistribution,
	PlatformMeStabilityResponse,
} from "../types";

const usageApi = platformBaseApi.injectEndpoints({
	endpoints: (builder) => ({
		// ── Org Usage ─────────────────────────────────────────────

		/** Org-level usage overview: summary + daily trend. */
		platformGetOrgUsageOverview: builder.query<PlatformUsageOverviewResponse, { orgId: string; start_date: string; end_date: string }>({
			query: ({ orgId, start_date, end_date }) => ({
				url: `/usage/orgs/${orgId}/overview`,
				method: "GET",
				params: { start_date, end_date },
			}),
			transformResponse: (response: { data?: PlatformUsageOverviewResponse }) => response.data as PlatformUsageOverviewResponse,
			providesTags: ["UsageStats"],
		}),

		/** Org-level usage breakdown: rankings + daily per-ranked-entity. */
		platformGetOrgUsageBreakdown: builder.query<
			PlatformUsageBreakdownResponse,
			{
				orgId: string;
				dimension: "team" | "user";
				start_date: string;
				end_date: string;
				top_n?: number;
			}
		>({
			query: ({ orgId, dimension, start_date, end_date, top_n }) => ({
				url: `/usage/orgs/${orgId}/breakdown`,
				method: "GET",
				params: { dimension, start_date, end_date, ...(top_n ? { top_n } : {}) },
			}),
			transformResponse: (response: { data?: PlatformUsageBreakdownResponse }) => response.data as PlatformUsageBreakdownResponse,
			providesTags: ["UsageStats"],
		}),

		// ── Team Usage ────────────────────────────────────────────

		/** Team-level usage overview: summary + daily trend. Visible to team_member. */
		platformGetTeamUsageOverview: builder.query<PlatformUsageOverviewResponse, { teamId: string; start_date: string; end_date: string }>({
			query: ({ teamId, start_date, end_date }) => ({
				url: `/usage/teams/${teamId}/overview`,
				method: "GET",
				params: { start_date, end_date },
			}),
			transformResponse: (response: { data?: PlatformUsageOverviewResponse }) => response.data as PlatformUsageOverviewResponse,
			providesTags: ["UsageStats"],
		}),

		/**
		 * Team-level usage breakdown: rankings + daily per-member.
		 * Only team_admin can see full member breakdown.
		 */
		platformGetTeamUsageBreakdown: builder.query<
			PlatformUsageBreakdownResponse,
			{
				teamId: string;
				dimension: "member";
				start_date: string;
				end_date: string;
				top_n?: number;
			}
		>({
			query: ({ teamId, dimension, start_date, end_date, top_n }) => ({
				url: `/usage/teams/${teamId}/breakdown`,
				method: "GET",
				params: { dimension, start_date, end_date, ...(top_n ? { top_n } : {}) },
			}),
			transformResponse: (response: { data?: PlatformUsageBreakdownResponse }) => response.data as PlatformUsageBreakdownResponse,
			providesTags: ["UsageStats"],
		}),

		/**
		 * My usage within a team — returns breakdown filtered to the current user.
		 * team_member sees only their own data.
		 */
		platformGetTeamMyUsage: builder.query<PlatformUsageBreakdownResponse, { teamId: string; start_date: string; end_date: string }>({
			query: ({ teamId, start_date, end_date }) => ({
				url: `/usage/teams/${teamId}/my-usage`,
				method: "GET",
				params: { start_date, end_date },
			}),
			transformResponse: (response: { data?: PlatformUsageBreakdownResponse }) => response.data as PlatformUsageBreakdownResponse,
			providesTags: ["UsageStats"],
		}),

		// ── Personal Usage (/me/*) ──────────────────────────────────────────

		/** Personal usage stats — GET /api/platform/usage/me/stats */
		platformGetMeStats: builder.query<PlatformMeStats, { start_date: string; end_date: string }>({
			query: ({ start_date, end_date }) => ({
				url: `/platform/usage/me/stats`,
				method: "GET",
				params: { start_date, end_date },
			}),
			transformResponse: (response: { data?: PlatformMeStats }) =>
				(response.data) ?? {
					total_requests: 0,
					success_rate: 0,
					user_facing_success_rate: 0,
					average_latency: 0,
					total_tokens: 0,
					total_cost: 0,
				},
			providesTags: ["UsageStats"],
		}),

		/** Personal usage trend — GET /api/platform/usage/me/stats/trend */
		platformGetMeStatsTrend: builder.query<PlatformMeHistogram, { start_date: string; end_date: string }>({
			query: ({ start_date, end_date }) => ({
				url: `/platform/usage/me/stats/trend`,
				method: "GET",
				params: { start_date, end_date },
			}),
			transformResponse: (response: { data?: PlatformMeHistogram }) =>
				(response.data) ?? { buckets: [], bucket_size_seconds: 0 },
			providesTags: ["UsageStats"],
		}),

		/** Personal usage distribution — GET /api/platform/usage/me/distribution */
		platformGetMeDistribution: builder.query<PlatformMeDistribution, { start_date: string; end_date: string; dimension: "provider" | "model" | "virtual_key_name" }>({
			query: ({ start_date, end_date, dimension }) => ({
				url: `/platform/usage/me/distribution`,
				method: "GET",
				params: { start_date, end_date, dimension },
			}),
			transformResponse: (response: { data?: PlatformMeDistribution }) =>
				(response.data) ?? { dimension: "", rankings: [] },
			providesTags: ["UsageStats"],
		}),

		/** Personal stability metrics — GET /api/platform/usage/me/stability */
		platformGetMeStability: builder.query<PlatformMeStabilityResponse, { start_date: string; end_date: string }>({
			query: ({ start_date, end_date }) => ({
				url: `/platform/usage/me/stability`,
				method: "GET",
				params: { start_date, end_date },
			}),
			transformResponse: (response: { data?: PlatformMeStabilityResponse }) =>
				(response.data) ?? {
					summary: { avg_latency: 0, p90_latency: 0, p95_latency: 0, p99_latency: 0, success_rate: 0, total_success: 0, total_error: 0 },
					buckets: [],
					bucket_size_seconds: 0,
				},
			providesTags: ["UsageStats"],
		}),
	}),
});

export const {
	usePlatformGetOrgUsageOverviewQuery,
	usePlatformGetOrgUsageBreakdownQuery,
	usePlatformGetTeamUsageOverviewQuery,
	usePlatformGetTeamUsageBreakdownQuery,
	usePlatformGetTeamMyUsageQuery,
	usePlatformGetMeStatsQuery,
	usePlatformGetMeStatsTrendQuery,
	usePlatformGetMeDistributionQuery,
	usePlatformGetMeStabilityQuery,
} = usageApi;