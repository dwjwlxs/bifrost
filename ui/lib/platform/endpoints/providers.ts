/**
 * Provider key endpoints — admin only.
 */
import { platformBaseApi } from "../platformBaseApi";

/** Provider key shape returned by list endpoint */
export interface ProviderKeyItem {
	id: number;
	key_id: string;
	key_name: string;
	base_url?: string;
	weight?: number;
	models?: string[];
}

const providersApi = platformBaseApi.injectEndpoints({
	endpoints: (builder) => ({
		platformAdminListProviderKeys: builder.query<{ items: ProviderKeyItem[] }, string>({
			query: (provider) => ({ url: `/provider-keys/${provider}`, method: "GET" }),
			transformResponse: (response: { data?: { items?: ProviderKeyItem[] } }) => ({ items: response.data?.items ?? [] }),
			providesTags: ["ProviderKeys"],
		}),

		platformAdminCreateProviderKey: builder.mutation<
			{ code: string; message: string },
			{
				provider: string;
				key_id: string;
				key_value: string;
				base_url?: string;
				weight?: number;
				models?: string[];
			}
		>({
			query: ({ provider, ...body }) => ({ url: `/provider-keys/${provider}`, method: "POST", body }),
			invalidatesTags: ["ProviderKeys"],
		}),

		platformAdminUpdateProviderKey: builder.mutation<
			{ code: string; message: string },
			{
				provider: string;
				key_id: string;
				key_value?: string;
				base_url?: string;
				weight?: number;
				models?: string[];
			}
		>({
			query: ({ provider, key_id, ...body }) => ({
				url: `/provider-keys/${provider}/${key_id}`,
				method: "PUT",
				body,
			}),
			invalidatesTags: ["ProviderKeys"],
		}),

		platformAdminDeleteProviderKey: builder.mutation<{ code: string; message: string }, { provider: string; key_id: string }>({
			query: ({ provider, key_id }) => ({ url: `/provider-keys/${provider}/${key_id}`, method: "DELETE" }),
			invalidatesTags: ["ProviderKeys"],
		}),
	}),
});

export const {
	usePlatformAdminListProviderKeysQuery,
	usePlatformAdminCreateProviderKeyMutation,
	usePlatformAdminUpdateProviderKeyMutation,
	usePlatformAdminDeleteProviderKeyMutation,
} = providersApi;
