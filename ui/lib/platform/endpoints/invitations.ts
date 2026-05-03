/**
 * Invitation endpoints — GET invitation details, POST accept invitation.
 */
import { platformBaseApi } from "../platformBaseApi";
import type { PlatformInvitationDetails } from "../types";

const invitationsApi = platformBaseApi.injectEndpoints({
	endpoints: (builder) => ({
		/** Get invitation details by token (public, no auth required) */
		platformGetInvitation: builder.query<PlatformInvitationDetails, string>({
			query: (token) => ({ url: `/platform/invitations/${token}`, method: "GET" }),
			transformResponse: (response: { data?: PlatformInvitationDetails }) =>
				response.data ?? ({} as PlatformInvitationDetails),
		}),

		/** Accept an invitation (requires auth — email verified server-side) */
		platformAcceptInvitation: builder.mutation<{ code: string; message: string }, string>({
			query: (token) => ({
				url: `/platform/invitations/${token}/accept`,
				method: "POST",
			}),
			transformResponse: (response: { code?: string; message?: string }) => ({
				code: response.code ?? "",
				message: response.message ?? "",
			}),
		}),
	}),
});

export const {
	usePlatformGetInvitationQuery,
	usePlatformAcceptInvitationMutation,
} = invitationsApi;
