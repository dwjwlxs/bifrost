/**
 * Platform API — RTK Query endpoints for the multi-user platform.
 * Covers: auth, user profile, virtual keys, organizations, RBAC.
 * Reuses the shared baseApi from the main store.
 */
import { baseApi } from "@/lib/store/apis/baseApi";

// ─── Types ────────────────────────────────────────────────────────

export interface AuthResponse {
	success: boolean;
	data: {
		token: string;
		user: PlatformUserInfo;
	};
	message?: string;
}

export interface PlatformUserInfo {
	id: number;
	email: string;
	username: string;
	nickname: string;
	balance: number;
	is_admin: boolean;
	is_email_verified: boolean;
	role: string;
	customer_id?: string;
	team_id?: string;
	status: string;
	created_at: string;
	updated_at: string;
}

export interface PlatformVirtualKey {
	id: string;
	name: string;
	value: string;
	description?: string;
	is_active: boolean;
	team_id?: string;
	customer_id?: string;
	budget_limit?: number;
	current_usage?: number;
	created_at: string;
	updated_at: string;
}

export interface PlatformCustomer {
	id: string;
	name: string;
	owner_user_id?: number;
	budget_id?: string;
	rate_limit_id?: string;
	teams?: PlatformTeam[];
	virtual_keys?: PlatformVirtualKey[];
}

export interface PlatformTeam {
	id: string;
	name: string;
	customer_id?: string;
	owner_user_id?: number;
	members?: PlatformUserInfo[];
	virtual_keys?: PlatformVirtualKey[];
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

export const platformApi = baseApi.injectEndpoints({
	endpoints: (builder) => ({
		// ── Auth ──
		platformLogin: builder.mutation<
			{ code: string; message: string; data: { access_token: string; refresh_token: string; expires_at: string } },
			{ login: string; password: string }
		>({
			query: (body) => ({
				url: "/platform/login",
				method: "POST",
				body,
			}),
		}),

		platformRegister: builder.mutation<
			{ code: string; message: string; data: { user_id: number; email: string } },
			{ email: string; username: string; password: string; nickname?: string }
		>({
			query: (body) => ({
				url: "/platform/register",
				method: "POST",
				body,
			}),
		}),

		platformGetProfile: builder.query<PlatformUserInfo, void>({
			query: () => ({
				url: "/platform/user/profile",
				method: "GET",
			}),
			providesTags: ["CurrentUser"],
		}),

		platformUpdateProfile: builder.mutation<PlatformUserInfo, Partial<Pick<PlatformUserInfo, "nickname" | "email">>>({
			query: (body) => ({
				url: "/platform/user/profile",
				method: "PUT",
				body,
			}),
			invalidatesTags: ["CurrentUser"],
		}),

		platformVerifyEmail: builder.mutation<
			{ code: string; message: string; data: { access_token: string; refresh_token: string; expires_at: string } },
			{ email: string; code: string }
		>({
			query: (body) => ({
				url: "/platform/verify",
				method: "POST",
				body,
			}),
		}),

		platformResendVerification: builder.mutation<{ code: string; message: string; data: { success: boolean } }, { email: string }>({
			query: (body) => ({
				url: "/auth/resend-verification",
				method: "POST",
				body,
			}),
		}),

		platformChangePassword: builder.mutation<{ message: string }, { old_password: string; new_password: string }>({
			query: (body) => ({
				url: "/platform/user/change-password",
				method: "POST",
				body,
			}),
		}),

		// ── Virtual Keys (user-scoped) ──
		platformListVKs: builder.query<PlatformVirtualKey[], void>({
			query: () => ({
				url: "/platform/user/virtual-keys",
				method: "GET",
			}),
			transformResponse: (response: { data?: { list?: PlatformVirtualKey[] } }) => {
				return response.data?.list ?? [];
			},
			providesTags: ["VirtualKeys"],
		}),

		platformCreateVK: builder.mutation<PlatformVirtualKey, { name: string; description?: string; customer_id?: string; team_id?: string }>({
			query: (body) => ({
				url: "/platform/user/virtual-keys",
				method: "POST",
				body,
			}),
			transformResponse: (response: { data?: PlatformVirtualKey }) => {
				return response.data ?? ({} as PlatformVirtualKey);
			},
			invalidatesTags: ["VirtualKeys"],
		}),

		platformUpdateVK: builder.mutation<
			PlatformVirtualKey,
			{ id: string; data: Partial<Pick<PlatformVirtualKey, "name" | "description" | "is_active">> }
		>({
			query: ({ id, data }) => ({
				url: `/platform/user/virtual-keys/${id}`,
				method: "PUT",
				body: data,
			}),
			transformResponse: (response: { data?: PlatformVirtualKey }) => {
				return response.data ?? ({} as PlatformVirtualKey);
			},
			invalidatesTags: ["VirtualKeys"],
		}),

		platformDeleteVK: builder.mutation<{ message: string }, string>({
			query: (id) => ({
				url: `/platform/user/virtual-keys/${id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["VirtualKeys"],
		}),

		// ── Organizations (Customers) ──
		platformListCustomers: builder.query<PlatformCustomer[], { limit?: number; offset?: number; search?: string } | void>({
			query: (params) => ({
				url: "/platform/governance/customers",
				method: "GET",
				params: {
					...(params?.limit && { limit: params.limit }),
					...(params?.offset !== undefined && { offset: params.offset }),
					...(params?.search && { search: params.search }),
				},
			}),
			transformResponse: (response: { customers?: PlatformCustomer[] }) => {
				return response.customers ?? [];
			},
			providesTags: ["Customers"],
		}),

		platformGetCustomer: builder.query<PlatformCustomer, string>({
			query: (id) => ({
				url: `/platform/governance/customers/${id}`,
				method: "GET",
			}),
			providesTags: (result, error, id) => [{ type: "Customers", id }],
		}),

		platformCreateCustomer: builder.mutation<{ message: string; customer: PlatformCustomer }, { name: string }>({
			query: (body) => ({
				url: "/platform/governance/customers",
				method: "POST",
				body,
			}),
			invalidatesTags: ["Customers"],
		}),

		platformUpdateCustomer: builder.mutation<
			{ message: string; customer: PlatformCustomer },
			{ id: string; data: Partial<Pick<PlatformCustomer, "name">> }
		>({
			query: ({ id, data }) => ({
				url: `/platform/governance/customers/${id}`,
				method: "PUT",
				body: data,
			}),
			invalidatesTags: ["Customers"],
		}),

		platformDeleteCustomer: builder.mutation<{ message: string }, string>({
			query: (id) => ({
				url: `/platform/governance/customers/${id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Customers"],
		}),

		// ── Teams ──
		platformListTeams: builder.query<PlatformTeam[], { customer_id?: string; limit?: number; offset?: number; search?: string } | void>({
			query: (params) => ({
				url: "/platform/governance/teams",
				method: "GET",
				params: {
					...(params?.customer_id && { customer_id: params.customer_id }),
					...(params?.limit && { limit: params.limit }),
					...(params?.offset !== undefined && { offset: params.offset }),
					...(params?.search && { search: params.search }),
				},
			}),
			transformResponse: (response: { teams?: PlatformTeam[] }) => {
				return response.teams ?? [];
			},
			providesTags: ["Teams"],
		}),

		platformCreateTeam: builder.mutation<{ message: string; team: PlatformTeam }, { name: string; customer_id?: string }>({
			query: (body) => ({
				url: "/platform/governance/teams",
				method: "POST",
				body,
			}),
			invalidatesTags: ["Teams"],
		}),

		platformUpdateTeam: builder.mutation<
			{ message: string; team: PlatformTeam },
			{ id: string; data: Partial<Pick<PlatformTeam, "name" | "customer_id">> }
		>({
			query: ({ id, data }) => ({
				url: `/platform/governance/teams/${id}`,
				method: "PUT",
				body: data,
			}),
			invalidatesTags: ["Teams"],
		}),

		platformDeleteTeam: builder.mutation<{ message: string }, string>({
			query: (id) => ({
				url: `/platform/governance/teams/${id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Teams"],
		}),

		// ── Team Members ──
		platformListTeamMembers: builder.query<PlatformUserInfo[], string>({
			query: (teamId) => ({
				url: `/platform/admin/teams/${teamId}/members`,
				method: "GET",
			}),
			providesTags: ["Users"],
		}),

		platformAddTeamMember: builder.mutation<{ message: string }, { team_id: string; user_id: number }>({
			query: ({ team_id, user_id }) => ({
				url: `/platform/admin/teams/${team_id}/members`,
				method: "POST",
				body: { user_id },
			}),
			invalidatesTags: ["Users"],
		}),

		platformRemoveTeamMember: builder.mutation<{ message: string }, { team_id: string; user_id: number }>({
			query: ({ team_id, user_id }) => ({
				url: `/platform/admin/teams/${team_id}/members/${user_id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Users"],
		}),

		// ── RBAC ──
		platformListRoles: builder.query<PlatformCustomRole[], { scope?: string; customer_id?: string; team_id?: string } | void>({
			query: (params) => ({
				url: "/platform/admin/roles",
				method: "GET",
				params: {
					...(params?.scope && { scope: params.scope }),
					...(params?.customer_id && { customer_id: params.customer_id }),
					...(params?.team_id && { team_id: params.team_id }),
				},
			}),
			transformResponse: (response: { data?: { roles?: PlatformCustomRole[] } }) => {
				return response.data?.roles ?? [];
			},
			providesTags: ["Roles"],
		}),

		platformCreateRole: builder.mutation<
			{ message: string; role: PlatformCustomRole },
			{ name: string; scope: string; permissions: string[]; description?: string; customer_id?: string; team_id?: string }
		>({
			query: (body) => ({
				url: "/platform/admin/roles",
				method: "POST",
				body,
			}),
			invalidatesTags: ["Roles"],
		}),

		platformUpdateRole: builder.mutation<
			{ message: string; role: PlatformCustomRole },
			{ id: string; data: Partial<Pick<PlatformCustomRole, "name" | "permissions" | "description">> }
		>({
			query: ({ id, data }) => ({
				url: `/platform/admin/roles/${id}`,
				method: "PUT",
				body: data,
			}),
			invalidatesTags: ["Roles"],
		}),

		platformDeleteRole: builder.mutation<{ message: string }, string>({
			query: (id) => ({
				url: `/platform/admin/roles/${id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Roles"],
		}),

		// ── User Roles Assignment ──
		platformListUserRoles: builder.query<PlatformUserRole[], number>({
			query: (userId) => ({
				url: `/platform/admin/users/${userId}/roles`,
				method: "GET",
			}),
			providesTags: ["Roles"],
		}),

		platformAssignUserRole: builder.mutation<
			{ message: string },
			{ user_id: number; role_id: string; customer_id?: string; team_id?: string }
		>({
			query: ({ user_id, ...body }) => ({
				url: `/platform/admin/users/${user_id}/roles`,
				method: "POST",
				body,
			}),
			invalidatesTags: ["Roles", "Users"],
		}),

		platformRemoveUserRole: builder.mutation<{ message: string }, { user_id: number; role_id: string }>({
			query: ({ user_id, role_id }) => ({
				url: `/platform/admin/users/${user_id}/roles/${role_id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Roles", "Users"],
		}),

		// ── User Management (admin) ──
		platformListUsers: builder.query<
			{ users: PlatformUserInfo[]; total: number },
			{ limit?: number; offset?: number; search?: string } | void
		>({
			query: (params) => ({
				url: "/platform/admin/user/list",
				method: "GET",
				params: {
					...(params?.limit && { limit: params.limit }),
					...(params?.offset !== undefined && { offset: params.offset }),
					...(params?.search && { search: params.search }),
				},
			}),
			transformResponse: (response: { data?: { users?: PlatformUserInfo[]; total?: number } }) => {
				return {
					users: response.data?.users ?? [],
					total: response.data?.total ?? 0,
				};
			},
			providesTags: ["Users"],
		}),

		platformSetUserRole: builder.mutation<{ message: string }, { user_id: number; role: string }>({
			query: ({ user_id, role }) => ({
				url: `/platform/admin/users/${user_id}/role`,
				method: "PUT",
				body: { role },
			}),
			invalidatesTags: ["Users"],
		}),

		platformSetUserTeam: builder.mutation<{ message: string }, { user_id: number; team_id: string }>({
			query: ({ user_id, team_id }) => ({
				url: `/platform/admin/users/${user_id}/team`,
				method: "PUT",
				body: { team_id },
			}),
			invalidatesTags: ["Users"],
		}),

		platformSetUserCustomer: builder.mutation<{ message: string }, { user_id: number; customer_id: string }>({
			query: ({ user_id, customer_id }) => ({
				url: `/platform/admin/users/${user_id}/customer`,
				method: "PUT",
				body: { customer_id },
			}),
			invalidatesTags: ["Users"],
		}),

		// ── Billing: Packages (user-facing) ──
		platformListPackages: builder.query<PlatformPackage[], { is_active?: boolean } | void>({
			query: (params) => ({
				url: "/packages",
				method: "GET",
				params: {
					...(params?.is_active !== undefined && { is_active: params.is_active }),
				},
			}),
			transformResponse: (response: { data?: PlatformPackage[] }) => {
				return response.data ?? [];
			},
			providesTags: ["Packages"],
		}),

		platformGetBalance: builder.query<PlatformBalance, void>({
			query: () => ({
				url: "/balance",
				method: "GET",
			}),
			transformResponse: (response: { data?: PlatformBalance }) => {
				return response.data ?? { balance: 0, package_credits: 0, total_credits: 0, currency: "USD" };
			},
			providesTags: ["Balance"],
		}),

		platformGetBalanceHistory: builder.query<
			{ list: PlatformBalanceHistoryItem[]; total: number },
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
			transformResponse: (response: { data?: { list?: PlatformBalanceHistoryItem[]; total?: number } }) => {
				return {
					list: response.data?.list ?? [],
					total: response.data?.total ?? 0,
				};
			},
			providesTags: ["Balance"],
		}),

		platformListUserPackages: builder.query<PlatformUserPackage[], void>({
			query: () => ({
				url: "/user/packages",
				method: "GET",
			}),
			transformResponse: (response: { data?: PlatformUserPackage[] }) => {
				return response.data ?? [];
			},
			providesTags: ["Packages"],
		}),

		platformGetTokenUsage: builder.query<
			{ list: PlatformTokenUsage[]; total: number },
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
			transformResponse: (response: { data?: { list?: PlatformTokenUsage[]; total?: number } }) => {
				return {
					list: response.data?.list ?? [],
					total: response.data?.total ?? 0,
				};
			},
			providesTags: ["UsageStats"],
		}),

		platformGetUsageStats: builder.query<PlatformUsageStats, { start_date?: string; end_date?: string; group_by?: string } | void>({
			query: (params) => ({
				url: "/usage/stats",
				method: "GET",
				params: {
					...(params?.start_date && { start_date: params.start_date }),
					...(params?.end_date && { end_date: params.end_date }),
					...(params?.group_by && { group_by: params.group_by }),
				},
			}),
			transformResponse: (response: { data?: PlatformUsageStats }) => {
				return (
					response.data ?? {
						start_date: "",
						end_date: "",
						group_by: "day",
						summary: { total_calls: 0, total_tokens: 0, total_credits: 0 },
						details: [],
					}
				);
			},
			providesTags: ["UsageStats"],
		}),

		// ── Billing: Admin package management ──
		platformAdminCreatePackage: builder.mutation<{ message: string }, Omit<PlatformPackage, "id" | "created_at">>({
			query: (body) => ({
				url: "/admin/package/create",
				method: "POST",
				body,
			}),
			invalidatesTags: ["Packages"],
		}),

		platformAdminUpdatePackage: builder.mutation<{ message: string }, Partial<PlatformPackage> & { id: number }>({
			query: ({ id, ...body }) => ({
				url: "/admin/package/update",
				method: "PUT",
				body: { id, ...body },
			}),
			invalidatesTags: ["Packages"],
		}),

		platformAdminDeletePackage: builder.mutation<{ message: string }, number>({
			query: (id) => ({
				url: `/admin/package/delete/${id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Packages"],
		}),

		// ── Billing: Admin model price management ──
		platformAdminListModelPrices: builder.query<PlatformModelPrice[], void>({
			query: () => ({
				url: "/admin/model-prices",
				method: "GET",
			}),
			transformResponse: (response: { data?: PlatformModelPrice[] }) => {
				return response.data ?? [];
			},
			providesTags: ["ModelPrices"],
		}),

		platformAdminUpsertModelPrice: builder.mutation<
			{ message: string },
			{ model: string; provider: string; input_token_price: number; output_token_price: number }
		>({
			query: (body) => ({
				url: "/admin/model-prices",
				method: "POST",
				body,
			}),
			invalidatesTags: ["ModelPrices"],
		}),

		platformAdminDeleteModelPrice: builder.mutation<{ message: string }, number>({
			query: (id) => ({
				url: `/admin/model-prices/${id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["ModelPrices"],
		}),

		// ── Billing: Admin usage stats (platform-wide) ──
		platformAdminGetUsageStats: builder.query<
			PlatformUsageStats,
			{ start_date?: string; end_date?: string; group_by?: string; user_id?: number; customer_id?: string; team_id?: string } | void
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
			transformResponse: (response: { data?: PlatformUsageStats }) => {
				return (
					response.data ?? {
						start_date: "",
						end_date: "",
						group_by: "day",
						summary: { total_calls: 0, total_tokens: 0, total_credits: 0 },
						details: [],
					}
				);
			},
			providesTags: ["UsageStats"],
		}),

		// ── Owner-scoped management ──
		platformOwnerSetUserRole: builder.mutation<{ message: string }, { user_id: number; role: string }>({
			query: ({ user_id, role }) => ({
				url: `/platform/owner/users/${user_id}/role`,
				method: "PUT",
				body: { target_user_id: user_id, role },
			}),
			invalidatesTags: ["Users"],
		}),

		platformOwnerSetUserTeam: builder.mutation<{ message: string }, { user_id: number; team_id: string }>({
			query: ({ user_id, team_id }) => ({
				url: `/platform/owner/users/${user_id}/team`,
				method: "PUT",
				body: { target_user_id: user_id, team_id },
			}),
			invalidatesTags: ["Users", "Teams"],
		}),

		platformOwnerSetVKBudget: builder.mutation<{ message: string }, { id: string; max_limit: number; reset_duration?: string }>({
			query: ({ id, ...body }) => ({
				url: `/platform/owner/virtual-keys/${id}/budget`,
				method: "PUT",
				body,
			}),
			invalidatesTags: ["VirtualKeys", "Budgets"],
		}),

		platformOwnerSetTeamBudget: builder.mutation<{ message: string }, { id: string; max_limit: number; reset_duration?: string }>({
			query: ({ id, ...body }) => ({
				url: `/platform/owner/teams/${id}/budget`,
				method: "PUT",
				body,
			}),
			invalidatesTags: ["Teams", "Budgets"],
		}),

		// ── Provider key management (admin) ──
		platformAdminListProviderKeys: builder.query<
			{ keys: Array<{ id: number; key_id: string; key_name: string; base_url?: string; weight?: number; models?: string[] }> },
			string
		>({
			query: (provider) => ({
				url: `/provider-keys/${provider}`,
				method: "GET",
			}),
			providesTags: ["ProviderKeys"],
		}),

		platformAdminCreateProviderKey: builder.mutation<
			{ message: string },
			{ provider: string; key_id: string; key_value: string; base_url?: string; weight?: number; models?: string[] }
		>({
			query: ({ provider, ...body }) => ({
				url: `/provider-keys/${provider}`,
				method: "POST",
				body,
			}),
			invalidatesTags: ["ProviderKeys"],
		}),

		platformAdminUpdateProviderKey: builder.mutation<
			{ message: string },
			{ provider: string; key_id: string; key_value?: string; base_url?: string; weight?: number; models?: string[] }
		>({
			query: ({ provider, key_id, ...body }) => ({
				url: `/provider-keys/${provider}/${key_id}`,
				method: "PUT",
				body,
			}),
			invalidatesTags: ["ProviderKeys"],
		}),

		platformAdminDeleteProviderKey: builder.mutation<{ message: string }, { provider: string; key_id: string }>({
			query: ({ provider, key_id }) => ({
				url: `/provider-keys/${provider}/${key_id}`,
				method: "DELETE",
			}),
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
	usePlatformGetProfileQuery,
	usePlatformUpdateProfileMutation,
	usePlatformChangePasswordMutation,
	// Virtual Keys
	usePlatformListVKsQuery,
	usePlatformCreateVKMutation,
	usePlatformUpdateVKMutation,
	usePlatformDeleteVKMutation,
	// Customers
	usePlatformListCustomersQuery,
	usePlatformGetCustomerQuery,
	usePlatformCreateCustomerMutation,
	usePlatformUpdateCustomerMutation,
	usePlatformDeleteCustomerMutation,
	// Teams
	usePlatformListTeamsQuery,
	usePlatformCreateTeamMutation,
	usePlatformUpdateTeamMutation,
	usePlatformDeleteTeamMutation,
	// Team Members
	usePlatformListTeamMembersQuery,
	usePlatformAddTeamMemberMutation,
	usePlatformRemoveTeamMemberMutation,
	// RBAC
	usePlatformListRolesQuery,
	usePlatformCreateRoleMutation,
	usePlatformUpdateRoleMutation,
	usePlatformDeleteRoleMutation,
	// User Roles
	usePlatformListUserRolesQuery,
	usePlatformAssignUserRoleMutation,
	usePlatformRemoveUserRoleMutation,
	// User Management
	usePlatformListUsersQuery,
	usePlatformSetUserRoleMutation,
	usePlatformSetUserTeamMutation,
	usePlatformSetUserCustomerMutation,
	// Billing: User-facing
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
	// Owner-scoped management
	usePlatformOwnerSetUserRoleMutation,
	usePlatformOwnerSetUserTeamMutation,
	usePlatformOwnerSetVKBudgetMutation,
	usePlatformOwnerSetTeamBudgetMutation,
	// Provider key management (admin)
	usePlatformAdminListProviderKeysQuery,
	usePlatformAdminCreateProviderKeyMutation,
	usePlatformAdminUpdateProviderKeyMutation,
	usePlatformAdminDeleteProviderKeyMutation,
} = platformApi;