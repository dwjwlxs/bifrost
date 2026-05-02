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

		/** List members of an organization (org_admin only) */
		platformListOrgMembers: builder.query<PlatformOrgMember[], string>({
			query: (orgId) => ({ url: `/platform/orgs/${orgId}/members`, method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformOrgMember[] } }) => response.data?.items ?? [],
			providesTags: ["Users"],
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
	usePlatformListOrgMembersQuery,
	usePlatformListOrgTeamsQuery,
	usePlatformCreateOrgTeamMutation,
} = organizationsApi;
