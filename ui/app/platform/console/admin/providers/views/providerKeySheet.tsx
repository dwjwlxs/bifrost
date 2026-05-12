import { useEffect } from "react";
import type { ProviderKeyItem } from "@/lib/platform/platformApi";
import { usePlatformAdminCreateProviderKeyMutation, usePlatformAdminUpdateProviderKeyMutation } from "@/lib/platform/platformApi";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ModelMultiselect } from "@/components/ui/modelMultiselect";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";

interface ProviderKeySheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	providerName: string;
	editingKey: ProviderKeyItem | null;
}

const keyFormSchema = z.object({
	id: z.string().optional(),
	name: z.string().min(1, "Name is required"),
	value: z.string(),
	weight: z.number(),
	models: z.array(z.string()),
	blacklisted_models: z.array(z.string()),
	enabled: z.boolean(),
	use_for_batch_api: z.boolean(),
	description: z.string().optional(),
});

type KeyFormData = z.infer<typeof keyFormSchema>;

const defaultFormValues: KeyFormData = {
	id: "",
	name: "",
	value: "",
	weight: 1,
	models: ["*"],
	blacklisted_models: [],
	enabled: true,
	use_for_batch_api: false,
	description: "",
};

/** Build the EnvVar mutation payload from the raw input string.
 *  "env.KEY"    -> { env_var: "KEY", from_env: true }
 *  "sk-..."    -> { value: "sk-..." }
 *  empty string -> undefined (keep existing key on update) */
function buildEnvVarPayload(raw: string): { value?: string; env_var?: string; from_env?: boolean } | undefined {
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	if (trimmed.startsWith("env.")) {
		return { env_var: trimmed.slice(4), from_env: true };
	}
	return { value: trimmed };
}

export function ProviderKeySheet({ open, onOpenChange, providerName, editingKey }: ProviderKeySheetProps) {
	const [createKey, { isLoading: isCreating }] = usePlatformAdminCreateProviderKeyMutation();
	const [updateKey, { isLoading: isUpdating }] = usePlatformAdminUpdateProviderKeyMutation();
	const form = useForm<KeyFormData>({
		resolver: zodResolver(keyFormSchema),
		defaultValues: defaultFormValues,
	});

	// Reset form when sheet opens
	useEffect(() => {
		if (open) {
			if (editingKey) {
				form.reset({
					id: editingKey.id,
					name: editingKey.name,
					value: "",
					weight: editingKey.weight ?? 1,
				models: editingKey.models ?? [],
				blacklisted_models: editingKey.blacklisted_models ?? [],
					enabled: editingKey.enabled ?? true,
					use_for_batch_api: editingKey.use_for_batch_api ?? false,
					description: editingKey.description ?? "",
				});
			} else {
				form.reset({ ...defaultFormValues, id: "" });
			}
		}
	}, [open, editingKey, form]);

	const onSubmit = form.handleSubmit(async (data) => {
		try {
			const valuePayload = buildEnvVarPayload(data.value);
			if (editingKey) {
				await updateKey({
					provider: providerName,
					id: editingKey.id,
					name: data.name,
					value: valuePayload,
					weight: data.weight,
					models: data.models,
					blacklisted_models: data.blacklisted_models.length > 0 ? data.blacklisted_models : undefined,
					enabled: data.enabled,
					use_for_batch_api: data.use_for_batch_api,
					description: data.description,
				}).unwrap();
				toast.success("Key updated");
			} else {
				if (!valuePayload) {
					toast.error("API key value is required when creating a new key");
					return;
				}
				// 创建场景：保留 "*" 让后端决定如何处理空数组 vs ["*"]
				await createKey({
					provider: providerName,
					id: data.id || undefined,
					name: data.name,
					value: valuePayload,
					weight: data.weight,
					models: data.models,
					blacklisted_models: data.blacklisted_models.length > 0 ? data.blacklisted_models : undefined,
					enabled: data.enabled,
					use_for_batch_api: data.use_for_batch_api,
					description: data.description,
				}).unwrap();
				toast.success("Key created");
			}
			onOpenChange(false);
		} catch (err: any) {
			toast.error("Failed to save key", {
				description: err?.data?.message || err?.message || "Unknown error",
			});
		}
	});

	const isLoading = isCreating || isUpdating;

	// Redacted display value for the current key (shown when editing)
	const currentRedacted = editingKey?.value;

	return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent className="custom-scrollbar flex flex-col p-8 sm:max-w-[600px]">
					<FormProvider {...form}>
					<SheetHeader className="flex shrink-0 flex-col items-start">
					<SheetTitle className="text-lg font-medium">{editingKey ? "Edit Key" : "Add Key"}</SheetTitle>
					<SheetDescription className="text-sm">
						{editingKey
							? `Update API key for ${providerName}. Leave value empty to keep the current value.`
							: `Add a new API key for ${providerName}.`}
					</SheetDescription>
				</SheetHeader>

				<form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<div className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto pr-4">
						{/* Name */}
						<div className="grid gap-2">
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Name</FormLabel>
										<FormControl>
											<Input autoComplete="off" {...field} className="h-10" placeholder="e.g., production-key-1" />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						{/* Description */}
						<div className="grid gap-2">
							<FormField
								control={form.control}
								name="description"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Description (optional)</FormLabel>
										<FormControl>
											<Input autoComplete="off" {...field} className="h-10" placeholder="Brief description of this key" />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						{/* Value */}
						<div className="grid gap-2">
							<FormField
								control={form.control}
								name="value"
								render={({ field }) => (
									<FormItem>
										<FormLabel>
											API Key
											{editingKey ? <span className="text-muted-foreground font-normal"> (leave empty to keep current)</span> : null}
										</FormLabel>
										{editingKey && currentRedacted ? (
											<div className="space-y-1.5">
												{/* Show current redacted key info */}
												<div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
													<code className="flex-1 break-all font-mono text-xs">{currentRedacted.value || "(no value)"}</code>
													{currentRedacted.from_env && currentRedacted.env_var && (
														<span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
															env: {currentRedacted.env_var}
														</span>
													)}
												</div>
												{/* Input for new value — only used when user wants to replace */}
												<FormControl>
													<Input
														type="password"
														autoComplete="new-password"
														{...field}
														className="h-10"
														placeholder="Enter new key to replace, or leave empty"
													/>
												</FormControl>
												<p className="text-muted-foreground text-xs">
													Type a new value to replace the current key. Supports <code className="text-[10px]">env.KEY_NAME</code> syntax.
												</p>
											</div>
										) : (
											<FormControl>
												<Input
													type="password"
													autoComplete="new-password"
													{...field}
													className="h-10"
													placeholder="sk-... or env.KEY_NAME"
												/>
											</FormControl>
										)}
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						{/* Weight */}
						<div className="grid gap-2">
							<FormField
								control={form.control}
								name="weight"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Weight</FormLabel>
										<FormControl>
											<Input
												max={1}
												step={0.1}
												type="number"
												value={field.value === undefined || field.value === null ? "" : String(field.value)}
												onChange={(e) => {
													field.onChange(e.target.value === "" ? "" : e.target.value);
												}}
												onBlur={(e) => {
													const v = e.target.value.trim();
													if (v !== "") {
														const num = parseFloat(v);
														if (!isNaN(num)) {
															field.onChange(num);
														}
													}
													field.onBlur();
												}}
												name={field.name}
												ref={field.ref}
												className="h-10"
											/>
										</FormControl>
										<FormDescription>Higher weight = more traffic. Default: 1</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						{/* Models */}
						<FormField
							control={form.control}
							name="models"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Allowed Models</FormLabel>
									<FormDescription>
										Select specific models this key applies to, or choose &quot;Allow All Models&quot; to allow all. Leave empty to deny all.
									</FormDescription>
									<FormControl>
										<ModelMultiselect
											provider={providerName}
											allowAllOption={true}
											value={field.value || []}
											onChange={(models: string[]) => {
												const hadStar = (field.value || []).includes("*");
												const hasStar = models.includes("*");
												if (!hadStar && hasStar) {
													field.onChange(["*"]);
												} else if (hadStar && hasStar && models.length > 1) {
													field.onChange(models.filter((m: string) => m !== "*"));
												} else {
													field.onChange(models);
												}
											}}
											placeholder={
												(field.value || []).includes("*")
													? "All models allowed"
													: (field.value || []).length === 0
														? "No models (deny all)"
														: "Search models..."
											}
											unfiltered={true}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						{/* Blacklisted Models */}
						<FormField
							control={form.control}
							name="blacklisted_models"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Blocked Models (optional)</FormLabel>
									<FormDescription>
										Models this key must never serve. The denylist always wins — if a model appears in both Allowed Models and here, it is blocked. Select &quot;All Models&quot; to block every model on this key.
									</FormDescription>
									<FormControl>
										<ModelMultiselect
											provider={providerName}
											allowAllOption={true}
											value={field.value || []}
											onChange={(models: string[]) => {
												const hadStar = (field.value || []).includes("*");
												const hasStar = models.includes("*");
												if (!hadStar && hasStar) {
													field.onChange(["*"]);
												} else if (hadStar && hasStar && models.length > 1) {
													field.onChange(models.filter((m: string) => m !== "*"));
												} else {
													field.onChange(models);
												}
											}}
											placeholder={
												(field.value || []).includes("*")
													? "All models blocked"
													: (field.value || []).length === 0
														? "No models blocked"
														: "Search models..."
											}
											unfiltered={true}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<Separator />

						{/* Enabled */}
						<FormField
							control={form.control}
							name="enabled"
							render={({ field }) => (
								<FormItem className="flex flex-row items-center justify-between rounded-sm border p-2">
									<div className="space-y-1.5">
										<FormLabel>Enabled</FormLabel>
										<FormDescription>Whether this key is active</FormDescription>
									</div>
									<FormControl>
										<Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
									</FormControl>
								</FormItem>
							)}
						/>

						{/* Use for Batch API */}
						<FormField
							control={form.control}
							name="use_for_batch_api"
							render={({ field }) => (
								<FormItem className="flex flex-row items-center justify-between rounded-sm border p-2">
									<div className="space-y-1.5">
										<FormLabel>Use for Batch API</FormLabel>
										<FormDescription>Whether this key can be used for batch operations</FormDescription>
									</div>
									<FormControl>
										<Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
									</FormControl>
								</FormItem>
							)}
						/>
					</div>

					{/* Footer actions */}
					<div className="mt-10 flex shrink-0 flex-row items-center justify-end gap-2 border-t pt-4">
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" isLoading={isLoading}>
							{editingKey ? "Update" : "Create"}
						</Button>
					</div>
				</form>
				</FormProvider>
			</SheetContent>
		</Sheet>
	);
}
