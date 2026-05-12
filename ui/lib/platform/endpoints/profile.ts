/**
 * User profile endpoints.
 */
import { platformBaseApi } from "../platformBaseApi";
import type { PlatformUserInfo } from "./types";

const profileApi = platformBaseApi.injectEndpoints({
	endpoints: (builder) => ({
		platformGetProfile: builder.query<PlatformUserInfo, void>({
			query: () => ({ url: "/platform/profile", method: "GET" }),
			providesTags: ["CurrentUser"],
		}),

		platformUpdateProfile: builder.mutation<PlatformUserInfo, Partial<Pick<PlatformUserInfo, "nickname" | "email">>>({
			query: (body) => ({ url: "/platform/profile", method: "PUT", body }),
			invalidatesTags: ["CurrentUser"],
		}),

		platformChangePassword: builder.mutation<{ code: string; message: string }, { old_password: string; new_password: string }>({
			query: (body) => ({ url: "/platform/profile/password", method: "POST", body }),
		}),
	}),
});

export const { usePlatformGetProfileQuery, usePlatformUpdateProfileMutation, usePlatformChangePasswordMutation } = profileApi;