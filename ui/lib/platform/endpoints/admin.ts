/**
 * Admin endpoints — org CRUD, user management, RBAC.
 */
import { platformBaseApi } from "../platformBaseApi";
import type { PlatformOrg, PlatformUserInfo, PlatformCustomRole } from "./types";

const adminApi = platformBaseApi.injectEndpoints({
	endpoints: (builder) => ({
		// ── Admin: Organizations ────────────────────────────────────
		/** List all organizations (system admin only) */
		platformAdminListOrgs: builder.query<{ items: PlatformOrg[]; total: number }, { limit?: number; offset?: number; search?: string }>({
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
		platformAdminCreateOrg: builder.mutation<{ code: string; message: string; data?: PlatformOrg }, { name: string; admin_email?: string }>(
			{
				query: (body) => ({ url: "/platform/admin/orgs", method: "POST", body }),
				invalidatesTags: ["Orgs"],
			},
		),

		/** Update an organization (system admin only) */
		platformAdminUpdateOrg: builder.mutation<
			{ code: string; message: string; data?: PlatformOrg },
			{ id: string; name?: string; owner_user_id?: string }
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
		platformListUsers: builder.query<{ items: PlatformUserInfo[]; total: number }, { limit?: number; offset?: number; search?: string }>({
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

		platformSetUserRole: builder.mutation<{ code: string; message: string }, { user_id: string; role: string }>({
			query: ({ user_id, ...body }) => ({
				url: `/platform/admin/users/${user_id}/role`,
				method: "PUT",
				body,
			}),
			invalidatesTags: ["Users"],
		}),

		platformSetUserAdmin: builder.mutation<
			{ code: string; message: string; data?: { id: string; is_admin: boolean } },
			{ user_id: string; is_admin: boolean }
		>({
			query: ({ user_id, ...body }) => ({
				url: `/platform/admin/users/${user_id}/admin`,
				method: "PUT",
				body,
			}),
			invalidatesTags: ["Users"],
		}),

		platformSetUserStatus: builder.mutation<
			{ code: string; message: string; data?: { id: string; status: string; updated_at: string } },
			{ user_id: string; status: "active" | "suspended" | "pending_verification" }
		>({
			query: ({ user_id, ...body }) => ({
				url: `/platform/admin/users/${user_id}/status`,
				method: "PUT",
				body,
			}),
			invalidatesTags: ["Users"],
		}),

		// ── RBAC ───────────────────────────────────────────────────
		platformListRoles: builder.query<PlatformCustomRole[], void>({
			query: () => ({ url: "/platform/admin/roles", method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformCustomRole[] } }) => response.data?.items ?? [],
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
	}),
});

export const {
	usePlatformAdminListOrgsQuery,
	usePlatformAdminCreateOrgMutation,
	usePlatformAdminUpdateOrgMutation,
	usePlatformAdminDeleteOrgMutation,
	usePlatformListUsersQuery,
	usePlatformSetUserRoleMutation,
	usePlatformSetUserAdminMutation,
	usePlatformSetUserStatusMutation,
	usePlatformListRolesQuery,
	usePlatformCreateRoleMutation,
	usePlatformUpdateRoleMutation,
	usePlatformDeleteRoleMutation,
} = adminApi;