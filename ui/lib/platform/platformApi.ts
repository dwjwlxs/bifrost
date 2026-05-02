/**
 * Platform API — RTK Query endpoints for the multi-user platform (v2).
 *
 * Endpoint conventions:
 *   /api/platform/login, /register, /verify           → public (no auth)
 *   /api/platform/profile                             → RequireAuth
 *   /api/platform/virtual-keys                       → RequireAuth (user-scoped)
 *   /api/platform/orgs                               → RequireAuth (user's orgs)
 *   /api/platform/orgs/:orgId/teams                 → RequireOrgAdmin
 *   /api/platform/orgs/:orgId/members               → RequireOrgAdmin
 *   /api/platform/teams                              → RequireAuth (user's teams)
 *   /api/platform/teams/:teamId                     → RequireTeamMember
 *   /api/platform/teams/:teamId/members             → RequireTeamAdmin
 *   /api/platform/admin/orgs                         → RequireAdmin (system-wide)
 *   /api/platform/admin/users                        → RequireAdmin
 *   /api/platform/invitations/:token/accept          → public
 *
 * Type conventions:
 *   API responses follow { code, message, data } wrapper.
 *   transformResponse extracts the inner data.
 */
import { platformBaseApi } from "./platformBaseApi";
import type { PlatformUserInfo } from "./auth";

// ─── Core Types ────────────────────────────────────────────────────────

/** Organization (aka Customer) */
export interface PlatformOrg {
	id: string;
	name: string;
	owner_user_id?: number;
	budget_id?: string;
	rate_limit_id?: string;
	created_at?: string;
	updated_at?: string;
}

/** Organization member (user membership in an org) */
export interface PlatformOrgMember {
	user_id: string;
	email: string;
	username: string;
	role: "admin" | "member";
	joined_at?: string;
}

/** Team */
export interface PlatformTeam {
	id: string;
	name: string;
	customer_id?: string;
	owner_user_id?: number;
	budget_limit?: number;
	budget_spent?: number;
	budget_reset_at?: string;
	created_at?: string;
	updated_at?: string;
}

/** Team member */
export interface PlatformTeamMember {
	user_id: string;
	email: string;
	username: string;
	role: "admin" | "member";
	joined_at?: string;
}

/** Invitation record */
export interface PlatformInvitation {
	id: string;
	org_id?: string;
	team_id?: string;
	email: string;
	role: string;
	accepted: boolean;
	expires_at: string;
	created_at?: string;
}

export interface PlatformVirtualKey {
	id: string;
	name: string;
	value: string;
	description?: string;
	is_active: boolean;
	user_id?: string;
	team_id?: string;
	customer_id?: string;
	budget_limit?: number;
	current_usage?: number;
	created_at: string;
	updated_at: string;
}

export interface PlatformCustomRole {
	id: string;
	name: string;
	scope: string;
	customer_id?: string;
	team_id?: string;
	permissions: string[];
	description?: string;
	created_at: string;
	updated_at: string;
}

export interface PlatformUserRole {
	user_id: number;
	role_id: string;
	customer_id?: string;
	team_id?: string;
	role?: PlatformCustomRole;
}

// ─── Billing Types ─────────────────────────────────────────────────

export interface PlatformPackage {
	id: number;
	name: string;
	description: string;
	token_amount: number;
	credits: number;
	price: number;
	currency: string;
	package_type: string;
	duration_days: number | null;
	features: string[];
	is_active: boolean;
	sort_order: number;
	created_at: string;
}

export interface PlatformUserPackage {
	id: number;
	package_id: number;
	package_name: string;
	remaining_credits: number;
	remaining_tokens: number;
	remaining_calls: number;
	expires_at: string;
	status: string;
	created_at: string;
}

export interface PlatformOrder {
	id: number;
	order_no: string;
	package_id?: number;
	package_name: string;
	token_amount: number;
	original_price: number;
	discount_amount: number;
	final_amount: number;
	currency: string;
	status: string;
	payment_method: string;
	payment_no?: string;
	paid_at?: string;
	created_at: string;
}

export interface PlatformRecharge {
	id: number;
	recharge_no: string;
	amount: number;
	bonus_amount: number;
	final_amount: number;
	currency: string;
	payment_method: string;
	payment_no?: string;
	status: string;
	paid_at?: string;
	created_at: string;
}

export interface PlatformBalance {
	balance: number;
	package_credits: number;
	total_credits: number;
	currency: string;
}

export interface PlatformBalanceHistoryItem {
	type: string; // recharge | purchase | usage
	id: number;
	amount: number;
	note: string;
	status: string;
	created_at: string;
}

export interface PlatformUsageStatRow {
	key: string;
	call_count: number;
	input_tokens: number;
	output_tokens: number;
	total_tokens: number;
	credits_consumed: number;
}

export interface PlatformUsageStats {
	start_date: string;
	end_date: string;
	group_by: string;
	summary: {
		total_calls: number;
		total_tokens: number;
		total_credits: number;
	};
	details: PlatformUsageStatRow[];
}

export interface PlatformTokenUsage {
	id: number;
	api_key_id: string;
	package_id?: number;
	input_tokens: number;
	output_tokens: number;
	token_used: number;
	cost: number;
	deduct_source: string;
	model: string;
	provider: string;
	request_id?: string;
	created_at: string;
}

export interface PlatformModelPrice {
	id: number;
	model: string;
	provider: string;
	input_token_price: number;
	output_token_price: number;
	created_at: string;
	updated_at: string;
}

// ─── API Slice ────────────────────────────────────────────────────

export const platformApi = platformBaseApi.injectEndpoints({
	endpoints: (builder) => ({
		// ── Auth (public) ───────────────────────────────────────────
		platformLogin: builder.mutation<
			{ code: string; message: string; data: { access_token: string; expires_at: string } },
			{ email: string; password: string }
		>({
			query: (body) => ({ url: "/platform/login", method: "POST", body }),
		}),

		platformRegister: builder.mutation<
			{ code: string; message: string; data: { user_id: number; email: string } },
			{ email: string; username: string; password: string; nickname?: string }
		>({
			query: (body) => ({ url: "/platform/register", method: "POST", body }),
		}),

		platformVerifyEmail: builder.mutation<
			{ code: string; message: string; data: { access_token: string; expires_at: string } },
			{ email: string; code: string }
		>({
			query: (body) => ({ url: "/platform/verify", method: "POST", body }),
		}),

		platformResendVerification: builder.mutation<
			{ code: string; message: string; data: { success: boolean } },
			{ email: string }
		>({
			query: (body) => ({ url: "/auth/resend-verification", method: "POST", body }),
		}),

		platformAcceptInvitation: builder.mutation<
			{ code: string; message: string; data?: { token: string } },
			{ token: string }
		>({
			query: (body) => ({ url: `/platform/invitations/${body.token}/accept`, method: "POST" }),
		}),

		// ── User Profile ────────────────────────────────────────────
		platformGetProfile: builder.query<PlatformUserInfo, void>({
			query: () => ({ url: "/platform/profile", method: "GET" }),
			providesTags: ["CurrentUser"],
		}),

		platformUpdateProfile: builder.mutation<
			PlatformUserInfo,
			Partial<Pick<PlatformUserInfo, "nickname" | "email">>
		>({
			query: (body) => ({ url: "/platform/profile", method: "PUT", body }),
			invalidatesTags: ["CurrentUser"],
		}),

		platformChangePassword: builder.mutation<
			{ code: string; message: string },
			{ old_password: string; new_password: string }
		>({
			query: (body) => ({ url: "/platform/profile/password", method: "POST", body }),
		}),

		// ── Virtual Keys (user-scoped) ─────────────────────────────
		/** List only the current user's VKs */
		platformListVKs: builder.query<PlatformVirtualKey[], void>({
			query: () => ({ url: "/platform/virtual-keys", method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformVirtualKey[] } }) =>
				response.data?.items ?? [],
			providesTags: ["VirtualKeys"],
		}),

		/** Create a new VK for the current user */
		platformCreateVK: builder.mutation<
			PlatformVirtualKey,
			{ name: string; description?: string; team_id?: string }
		>({
			query: (body) => ({ url: "/platform/virtual-keys", method: "POST", body }),
			transformResponse: (response: { data?: PlatformVirtualKey }) =>
				response.data ?? ({} as PlatformVirtualKey),
			invalidatesTags: ["VirtualKeys"],
		}),

		/** Update one of the current user's VKs */
		platformUpdateVK: builder.mutation<
			PlatformVirtualKey,
			{ id: string; data: Partial<Pick<PlatformVirtualKey, "name" | "description" | "is_active">> }
		>({
			query: ({ id, data }) => ({ url: `/platform/virtual-keys/${id}`, method: "PUT", body: data }),
			transformResponse: (response: { data?: PlatformVirtualKey }) =>
				response.data ?? ({} as PlatformVirtualKey),
			invalidatesTags: ["VirtualKeys"],
		}),

		/** Delete one of the current user's VKs */
		platformDeleteVK: builder.mutation<{ code: string; message: string }, string>({
			query: (id) => ({ url: `/platform/virtual-keys/${id}`, method: "DELETE" }),
			invalidatesTags: ["VirtualKeys"],
		}),

		// ── Organizations ────────────────────────────────────────────
		/** List the current user's organizations */
		platformListOrgs: builder.query<PlatformOrg[], void>({
			query: () => ({ url: "/platform/orgs", method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformOrg[] } }) =>
				response.data?.items ?? [],
			providesTags: ["Orgs"],
		}),

		/** Get organization details (any org the user belongs to) */
		platformGetOrg: builder.query<PlatformOrg, string>({
			query: (id) => ({ url: `/platform/orgs/${id}`, method: "GET" }),
			providesTags: (result, error, id) => [{ type: "Orgs", id }],
		}),

		// ── Organization Members ────────────────────────────────────
		/** List members of an organization (org_admin only) */
		platformListOrgMembers: builder.query<PlatformOrgMember[], string>({
			query: (orgId) => ({ url: `/platform/orgs/${orgId}/members`, method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformOrgMember[] } }) =>
				response.data?.items ?? [],
			providesTags: ["Users"],
		}),

		// ── Organization Teams ───────────────────────────────────────
		/** List teams within an organization (org_admin only) */
		platformListOrgTeams: builder.query<PlatformTeam[], string>({
			query: (orgId) => ({ url: `/platform/orgs/${orgId}/teams`, method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformTeam[] } }) =>
				response.data?.items ?? [],
			providesTags: ["Teams"],
		}),

		/** Create a team within an organization (org_admin only) */
		platformCreateOrgTeam: builder.mutation<PlatformTeam, { org_id: string; name: string }>({
			query: ({ org_id, name }) => ({
				url: `/platform/orgs/${org_id}/teams`,
				method: "POST",
				body: { name },
			}),
			transformResponse: (response: { data?: PlatformTeam }) =>
				response.data ?? ({} as PlatformTeam),
			invalidatesTags: ["Teams"],
		}),

		// ── Teams ───────────────────────────────────────────────────
		/** List teams the current user belongs to */
		platformListTeams: builder.query<PlatformTeam[], void>({
			query: () => ({ url: "/platform/teams", method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformTeam[] } }) =>
				response.data?.items ?? [],
			providesTags: ["Teams"],
		}),

		/** Get team details (any team the user belongs to) */
		platformGetTeam: builder.query<PlatformTeam, string>({
			query: (id) => ({ url: `/platform/teams/${id}`, method: "GET" }),
			providesTags: (result, error, id) => [{ type: "Teams", id }],
		}),

		/** Update team info / budget (team_admin only) */
		platformUpdateTeam: builder.mutation<
			PlatformTeam,
			{ id: string; name?: string; budget_limit?: number; budget_reset_at?: string }
		>({
			query: ({ id, ...body }) => ({ url: `/platform/teams/${id}`, method: "PUT", body }),
			transformResponse: (response: { data?: PlatformTeam }) =>
				response.data ?? ({} as PlatformTeam),
			invalidatesTags: ["Teams"],
		}),

		// ── Team Members ────────────────────────────────────────────
		/** List members of a team (team_admin or team_member) */
		platformListTeamMembers: builder.query<PlatformTeamMember[], string>({
			query: (teamId) => ({ url: `/platform/teams/${teamId}/members`, method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformTeamMember[] } }) =>
				response.data?.items ?? [],
			providesTags: ["Users"],
		}),

		/** Invite a user to a team (team_admin only) */
		platformInviteTeamMember: builder.mutation<
			{ code: string; message: string; invitation?: PlatformInvitation },
			{ team_id: string; email: string; role?: "admin" | "member" }
		>({
			query: ({ team_id, ...body }) => ({
				url: `/platform/teams/${team_id}/members`,
				method: "POST",
				body,
			}),
			invalidatesTags: ["Users"],
		}),

		/** Remove a member from a team (team_admin only) */
		platformRemoveTeamMember: builder.mutation<
			{ code: string; message: string },
			{ team_id: string; user_id: string }
		>({
			query: ({ team_id, user_id }) => ({
				url: `/platform/teams/${team_id}/members/${user_id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Users"],
		}),

		/** Update a team member's role (team_admin only) */
		platformUpdateTeamMember: builder.mutation<
			{ code: string; message: string },
			{ team_id: string; user_id: string; role: "admin" | "member" }
		>({
			query: ({ team_id, user_id, role }) => ({
				url: `/platform/teams/${team_id}/members/${user_id}`,
				method: "PUT",
				body: { role },
			}),
			invalidatesTags: ["Users"],
		}),

		// ── Team VKs ────────────────────────────────────────────────
		/** List VKs within a team (team_admin only) */
		platformListTeamVKs: builder.query<PlatformVirtualKey[], string>({
			query: (teamId) => ({ url: `/platform/teams/${teamId}/virtual-keys`, method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformVirtualKey[] } }) =>
				response.data?.items ?? [],
			providesTags: ["VirtualKeys"],
		}),

		/** Update a VK budget within a team (team_admin only) */
		platformUpdateTeamVK: builder.mutation<
			PlatformVirtualKey,
			{ team_id: string; vk_id: string; budget_limit?: number }
		>({
			query: ({ team_id, vk_id, ...body }) => ({
				url: `/platform/teams/${team_id}/virtual-keys/${vk_id}`,
				method: "PUT",
				body,
			}),
			transformResponse: (response: { data?: PlatformVirtualKey }) =>
				response.data ?? ({} as PlatformVirtualKey),
			invalidatesTags: ["VirtualKeys"],
		}),

		// ── Admin: Organizations ────────────────────────────────────
		/** List all organizations (system admin only) */
		platformAdminListOrgs: builder.query<
			{ items: PlatformOrg[]; total: number },
			{ limit?: number; offset?: number; search?: string } | void
		>({
			query: (params) => ({
				url: "/platform/admin/orgs",
				method: "GET",
				params: {
					...(params?.limit && { limit: params.limit }),
					...(params?.offset !== undefined && { offset: params.offset }),
					...(params?.search && { search: params.search }),
				},
			}),
			transformResponse: (response: { data?: { items?: PlatformOrg[]; total?: number } }) => ({
				items: response.data?.items ?? [],
				total: response.data?.total ?? 0,
			}),
			providesTags: ["Orgs"],
		}),

		/** Create an organization (system admin only) */
		platformAdminCreateOrg: builder.mutation<
			{ code: string; message: string; data?: PlatformOrg },
			{ name: string; admin_email?: string }
		>({
			query: (body) => ({ url: "/platform/admin/orgs", method: "POST", body }),
			invalidatesTags: ["Orgs"],
		}),

		/** Update an organization (system admin only) */
		platformAdminUpdateOrg: builder.mutation<
			{ code: string; message: string; data?: PlatformOrg },
			{ id: string; name?: string }
		>({
			query: ({ id, ...body }) => ({ url: `/platform/admin/orgs/${id}`, method: "PUT", body }),
			invalidatesTags: ["Orgs"],
		}),

		/** Delete an organization (system admin only) */
		platformAdminDeleteOrg: builder.mutation<{ code: string; message: string }, string>({
			query: (id) => ({ url: `/platform/admin/orgs/${id}`, method: "DELETE" }),
			invalidatesTags: ["Orgs"],
		}),

		// ── Admin: Users ────────────────────────────────────────────
		platformListUsers: builder.query<
			{ items: PlatformUserInfo[]; total: number },
			{ limit?: number; offset?: number; search?: string } | void
		>({
			query: (params) => ({
				url: "/platform/admin/users",
				method: "GET",
				params: {
					...(params?.limit && { limit: params.limit }),
					...(params?.offset !== undefined && { offset: params.offset }),
					...(params?.search && { search: params.search }),
				},
			}),
			transformResponse: (response: { data?: { items?: PlatformUserInfo[]; total?: number } }) => ({
				items: response.data?.items ?? [],
				total: response.data?.total ?? 0,
			}),
			providesTags: ["Users"],
		}),

		platformSetUserRole: builder.mutation<
			{ code: string; message: string },
			{ user_id: string; role: string }
		>({
			query: ({ user_id, ...body }) => ({
				url: `/platform/admin/users/${user_id}/role`,
				method: "PUT",
				body,
			}),
			invalidatesTags: ["Users"],
		}),

		// ── RBAC ───────────────────────────────────────────────────
		platformListRoles: builder.query<PlatformCustomRole[], void>({
			query: () => ({ url: "/platform/admin/roles", method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformCustomRole[] } }) =>
				response.data?.items ?? [],
			providesTags: ["Roles"],
		}),

		platformCreateRole: builder.mutation<
			{ code: string; message: string; data?: PlatformCustomRole },
			{ name: string; scope: string; permissions: string[]; description?: string }
		>({
			query: (body) => ({ url: "/platform/admin/roles", method: "POST", body }),
			invalidatesTags: ["Roles"],
		}),

		platformUpdateRole: builder.mutation<
			{ code: string; message: string; data?: PlatformCustomRole },
			{ id: string; name?: string; permissions?: string[]; description?: string }
		>({
			query: ({ id, ...body }) => ({ url: `/platform/admin/roles/${id}`, method: "PUT", body }),
			invalidatesTags: ["Roles"],
		}),

		platformDeleteRole: builder.mutation<{ code: string; message: string }, string>({
			query: (id) => ({ url: `/platform/admin/roles/${id}`, method: "DELETE" }),
			invalidatesTags: ["Roles"],
		}),

		// ── Billing: User-facing ────────────────────────────────────
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
			{ offset?: number; limit?: number } | void
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
			{ offset?: number; limit?: number; model?: string; provider?: string } | void
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

		platformGetUsageStats: builder.query<
			PlatformUsageStats,
			{ start_date?: string; end_date?: string; group_by?: string } | void
		>({
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

		// ── Billing: Admin ─────────────────────────────────────────
		platformAdminCreatePackage: builder.mutation<
			{ code: string; message: string },
			Omit<PlatformPackage, "id" | "created_at">
		>({
			query: (body) => ({ url: "/admin/package/create", method: "POST", body }),
			invalidatesTags: ["Packages"],
		}),

		platformAdminUpdatePackage: builder.mutation<
			{ code: string; message: string },
			Partial<PlatformPackage> & { id: number }
		>({
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
			} | void
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

		// ── Provider Keys (admin) ───────────────────────────────────
		platformAdminListProviderKeys: builder.query<
			{
				items: Array<{
					id: number;
					key_id: string;
					key_name: string;
					base_url?: string;
					weight?: number;
					models?: string[];
				}>;
			},
			string
		>({
			query: (provider) => ({ url: `/provider-keys/${provider}`, method: "GET" }),
			transformResponse: (response: {
				data?: {
					items?: Array<{
						id: number;
						key_id: string;
						key_name: string;
						base_url?: string;
						weight?: number;
						models?: string[];
					}>;
				};
			}) => ({ items: response.data?.items ?? [] }),
			providesTags: ["ProviderKeys"],
		}),

		platformAdminCreateProviderKey: builder.mutation<
			{ code: string; message: string },
			{
				provider: string;
				key_id: string;
				key_value: string;
				base_url?: string;
				weight?: number;
				models?: string[];
			}
		>({
			query: ({ provider, ...body }) => ({ url: `/provider-keys/${provider}`, method: "POST", body }),
			invalidatesTags: ["ProviderKeys"],
		}),

		platformAdminUpdateProviderKey: builder.mutation<
			{ code: string; message: string },
			{
				provider: string;
				key_id: string;
				key_value?: string;
				base_url?: string;
				weight?: number;
				models?: string[];
			}
		>({
			query: ({ provider, key_id, ...body }) => ({
				url: `/provider-keys/${provider}/${key_id}`,
				method: "PUT",
				body,
			}),
			invalidatesTags: ["ProviderKeys"],
		}),

		platformAdminDeleteProviderKey: builder.mutation<
			{ code: string; message: string },
			{ provider: string; key_id: string }
		>({
			query: ({ provider, key_id }) => ({ url: `/provider-keys/${provider}/${key_id}`, method: "DELETE" }),
			invalidatesTags: ["ProviderKeys"],
		}),
	}),
});

// ─── Export Hooks ──────────────────────────────────────────────────

export const {
	// Auth
	usePlatformLoginMutation,
	usePlatformRegisterMutation,
	usePlatformVerifyEmailMutation,
	usePlatformResendVerificationMutation,
	usePlatformAcceptInvitationMutation,
	// Profile
	usePlatformGetProfileQuery,
	usePlatformUpdateProfileMutation,
	usePlatformChangePasswordMutation,
	// Virtual Keys
	usePlatformListVKsQuery,
	usePlatformCreateVKMutation,
	usePlatformUpdateVKMutation,
	usePlatformDeleteVKMutation,
	// Organizations
	usePlatformListOrgsQuery,
	usePlatformGetOrgQuery,
	// Organization Members
	usePlatformListOrgMembersQuery,
	// Organization Teams
	usePlatformListOrgTeamsQuery,
	usePlatformCreateOrgTeamMutation,
	// Teams
	usePlatformListTeamsQuery,
	usePlatformGetTeamQuery,
	usePlatformUpdateTeamMutation,
	// Team Members
	usePlatformListTeamMembersQuery,
	usePlatformInviteTeamMemberMutation,
	usePlatformRemoveTeamMemberMutation,
	usePlatformUpdateTeamMemberMutation,
	// Team VKs
	usePlatformListTeamVKsQuery,
	usePlatformUpdateTeamVKMutation,
	// Admin: Organizations
	usePlatformAdminListOrgsQuery,
	usePlatformAdminCreateOrgMutation,
	usePlatformAdminUpdateOrgMutation,
	usePlatformAdminDeleteOrgMutation,
	// Admin: Users
	usePlatformListUsersQuery,
	usePlatformSetUserRoleMutation,
	// RBAC
	usePlatformListRolesQuery,
	usePlatformCreateRoleMutation,
	usePlatformUpdateRoleMutation,
	usePlatformDeleteRoleMutation,
	// Billing: User
	usePlatformListPackagesQuery,
	usePlatformGetBalanceQuery,
	usePlatformGetBalanceHistoryQuery,
	usePlatformListUserPackagesQuery,
	usePlatformGetTokenUsageQuery,
	usePlatformGetUsageStatsQuery,
	// Billing: Admin
	usePlatformAdminCreatePackageMutation,
	usePlatformAdminUpdatePackageMutation,
	usePlatformAdminDeletePackageMutation,
	usePlatformAdminListModelPricesQuery,
	usePlatformAdminUpsertModelPriceMutation,
	usePlatformAdminDeleteModelPriceMutation,
	usePlatformAdminGetUsageStatsQuery,
	// Provider Keys
	usePlatformAdminListProviderKeysQuery,
	usePlatformAdminCreateProviderKeyMutation,
	usePlatformAdminUpdateProviderKeyMutation,
	usePlatformAdminDeleteProviderKeyMutation,
} = platformApi;
