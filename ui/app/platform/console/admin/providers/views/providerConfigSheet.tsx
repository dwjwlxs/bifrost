import { useEffect } from "react";
import type { ProviderResponse } from "@/lib/platform/platformApi";
import { usePlatformAdminUpdateProviderMutation } from "@/lib/platform/platformApi";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { SubmitHandler } from "react-hook-form";
import { AllowedRequestsFields } from "@/app/workspace/providers/fragments/allowedRequestsFields";
import { BaseProvider } from "@/lib/types/config";
import { allowedRequestsSchema } from "@/lib/types/schemas";
import { cleanPathOverrides } from "@/lib/utils/validation";
import { Globe, Gauge, Shield, Network } from "lucide-react";

interface ProviderConfigSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	providerName: string;
	provider: ProviderResponse;
}

// Schema for platform admin provider config form.
// allowed_requests is at root level to ensure React Hook Form registers nested paths
// like "allowed_requests.chat_completion" (required by AllowedRequestsFields).
const platformAdminProviderConfigSchema = z.object({
	// API Structure section
	base_provider_type: z.string(),
	is_key_less: z.boolean().optional(),
	allowed_requests: allowedRequestsSchema.optional(),
	request_path_overrides: z.record(z.string(), z.string().optional()).optional(),

	// Network section (flat, restructured to network_config in onSubmit)
	base_url: z.string().optional(),
	timeout: z.number(),
	max_retries: z.number(),
	connect_timeout: z.number(),
	read_timeout: z.number(),
	idle_conn_timeout: z.number(),

	// Performance section
	concurrency: z.number(),
	buffer_size: z.number(),

	// Proxy section
	proxy_url: z.string().optional(),
	proxy_username: z.string().optional(),
	proxy_password: z.string().optional(),
});

type ConfigForm = z.infer<typeof platformAdminProviderConfigSchema>;

function toDefaultForm(provider: ProviderResponse): ConfigForm {
	const nc = provider.network_config;
	const cc = provider.concurrency_and_buffer_size;
	const pc = provider.proxy_config;
	const ccConfig = provider.custom_provider_config ?? {};
	const ar = ccConfig.allowed_requests as Record<string, boolean> | undefined;
	return {
		base_provider_type: ccConfig.base_provider_type ?? "openai",
		is_key_less: ccConfig.is_key_less ?? false,
		allowed_requests: {
			text_completion: ar?.text_completion ?? true,
			text_completion_stream: ar?.text_completion_stream ?? true,
			chat_completion: ar?.chat_completion ?? true,
			chat_completion_stream: ar?.chat_completion_stream ?? true,
			responses: ar?.responses ?? true,
			responses_stream: ar?.responses_stream ?? true,
			embedding: ar?.embedding ?? true,
			speech: ar?.speech ?? true,
			speech_stream: ar?.speech_stream ?? true,
			transcription: ar?.transcription ?? true,
			transcription_stream: ar?.transcription_stream ?? true,
			count_tokens: ar?.count_tokens ?? true,
			list_models: ar?.list_models ?? true,
			ocr: ar?.ocr ?? true,
			ocr_stream: ar?.ocr_stream ?? true,
			image_generation: ar?.image_generation ?? true,
			image_generation_stream: ar?.image_generation_stream ?? true,
			image_edit: ar?.image_edit ?? true,
			image_edit_stream: ar?.image_edit_stream ?? true,
			image_variation: ar?.image_variation ?? true,
			rerank: ar?.rerank ?? true,
			video_generation: ar?.video_generation ?? true,
			video_list: ar?.video_list ?? true,
			video_retrieve: ar?.video_retrieve ?? true,
			video_download: ar?.video_download ?? true,
			video_delete: ar?.video_delete ?? true,
			video_remix: ar?.video_remix ?? true,
			websocket_responses: ar?.websocket_responses ?? true,
			realtime: ar?.realtime ?? true,
		},
		request_path_overrides: (ccConfig.request_path_overrides as Record<string, string | undefined>) ?? {},
		base_url: nc.base_url ?? "",
		timeout: nc.timeout ?? 120,
		max_retries: nc.max_retries ?? 3,
		connect_timeout: nc.connect_timeout ?? 10,
		read_timeout: nc.read_timeout ?? 60,
		idle_conn_timeout: nc.idle_conn_timeout ?? 90,
		concurrency: cc.concurrency ?? 32,
		buffer_size: cc.buffer_size ?? 64,
		proxy_url: pc?.url ?? "",
		proxy_username: pc?.username ?? "",
		proxy_password: pc?.password ?? "",
	};
}

export function ProviderConfigSheet({ open, onOpenChange, providerName, provider }: ProviderConfigSheetProps) {
	const [updateProvider, { isLoading }] = usePlatformAdminUpdateProviderMutation();
	const form = useForm<ConfigForm>({
		resolver: zodResolver(platformAdminProviderConfigSchema),
		mode: "onChange",
		defaultValues: toDefaultForm(provider),
	});

	useEffect(() => {
		if (open) {
			form.reset(toDefaultForm(provider));
		}
	}, [open, provider, form]);

	const onSubmit: SubmitHandler<ConfigForm> = async (data) => {
		try {
			await updateProvider({
				provider: providerName,
				body: {
					network_config: {
						base_url: data.base_url || undefined,
						timeout: data.timeout,
						max_retries: data.max_retries,
						connect_timeout: data.connect_timeout,
						read_timeout: data.read_timeout,
						idle_conn_timeout: data.idle_conn_timeout,
					},
					concurrency_and_buffer_size: {
						concurrency: data.concurrency,
						buffer_size: data.buffer_size,
					},
					proxy_config: data.proxy_url
						? {
								url: data.proxy_url,
								username: data.proxy_username || undefined,
								password: data.proxy_password || undefined,
							}
						: undefined,
					custom_provider_config: {
						base_provider_type: data.base_provider_type as BaseProvider,
						is_key_less: data.is_key_less ?? false,
						allowed_requests: data.allowed_requests,
						request_path_overrides: cleanPathOverrides(data.request_path_overrides),
					},
				},
			}).unwrap();
			toast.success("Provider updated successfully");
			onOpenChange(false);
		} catch (err: any) {
			toast.error("Failed to update provider", {
				description: err?.data?.message || err?.message || "Unknown error",
			});
		}
	};

	const ccConfig = provider.custom_provider_config ?? {};
	const baseProviderType = ccConfig.base_provider_type as BaseProvider | undefined;

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="custom-scrollbar flex flex-col p-8 sm:max-w-3xl">
				<SheetHeader className="shrink-0 flex flex-col items-start">
					<SheetTitle className="text-lg font-medium">Edit {providerName}</SheetTitle>
					<SheetDescription>Update network, performance, proxy, and request settings.</SheetDescription>
				</SheetHeader>

				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col overflow-hidden">
						<div className="custom-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto pr-4">
							{/* API Structure section */}
							<div className="space-y-4">
								<div className="flex items-center gap-2 text-sm font-semibold">
									<Globe className="h-5 w-5" />
									API Structure
								</div>
								<div className="space-y-4 pl-7">
									<FormField
										control={form.control}
										name="base_provider_type"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Base Provider Type</FormLabel>
												<FormControl>
													<Input {...field} className="h-10" disabled />
												</FormControl>
												<FormDescription>The underlying provider this custom provider will use</FormDescription>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>
							</div>

							<Separator />

							{/* Allowed Requests Fields */}
							<div className="pl-0">
								<AllowedRequestsFields
									form={form}
									providerType={form.watch("base_provider_type") as BaseProvider}
								/>
							</div>

							<Separator />

							{/* Network Section */}
							<div className="space-y-4">
								<div className="flex items-center gap-2 text-sm font-semibold">
									<Globe className="h-5 w-5" />
									Network
								</div>
								<div className="space-y-4 pl-7">
									<div className="grid gap-2">
										<FormField
											control={form.control}
											name="base_url"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Base URL</FormLabel>
													<FormControl>
														<Input {...field} placeholder="https://api.example.com" className="h-10" />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>
									<div className="grid grid-cols-2 gap-4">
										<div className="grid gap-2">
											<FormField
												control={form.control}
												name="timeout"
												render={({ field }) => (
													<FormItem>
														<FormLabel>Timeout (s)</FormLabel>
														<FormControl>
															<Input type="number" {...field} className="h-10" />
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
										</div>
										<div className="grid gap-2">
											<FormField
												control={form.control}
												name="max_retries"
												render={({ field }) => (
													<FormItem>
														<FormLabel>Max Retries</FormLabel>
														<FormControl>
															<Input type="number" {...field} className="h-10" />
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
										</div>
									</div>
								</div>
							</div>

							<Separator />

							{/* Connection Timeouts Section */}
							<div className="space-y-4">
								<div className="flex items-center gap-2 text-sm font-semibold">
									<Network className="h-5 w-5" />
									Connection Timeouts
								</div>
								<div className="grid grid-cols-3 gap-4 pl-7">
									<div className="grid gap-2">
										<FormField
											control={form.control}
											name="connect_timeout"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Connect (s)</FormLabel>
													<FormControl>
														<Input type="number" {...field} className="h-10" />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>
									<div className="grid gap-2">
										<FormField
											control={form.control}
											name="read_timeout"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Read (s)</FormLabel>
													<FormControl>
														<Input type="number" {...field} className="h-10" />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>
									<div className="grid gap-2">
										<FormField
											control={form.control}
											name="idle_conn_timeout"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Idle Conn (s)</FormLabel>
													<FormControl>
														<Input type="number" {...field} className="h-10" />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>
								</div>
							</div>

							<Separator />

							{/* Performance Section */}
							<div className="space-y-4">
								<div className="flex items-center gap-2 text-sm font-semibold">
									<Gauge className="h-5 w-5" />
									Performance
								</div>
								<div className="grid grid-cols-2 gap-4 pl-7">
									<div className="grid gap-2">
										<FormField
											control={form.control}
											name="concurrency"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Concurrency</FormLabel>
													<FormControl>
														<Input type="number" {...field} className="h-10" />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>
									<div className="grid gap-2">
										<FormField
											control={form.control}
											name="buffer_size"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Buffer Size</FormLabel>
													<FormControl>
														<Input type="number" {...field} className="h-10" />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>
								</div>
							</div>

							<Separator />

							{/* Proxy Section */}
							<div className="space-y-4">
								<div className="flex items-center gap-2 text-sm font-semibold">
									<Shield className="h-5 w-5" />
									Proxy
								</div>
								<div className="space-y-4 pl-7">
									<div className="grid gap-2">
										<FormField
											control={form.control}
											name="proxy_url"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Proxy URL</FormLabel>
													<FormControl>
														<Input {...field} placeholder="http://proxy:8080" className="h-10" />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>
									<div className="grid grid-cols-2 gap-4">
										<div className="grid gap-2">
											<FormField
												control={form.control}
												name="proxy_username"
												render={({ field }) => (
													<FormItem>
														<FormLabel>Username</FormLabel>
														<FormControl>
															<Input autoComplete="off" {...field} className="h-10" />
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
										</div>
										<div className="grid gap-2">
											<FormField
												control={form.control}
												name="proxy_password"
												render={({ field }) => (
													<FormItem>
														<FormLabel>Password</FormLabel>
														<FormControl>
															<Input type="password" autoComplete="new-password" {...field} className="h-10" />
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
										</div>
									</div>
								</div>
							</div>
						</div>

						{/* Footer actions */}
						<div className="mt-10 flex shrink-0 flex-row items-center justify-end gap-2 border-t pt-4">
							<Button type="button" variant="outline" onClick={() => form.reset()}>
								Reset
							</Button>
							<Button type="submit" isLoading={isLoading} disabled={!form.formState.isDirty || !form.formState.isValid}>
								Save Changes
							</Button>
						</div>
					</form>
				</Form>
			</SheetContent>
		</Sheet>
	);
}
