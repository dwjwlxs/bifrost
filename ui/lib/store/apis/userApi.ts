import { baseApi } from "./baseApi";
import type { User } from "@/lib/types/governance";

export interface GetCurrentUserResponse {
	success: boolean;
	data: User;
}

export interface GetCurrentUserVirtualKeysResponse {
	virtual_keys: any[];
	total: number;
}

export const userApi = baseApi.injectEndpoints({
	endpoints: (builder) => ({
		// Get current user profile
		getCurrentUser: builder.query<User, void>({
			query: () => ({
				url: "/api/user/profile",
				method: "GET",
			}),
			transformResponse: (response: GetCurrentUserResponse) => response.data,
			providesTags: ["CurrentUser"],
		}),

		// Get current user's virtual keys
		getCurrentUserVirtualKeys: builder.query<GetCurrentUserVirtualKeysResponse, void>({
			query: () => ({
				url: "/api/user/virtual-keys",
				method: "GET",
			}),
			providesTags: ["VirtualKeys"],
		}),
	}),
});

export const { useGetCurrentUserQuery, useGetCurrentUserVirtualKeysQuery } = userApi;