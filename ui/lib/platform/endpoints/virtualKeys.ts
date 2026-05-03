/**
 * Virtual key endpoints — user-scoped and team-scoped.
 */
import { platformBaseApi } from "../platformBaseApi";
import type { PlatformVirtualKey } from "./types";

const virtualKeysApi = platformBaseApi.injectEndpoints({
	endpoints: (builder) => ({
		/** List only the current user's VKs */
		platformListVKs: builder.query<PlatformVirtualKey[], void>({
			query: () => ({ url: "/platform/virtual-keys", method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformVirtualKey[] } }) => response.data?.items ?? [],
			providesTags: ["VirtualKeys"],
		}),

		/** Create a new VK for the current user (or a team member if team_admin). */
		platformCreateVK: builder.mutation<
			PlatformVirtualKey,
			{
				name: string;
				description?: string;
				user_id?: string;
				team_id?: string;
				budget_limit?: number;
				budget_reset_duration?: string;
			}
		>({
			query: (body) => ({ url: "/platform/virtual-keys", method: "POST", body }),
			transformResponse: (response: { data?: PlatformVirtualKey }) => response.data ?? ({} as PlatformVirtualKey),
			invalidatesTags: ["VirtualKeys"],
		}),

		/** Update one of the current user's VKs */
		platformUpdateVK: builder.mutation<
			PlatformVirtualKey,
			{
				id: string;
				data: {
					name?: string;
					description?: string;
					is_active?: boolean;
					budget_limit?: number;
					budget_reset_duration?: string;
				};
			}
		>({
			query: ({ id, data }) => ({ url: `/platform/virtual-keys/${id}`, method: "PUT", body: data }),
			transformResponse: (response: { data?: PlatformVirtualKey }) => response.data ?? ({} as PlatformVirtualKey),
			invalidatesTags: ["VirtualKeys"],
		}),

		/** Delete one of the current user's VKs */
		platformDeleteVK: builder.mutation<{ code: string; message: string }, string>({
			query: (id) => ({ url: `/platform/virtual-keys/${id}`, method: "DELETE" }),
			invalidatesTags: ["VirtualKeys"],
		}),

		/** List VKs within a team (team_admin only) */
		platformListTeamVKs: builder.query<PlatformVirtualKey[], string>({
			query: (teamId) => ({ url: `/platform/teams/${teamId}/virtual-keys`, method: "GET" }),
			transformResponse: (response: { data?: { items?: PlatformVirtualKey[] } }) => response.data?.items ?? [],
			providesTags: ["VirtualKeys"],
		}),

		/** Update a VK budget within a team (team_admin only) */
		platformUpdateTeamVK: builder.mutation<
			PlatformVirtualKey,
			{
				team_id: string;
				vk_id: string;
				budget_limit?: number;
				budget_reset_duration?: string;
				name?: string;
				description?: string;
				is_active?: boolean;
			}
		>({
			query: ({ team_id, vk_id, ...body }) => ({
				url: `/platform/teams/${team_id}/virtual-keys/${vk_id}`,
				method: "PUT",
				body,
			}),
			transformResponse: (response: { data?: PlatformVirtualKey }) => response.data ?? ({} as PlatformVirtualKey),
			invalidatesTags: ["VirtualKeys"],
		}),
	}),
});

export const {
	usePlatformListVKsQuery,
	usePlatformCreateVKMutation,
	usePlatformUpdateVKMutation,
	usePlatformDeleteVKMutation,
	usePlatformListTeamVKsQuery,
	usePlatformUpdateTeamVKMutation,
} = virtualKeysApi;
