/**
 * Provider endpoints — admin only.
 */
import { platformBaseApi } from "../platformBaseApi";

/** Provider key shape returned by list endpoint — mirrors schemas.Key Redacted() */
export interface ProviderKeyItem {
	id: string;
	name: string;
	weight: number;
	models?: string[];
	blacklisted_models?: string[];
	aliases?: Record<string, string>;
	enabled?: boolean;
	use_for_batch_api?: boolean;
	config_hash?: string;
	status?: string;
	description?: string;
	/** EnvVar object — value is redacted (e.g. "sk-****...abcd"), env_var/from_env preserved */
	value?: {
		value?: string;
		env_var?: string;
		from_env?: boolean;
	};
}

/** Provider config response */
export interface ProviderResponse {
	name: string;
	network_config: {
		base_url?: string;
		timeout?: number;
		max_retries?: number;
		connect_timeout?: number;
		read_timeout?: number;
		idle_conn_timeout?: number;
	};
	concurrency_and_buffer_size: {
		concurrency: number;
		buffer_size: number;
	};
	proxy_config?: {
		url?: string;
		username?: string;
		password?: string;
	};
	send_back_raw_request: boolean;
	send_back_raw_response: boolean;
	store_raw_request_response: boolean;
	custom_provider_config?: {
		provider_type?: string;
		base_provider_type?: string;
		is_key_less?: boolean;
		allowed_models?: string[];
		blocked_models?: string[];
		[key: string]: unknown;
	};
	openai_config?: {
		chat_completion_params?: Record<string, unknown>;
		predefined_headers?: Record<string, string>;
	};
	provider_status: string;
}

const ADMIN_PROVIDERS_PATH = "/platform/admin/providers";

const providersApi = platformBaseApi.injectEndpoints({
	endpoints: (builder) => ({
		// List all providers
		platformAdminListProviders: builder.query<{ providers: ProviderResponse[]; total: number }, void>({
			query: () => ({ url: `${ADMIN_PROVIDERS_PATH}`, method: "GET" }),
			transformResponse: (response: { providers?: ProviderResponse[]; total?: number }) => {
				return { providers: response.providers ?? [], total: response.total ?? 0 };
			},
			providesTags: ["Providers"],
		}),

		// Update provider config
		platformAdminUpdateProvider: builder.mutation<
			{ code: string; message: string; data?: { name: string } },
			{ provider: string; body: Partial<ProviderResponse> }
		>({
			query: ({ provider, body }) => ({
				url: `${ADMIN_PROVIDERS_PATH}/${provider}`,
				method: "PUT",
				body,
			}),
			invalidatesTags: ["Providers"],
		}),

		// Create provider
		platformAdminCreateProvider: builder.mutation<
			{ code: string; message: string; data?: ProviderResponse },
			{
				provider: string;
				custom_provider_config?: {
					base_provider_type?: string;
					is_key_less?: boolean;
				};
				network_config?: {
					base_url?: string;
				};
			}
		>({
			query: (body) => ({
				url: `${ADMIN_PROVIDERS_PATH}`,
				method: "POST",
				body,
			}),
			invalidatesTags: ["Providers"],
		}),

		// Delete provider
		platformAdminDeleteProvider: builder.mutation<{ code: string; message: string }, string>({
			query: (provider) => ({
				url: `${ADMIN_PROVIDERS_PATH}/${provider}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Providers"],
		}),

		// List provider keys
		platformAdminListProviderKeys: builder.query<{ items: ProviderKeyItem[]; total: number }, string>({
			query: (provider) => ({ url: `${ADMIN_PROVIDERS_PATH}/${provider}/keys`, method: "GET" }),
			transformResponse: (response: { keys?: ProviderKeyItem[]; total?: number }) => {
				return { items: response.keys ?? [], total: response.total ?? 0 };
			},
			providesTags: ["ProviderKeys"],
		}),

		// Create provider key
		platformAdminCreateProviderKey: builder.mutation<
			{ code: string; message: string },
			{
				provider: string;
				id?: string;
				name: string;
				/** EnvVar object — send { value: "sk-..." } for plain key or { env_var: "KEY", from_env: true } for env var */
				value?: { value?: string; env_var?: string; from_env?: boolean };
				weight?: number;
				models?: string[];
				blacklisted_models?: string[];
				enabled?: boolean;
				use_for_batch_api?: boolean;
				description?: string;
			}
		>({
			query: ({ provider, ...body }) => ({ url: `${ADMIN_PROVIDERS_PATH}/${provider}/keys`, method: "POST", body }),
			invalidatesTags: ["ProviderKeys"],
		}),

		// Update provider key
		platformAdminUpdateProviderKey: builder.mutation<
			{ code: string; message: string },
			{
				provider: string;
				id: string;
				name?: string;
				/** EnvVar object — send { value: "sk-..." } for plain key or { env_var: "KEY", from_env: true } for env var */
				value?: { value?: string; env_var?: string; from_env?: boolean };
				weight?: number;
				models?: string[];
				blacklisted_models?: string[];
				enabled?: boolean;
				use_for_batch_api?: boolean;
				description?: string;
			}
		>({
			query: ({ provider, id, ...body }) => ({
				url: `${ADMIN_PROVIDERS_PATH}/${provider}/keys/${id}`,
				method: "PUT",
				body,
			}),
			invalidatesTags: ["ProviderKeys"],
		}),

		// Delete provider key
		platformAdminDeleteProviderKey: builder.mutation<{ code: string; message: string }, { provider: string; id: string }>({
			query: ({ provider, id }) => ({ url: `${ADMIN_PROVIDERS_PATH}/${provider}/keys/${id}`, method: "DELETE" }),
			invalidatesTags: ["ProviderKeys"],
		}),

		// List provider models
		platformAdminListProviderModels: builder.query<{ items: { name: string; provider: string }[]; total: number }, string>({
			query: (provider) => ({ url: `${ADMIN_PROVIDERS_PATH}/${provider}/models`, method: "GET" }),
			transformResponse: (response: { models?: { name: string; provider: string }[]; total?: number }) => {
				return { items: response.models ?? [], total: response.total ?? 0 };
			},
			providesTags: ["ProviderModels"],
		}),

		// Add provider model
		platformAdminAddProviderModel: builder.mutation<
			{ code: string; message: string; data?: { model: string } },
			{ provider: string; model: string }
		>({
			query: ({ provider, model }) => ({
				url: `${ADMIN_PROVIDERS_PATH}/${provider}/models`,
				method: "POST",
				body: { model },
			}),
			invalidatesTags: ["ProviderModels"],
		}),
	}),
});

export const {
	usePlatformAdminListProvidersQuery,
	usePlatformAdminUpdateProviderMutation,
	usePlatformAdminCreateProviderMutation,
	usePlatformAdminDeleteProviderMutation,
	usePlatformAdminListProviderKeysQuery,
	usePlatformAdminCreateProviderKeyMutation,
	usePlatformAdminUpdateProviderKeyMutation,
	usePlatformAdminDeleteProviderKeyMutation,
	usePlatformAdminListProviderModelsQuery,
	usePlatformAdminAddProviderModelMutation,
} = providersApi;