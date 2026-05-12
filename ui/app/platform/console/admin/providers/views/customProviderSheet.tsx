import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { usePlatformAdminCreateProviderMutation } from "@/lib/platform/platformApi";
import { BaseProvider, ModelProviderName } from "@/lib/types/config";
import { allowedRequestsSchema } from "@/lib/types/schemas";
import { cleanPathOverrides } from "@/lib/utils/validation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AllowedRequestsFields } from "@/app/workspace/providers/fragments/allowedRequestsFields";

const formSchema = z.object({
	name: z.string().min(1, "Provider name is required"),
	baseProviderType: z.string().min(1, "Base provider is required"),
	baseUrl: z.string().optional(),
	isKeyLess: z.boolean().optional(),
	allowed_requests: allowedRequestsSchema,
	request_path_overrides: z.record(z.string(), z.string().optional()).optional(),
});

type FormData = z.infer<typeof formSchema>;

const BASE_PROVIDERS: { value: BaseProvider; label: string }[] = [
	{ value: "openai", label: "OpenAI" },
	{ value: "anthropic", label: "Anthropic" },
	{ value: "gemini", label: "Google Gemini" },
	{ value: "cohere", label: "Cohere" },
	{ value: "bedrock", label: "AWS Bedrock" },
	{ value: "replicate", label: "Replicate" },
];

interface CustomProviderSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated?: (name: string) => void;
}

export function CustomProviderSheet({ open, onOpenChange, onCreated }: CustomProviderSheetProps) {
	const [createProvider, { isLoading }] = usePlatformAdminCreateProviderMutation();
	const form = useForm<FormData>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			name: "",
			baseProviderType: "",
			baseUrl: "",
			isKeyLess: false,
			allowed_requests: {
				text_completion: true,
				text_completion_stream: true,
				chat_completion: true,
				chat_completion_stream: true,
				responses: true,
				responses_stream: true,
				embedding: true,
				speech: true,
				speech_stream: true,
				transcription: true,
				transcription_stream: true,
				image_generation: true,
				image_generation_stream: true,
				image_edit: true,
				image_edit_stream: true,
				image_variation: true,
				rerank: true,
				ocr: true,
				ocr_stream: true,
				video_generation: true,
				video_retrieve: true,
				video_download: true,
				video_delete: true,
				video_list: true,
				video_remix: true,
				count_tokens: true,
				list_models: true,
				websocket_responses: true,
				realtime: false,
			},
			request_path_overrides: undefined,
		},
	});

	const baseProviderType = form.watch("baseProviderType") as BaseProvider;
	const isKeyLessDisabled = baseProviderType === "bedrock";

	const onSubmit = (data: FormData) => {
		const payload = {
			provider: data.name as ModelProviderName,
			custom_provider_config: {
				base_provider_type: data.baseProviderType as BaseProvider,
				allowed_requests: data.allowed_requests,
				request_path_overrides: cleanPathOverrides(data.request_path_overrides),
				is_key_less: data.isKeyLess ?? false,
			},
			network_config: data.baseUrl
				? {
						base_url: data.baseUrl,
					}
				: undefined,
		};

		createProvider(payload)
			.unwrap()
			.then(() => {
				toast.success("Custom provider created");
				form.reset();
				onOpenChange(false);
				onCreated?.(data.name);
			})
			.catch((err: any) => {
				toast.error("Failed to create provider", {
					description: err?.data?.message || err?.message || "Unknown error",
				});
			});
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="custom-scrollbar flex flex-col p-8 sm:max-w-3xl">
				<SheetHeader className="flex shrink-0 flex-col items-start">
					<SheetTitle className="text-lg font-medium">Add Custom Provider</SheetTitle>
					<SheetDescription>Create a new custom provider with a base provider type.</SheetDescription>
				</SheetHeader>

				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col overflow-hidden">
						<div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto pr-4">
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem className="flex flex-col gap-3">
										<FormLabel>Provider Name</FormLabel>
										<FormControl>
											<Input placeholder="e.g., my-custom-provider" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="baseProviderType"
								render={({ field }) => (
									<FormItem className="flex flex-col gap-3">
										<FormLabel>Base Provider</FormLabel>
										<FormControl>
											<Select onValueChange={field.onChange} value={field.value}>
												<SelectTrigger>
													<SelectValue placeholder="Select base provider" />
												</SelectTrigger>
												<SelectContent>
													{BASE_PROVIDERS.map((p) => (
														<SelectItem key={p.value} value={p.value}>
															{p.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="baseUrl"
								render={({ field }) => (
									<FormItem className="flex flex-col gap-3">
										<FormLabel>Base URL (optional)</FormLabel>
										<FormControl>
											<Input placeholder="https://api.example.com" {...field} value={field.value || ""} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							{!isKeyLessDisabled && (
								<FormField
									control={form.control}
									name="isKeyLess"
									render={({ field }) => (
										<FormItem>
											<div className="flex items-center justify-between rounded-lg border p-3">
												<div className="space-y-0.5">
													<label htmlFor="isKeyLess" className="text-sm font-medium">
														Keyless Provider
													</label>
													<p className="text-muted-foreground text-sm">Whether this provider requires an API key</p>
												</div>
												<Switch id="isKeyLess" checked={field.value} onCheckedChange={field.onChange} />
											</div>
										</FormItem>
									)}
								/>
							)}

							<AllowedRequestsFields control={form.control} providerType={baseProviderType} />

							<div className="align-end mt-10 ml-auto flex flex-row items-center justify-end gap-2 border-t pt-4">
								<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
									Cancel
								</Button>
								<Button type="submit" isLoading={isLoading}>
									Create
								</Button>
							</div>
						</div>
					</form>
				</Form>
			</SheetContent>
		</Sheet>
	);
}