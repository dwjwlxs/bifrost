/**
 * Auth endpoints — public (no auth required).
 */
import { platformBaseApi } from "../platformBaseApi";

const authApi = platformBaseApi.injectEndpoints({
	endpoints: (builder) => ({
		platformLogin: builder.mutation<
			{ code: string; message: string; data: { access_token: string; refresh_token: string; expires_at: string } },
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
			{ code: string; message: string; data: { access_token: string; refresh_token: string; expires_at: string } },
			{ email: string; code: string }
		>({
			query: (body) => ({ url: "/platform/verify", method: "POST", body }),
		}),

		platformResendVerification: builder.mutation<{ code: string; message: string; data: { success: boolean } }, { email: string }>({
			query: (body) => ({ url: "/auth/resend-verification", method: "POST", body }),
		}),
	}),
});

export const {
	usePlatformLoginMutation,
	usePlatformRegisterMutation,
	usePlatformVerifyEmailMutation,
	usePlatformResendVerificationMutation,
} = authApi;