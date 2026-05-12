/**
 * Organization endpoints.
 */
import { platformBaseApi } from "../platformBaseApi";
import type { PlatformOrg, PlatformOrgMember, PlatformTeam } from "./types";

const organizationsApi = platformBaseApi.injectEndpoints({
	endpoints: (builder) => ({
		/** List the current user's organizations */
		platformListOrgs: builder.query<PlatformOrg[], void>({
			query: () => ({ url: "/platform/orgs", method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformOrg[] } }) => response.data?.items ?? [],
			providesTags: ["Orgs"],
		}),

		/** Get organization details (any org the user belongs to) */
		platformGetOrg: builder.query<PlatformOrg, string>({
			query: (id) => ({ url: `/platform/orgs/${id}`, method: "GET" }),
			providesTags: (result, error, id) => [{ type: "Orgs", id }],
		}),

		/** Update organization (org_admin only) */
		platformUpdateOrg: builder.mutation<PlatformOrg, { id: string; name?: string }>({
			query: ({ id, ...body }) => ({ url: `/platform/orgs/${id}`, method: "PUT", body }),
			invalidatesTags: ["Orgs"],
		}),

		/** List members of an organization (org_admin only) */
		platformListOrgMembers: builder.query<PlatformOrgMember[], string>({
			query: (orgId) => ({ url: `/platform/orgs/${orgId}/members`, method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformOrgMember[] } }) => response.data?.items ?? [],
			providesTags: ["Users"],
		}),

		/** Invite a member to an organization (org_admin only) */
		platformInviteOrgMember: builder.mutation<
			{ code: string; message: string },
			{ org_id: string; email: string; role?: "admin" | "member" }
		>({
			query: ({ org_id, ...body }) => ({
				url: `/platform/orgs/${org_id}/members/invite`,
				method: "POST",
				body,
			}),
			invalidatesTags: ["Users"],
		}),

		/** Remove a member from an organization (org_admin only) */
		platformRemoveOrgMember: builder.mutation<{ code: string; message: string }, { org_id: string; user_id: string }>({
			query: ({ org_id, user_id }) => ({
				url: `/platform/orgs/${org_id}/members/${user_id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Users"],
		}),

		/** Update a member's role in an organization (org_admin only) */
		platformUpdateOrgMember: builder.mutation<
			{ code: string; message: string },
			{ org_id: string; user_id: string; role: "admin" | "member" }
		>({
			query: ({ org_id, user_id, role }) => ({
				url: `/platform/orgs/${org_id}/members/${user_id}`,
				method: "PUT",
				body: { role },
			}),
			invalidatesTags: ["Users"],
		}),

		/** List teams within an organization (org_admin only) */
		platformListOrgTeams: builder.query<PlatformTeam[], string>({
			query: (orgId) => ({ url: `/platform/orgs/${orgId}/teams`, method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformTeam[] } }) => response.data?.items ?? [],
			providesTags: ["Teams"],
		}),

		/** Create a team within an organization (org_admin only) */
		platformCreateOrgTeam: builder.mutation<PlatformTeam, { org_id: string; name: string }>({
			query: ({ org_id, name }) => ({
				url: `/platform/orgs/${org_id}/teams`,
				method: "POST",
				body: { name },
			}),
			transformResponse: (response: { data?: PlatformTeam }) => response.data ?? ({} as PlatformTeam),
			invalidatesTags: ["Teams"],
		}),
	}),
});

export const {
	usePlatformListOrgsQuery,
	usePlatformGetOrgQuery,
	usePlatformUpdateOrgMutation,
	usePlatformListOrgMembersQuery,
	usePlatformInviteOrgMemberMutation,
	usePlatformRemoveOrgMemberMutation,
	usePlatformUpdateOrgMemberMutation,
	usePlatformListOrgTeamsQuery,
	usePlatformCreateOrgTeamMutation,
} = organizationsApi;