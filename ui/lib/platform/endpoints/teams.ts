/**
 * Team endpoints — CRUD, members, invitations.
 */
import { platformBaseApi } from "../platformBaseApi";
import type { PlatformTeam, PlatformTeamMember, PlatformInvitation } from "./types";

const teamsApi = platformBaseApi.injectEndpoints({
	endpoints: (builder) => ({
		/** List teams the current user belongs to */
		platformListTeams: builder.query<PlatformTeam[], void>({
			query: () => ({ url: "/platform/teams", method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformTeam[] } }) => response.data?.items ?? [],
			providesTags: ["Teams"],
		}),

		/** Get team details (any team the user belongs to) */
		platformGetTeam: builder.query<PlatformTeam, string>({
			query: (id) => ({ url: `/platform/teams/${id}`, method: "GET" }),
			providesTags: (result, error, id) => [{ type: "Teams", id }],
		}),

		/** Update team info / budget (team_admin only) */
		platformUpdateTeam: builder.mutation<PlatformTeam, { id: string; name?: string; budget_limit?: number; budget_reset_at?: string }>({
			query: ({ id, ...body }) => ({ url: `/platform/teams/${id}`, method: "PUT", body }),
			transformResponse: (response: { data?: PlatformTeam }) => response.data ?? ({} as PlatformTeam),
			invalidatesTags: ["Teams"],
		}),

		/** List members of a team (team_admin or team_member) */
		platformListTeamMembers: builder.query<PlatformTeamMember[], string>({
			query: (teamId) => ({ url: `/platform/teams/${teamId}/members`, method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformTeamMember[] } }) => response.data?.items ?? [],
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
		platformRemoveTeamMember: builder.mutation<{ code: string; message: string }, { team_id: string; user_id: string }>({
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

		/** Delete a team (org_admin only) */
		platformDeleteTeam: builder.mutation<{ code: string; message: string }, string>({
			query: (teamId) => ({ url: `/platform/teams/${teamId}`, method: "DELETE" }),
			invalidatesTags: ["Teams"],
		}),
	}),
});

export const {
	usePlatformListTeamsQuery,
	usePlatformGetTeamQuery,
	usePlatformUpdateTeamMutation,
	usePlatformDeleteTeamMutation,
	usePlatformListTeamMembersQuery,
	usePlatformInviteTeamMemberMutation,
	usePlatformRemoveTeamMemberMutation,
	usePlatformUpdateTeamMemberMutation,
} = teamsApi;
