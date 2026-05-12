"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CodeEditor } from "@/components/ui/codeEditor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { ProviderIconType, RenderProviderIcon } from "@/lib/constants/icons";
import { getProviderLabel, RequestTypeLabels } from "@/lib/constants/logs";
import {
	usePlatformAdminListProvidersQuery,
} from "@/lib/platform/endpoints/providers";
import {
	usePlatformAdminCreateModelPriceMutation,
	usePlatformAdminUpdateModelPriceMutation,
	usePlatformAdminDeleteModelPriceMutation,
} from "@/lib/platform/endpoints/billing";
import { getErrorMessage } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ChevronDown, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { PricingOverride, PricingOverridePatch } from "@/lib/types/governance";
import type {
	FormState,
	PricingFieldKey,
} from "../../../../../workspace/custom-pricing/overrides/pricingOverrideSheet";
import {
	PRICING_FIELDS,
	REQUEST_TYPE_GROUPS,
	REQUEST_TYPE_OPTIONS,
	getRequestTypeGroup,
	patchKeys,
	buildPatchFromForm,
} from "../../../../../workspace/custom-pricing/overrides/pricingOverrideSheet";
import { PricingFieldSelector } from "../../../../../workspace/custom-pricing/overrides/pricingFieldSelector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScopeKind = "global" | "virtual_key";
/** Match type — how the pattern is interpreted. */
export type MatchType = "exact" | "wildcard";

export const SCOPE_KIND_OPTIONS: { value: ScopeKind; label: string }[] = [
	{ value: "global", label: "Global" },
	{ value: "virtual_key", label: "Virtual Key" },
];

export const MATCH_TYPE_OPTIONS: { value: MatchType; label: string }[] = [
	{ value: "exact", label: "Exact match" },
	{ value: "wildcard", label: "Wildcard (*)" },
];

/** Validate pattern based on match type. */
export function validatePattern(
	matchType: MatchType,
	pattern: string,
): string | undefined {
	const trimmed = pattern.trim();
	if (!trimmed) return "Pattern is required";
	if (matchType === "exact" && trimmed.includes("*"))
		return "Exact pattern cannot contain *";
	if (matchType === "wildcard" && !trimmed.endsWith("*"))
		return 'Wildcard pattern must end with * (e.g. "gpt-5*")';
	return undefined;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ModelPriceSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** When provided, the sheet opens in edit mode pre-populated with this override's values. */
	editingOverride?: PricingOverride | null;
	onSaved?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a PricingOverride (from API) to the pricingValues map used by the form. */
function overrideToPricingValues(
	override: PricingOverride,
): Partial<Record<PricingFieldKey, string>> {
	const values: Partial<Record<PricingFieldKey, string>> = {};
	let parsedPatch: Record<string, unknown> = {};
	try {
		if (override.pricing_patch) parsedPatch = JSON.parse(override.pricing_patch);
	} catch {
		// malformed patch — leave values empty
	}
	for (const key of patchKeys) {
		const val = parsedPatch[key];
		if (typeof val === "number" && Number.isFinite(val)) {
			values[key] = String(val);
		}
	}
	return values;
}

/** Build a pricing patch from pricingValues. */
function buildPricingPatch(
	pricingValues: Partial<Record<PricingFieldKey, string>>,
): { patch: PricingOverridePatch; errors: Partial<Record<PricingFieldKey, string>> } {
	const errors: Partial<Record<PricingFieldKey, string>> = {};
	const patch: PricingOverridePatch = {};
	for (const key of patchKeys) {
		const raw = pricingValues[key];
		if (!raw || raw.trim() === "") continue;
		const num = Number(raw);
		if (Number.isNaN(num) || num < 0) {
			errors[key] = "Must be a non-negative number";
			continue;
		}
		(patch as Record<string, number>)[key] = num;
	}
	return { patch, errors };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ModelPriceSheet({
	open,
	onOpenChange,
	editingOverride,
	onSaved,
}: ModelPriceSheetProps) {
	// ---- Data fetching ----
	const { data: providersData, isLoading: isProvidersLoading } =
		usePlatformAdminListProvidersQuery();

	// ---- Mutations ----
	const [createMutation, { isLoading: isCreating }] =
		usePlatformAdminCreateModelPriceMutation();
	const [updateMutation, { isLoading: isUpdating }] =
		usePlatformAdminUpdateModelPriceMutation();
	const [deleteMutation, { isLoading: isDeleting }] =
		usePlatformAdminDeleteModelPriceMutation();

	// ---- Form state ----
	const [form, setForm] = useState({
		name: "",
		model: "",
		provider: "",
		requestTypes: [] as string[],
		scopeKind: "global" as ScopeKind,
		matchType: "exact" as MatchType,
		pattern: "",
	});
	const [pricingValues, setPricingValues] = useState<
		Partial<Record<PricingFieldKey, string>>
	>({});
	const [jsonPatch, setJsonPatch] = useState("");
	const [jsonError, setJsonError] = useState<string>();
	const [requestTypePopoverOpen, setRequestTypePopoverOpen] = useState(false);
	const jsonEditingRef = useRef(false);
	const prevOpenRef = useRef(false);

	const isSaving = isCreating || isUpdating || isDeleting;

	// ---- Derived ----
	const providers = useMemo(
		() => providersData?.providers ?? [],
		[providersData],
	);

	// Hydrate form only when sheet transitions from closed → open.
	useEffect(() => {
		const wasOpen = prevOpenRef.current;
		prevOpenRef.current = open;
		if (!open || wasOpen) return;

		jsonEditingRef.current = false;
		setJsonError(undefined);

		if (editingOverride) {
			const requestTypes = editingOverride.request_types ?? [];
			setForm({
				name: editingOverride.name ?? "",
				model: editingOverride.pattern ?? "",
				provider: editingOverride.provider_id ?? "",
				requestTypes,
				scopeKind: (editingOverride.scope_kind === "virtual_key" ||
					editingOverride.scope_kind === "virtual_key_provider" ||
					editingOverride.scope_kind === "virtual_key_provider_key")
					? "virtual_key"
					: "global",
				matchType: editingOverride.match_type ?? "exact",
				pattern: editingOverride.pattern ?? "",
			});
			setPricingValues(overrideToPricingValues(editingOverride));
		} else {
			setForm({ name: "", model: "", provider: "", requestTypes: [], scopeKind: "global", matchType: "exact", pattern: "" });
			setPricingValues({});
		}
	}, [open, editingOverride]);

	// Sync pricingValues → JSON patch display (when not in JSON-edit mode).
	useEffect(() => {
		if (!jsonEditingRef.current) {
			const { patch } = buildPricingPatch(pricingValues);
			const json =
				Object.keys(patch).length > 0
					? JSON.stringify(patch, null, 2)
					: "";
			setJsonPatch(json);
			setJsonError(undefined);
		}
	}, [pricingValues]);

	const handleJSONChange = useCallback((value: string) => {
		jsonEditingRef.current = true;
		setJsonPatch(value);
		const trimmed = value.trim();
		if (!trimmed) {
			setJsonError(undefined);
			setPricingValues({});
			return;
		}
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
				setJsonError("Patch must be a JSON object");
				return;
			}
			const pricingVals: Partial<Record<PricingFieldKey, string>> = {};
			for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
				if (
					!(patchKeys as readonly string[]).includes(key)
				) {
					setJsonError(`Unknown field: ${key}`);
					return;
				}
				if (
					typeof val !== "number" ||
					Number.isNaN(val) ||
					val < 0
				) {
					setJsonError(`${key} must be a non-negative number`);
					return;
				}
				pricingVals[key as PricingFieldKey] = String(val);
			}
			setJsonError(undefined);
			setPricingValues(pricingVals);
		} catch {
			setJsonError("Invalid JSON");
		}
	}, []);

	const handleFieldInteraction = useCallback(() => {
		jsonEditingRef.current = false;
	}, []);

	const toggleRequestType = (rt: string) => {
		setForm((prev) => ({
			...prev,
			requestTypes: prev.requestTypes.includes(rt)
				? prev.requestTypes.filter((r) => r !== rt)
				: [...prev.requestTypes, rt],
		}));
	};

	const handleClose = () => {
		onOpenChange(false);
	};

	// ---- Validation & Save ----
	const handleSave = async () => {
		if (!form.name.trim()) {
			toast.error("Name is required");
			return;
		}
		const patternErr = validatePattern(form.matchType, form.pattern);
		if (patternErr) {
			toast.error(patternErr);
			return;
		}
		if (form.requestTypes.length === 0) {
			toast.error("At least one request type must be selected");
			return;
		}
		if (jsonError) {
			toast.error("Fix the JSON error before saving");
			return;
		}

		const { patch, errors } = buildPricingPatch(pricingValues);
		const firstError = Object.values(errors)[0];
		if (firstError) {
			toast.error(firstError);
			return;
		}
		if (Object.keys(patch).length === 0) {
			toast.error("At least one pricing field must be specified");
			return;
		}

		// Governance API body: name + scope + match + pricing nested in patch
		const body = {
			name: form.name.trim(),
			scope_kind: form.scopeKind,
			match_type: form.matchType,
			pattern: form.pattern.trim(),
			request_types: form.requestTypes,
			patch,
		};

		try {
			if (editingOverride) {
				await updateMutation({
					id: editingOverride.id,
					data: body,
				}).unwrap();
				toast.success("Pricing override updated");
			} else {
				await createMutation(body as Parameters<typeof createMutation>[0]).unwrap();
				toast.success("Pricing override created");
			}
			handleClose();
			onSaved?.();
		} catch (err) {
			toast.error("Failed to save pricing override", {
				description: getErrorMessage(err),
			});
		}
	};

	// ---- Render ----
	return (
		<Sheet
			open={open}
			onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}
		>
			<SheetContent
				side="right"
				className="dark:bg-card flex w-full flex-col overflow-x-hidden bg-white px-4 pb-6 sm:max-w-2xl"
			>
				<SheetHeader className="flex flex-col items-start px-3 pt-8">
					<SheetTitle>
						{editingOverride
							? "Edit Pricing Override"
							: "Create Pricing Override"}
					</SheetTitle>
				</SheetHeader>

				<div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto px-3 pb-4">
					{/* Identity fields */}
					<div className="space-y-4">
						{/* Name */}
						<div className="space-y-2">
							<Label htmlFor="mp-name-input">
								Name <span className="text-red-500">*</span>
							</Label>
							<Input
								id="mp-name-input"
								data-testid="mp-name-input"
								placeholder="e.g., GPT-4 Negotiated Rate"
								value={form.name}
								onChange={(e) =>
									setForm((p) => ({ ...p, name: e.target.value }))
								}
							/>
						</div>

						{/* Provider */}
						<div className="space-y-2">
							<Label htmlFor="mp-provider-select">Provider</Label>
							<Select
								value={form.provider || "__none__"}
								onValueChange={(v) =>
									setForm((p) => ({
										...p,
										provider: v === "__none__" ? "" : v,
									}))
								}
							>
								<SelectTrigger
									id="mp-provider-select"
									data-testid="mp-provider-select"
									className="w-full"
									disabled={isProvidersLoading}
								>
									{isProvidersLoading ? (
										<span className="text-muted-foreground">Loading...</span>
									) : form.provider ? (
										<div className="flex items-center gap-1.5">
											<RenderProviderIcon
												provider={form.provider as ProviderIconType}
												size="sm"
												className="h-4 w-4 shrink-0"
											/>
											<span>{getProviderLabel(form.provider)}</span>
										</div>
									) : (
										<span className="text-muted-foreground">
											All providers
										</span>
									)}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="__none__">All providers</SelectItem>
									{providers.map((p) => (
										<SelectItem key={p.name} value={p.name}>
											<div className="flex items-center gap-1.5">
												<RenderProviderIcon
													provider={p.name as ProviderIconType}
													size="sm"
													className="h-4 w-4 shrink-0"
												/>
												<span>{getProviderLabel(p.name)}</span>
											</div>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{/* Request Types */}
						<div className="space-y-2">
							<Label>Request Types <span className="text-red-500">*</span></Label>
							<Popover
								open={requestTypePopoverOpen}
								onOpenChange={setRequestTypePopoverOpen}
							>
								<PopoverTrigger asChild>
									<Button
										variant="outline"
										role="combobox"
										className="flex w-full items-center justify-between"
									>
										<span className="flex min-w-0 flex-1 flex-wrap gap-1">
											{form.requestTypes.length > 0 ? (
												form.requestTypes.map((rt) => (
													<span
														key={rt}
														className="bg-primary text-primary-foreground inline-flex items-center rounded px-2 py-0.5 text-xs"
													>
														{RequestTypeLabels[rt as keyof typeof RequestTypeLabels] ?? rt}
													</span>
												))
											) : (
												<span className="text-muted-foreground">
													Select request types...
												</span>
											)}
										</span>
										<ChevronDown className="h-4 w-4 shrink-0" />
									</Button>
								</PopoverTrigger>
								<PopoverContent
									align="start"
									className="w-[320px] p-2"
									onWheel={(e) => e.stopPropagation()}
								>
									<div
										className="max-h-72 space-y-1 overflow-y-auto"
										onWheel={(e) => e.stopPropagation()}
									>
										{REQUEST_TYPE_GROUPS.map((group) => (
											<div key={group.label}>
												<div className="text-muted-foreground px-2 py-1 text-xs font-medium">
													{group.label}
												</div>
												{group.types.map((rt) => {
													const checked = form.requestTypes.includes(rt);
													return (
														<label
															key={rt}
															className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm"
														>
															<Checkbox
																data-testid={`mp-request-type-checkbox-${rt}`}
																checked={checked}
																onCheckedChange={() => toggleRequestType(rt)}
															/>
															<span>
																{RequestTypeLabels[rt as keyof typeof RequestTypeLabels] ?? rt}
															</span>
														</label>
													);
												})}
											</div>
										))}
									</div>
									<div className="mt-2 flex justify-end">
										<Button
											type="button"
											size="sm"
											variant="ghost"
											onClick={() =>
												setForm((prev) => ({ ...prev, requestTypes: [] }))
											}
										>
											Clear
										</Button>
									</div>
								</PopoverContent>
							</Popover>
						</div>

						{/* Match & Scope */}
						<div className="space-y-3 rounded-md border border-border p-4">
							<div className="flex items-center gap-2">
								<Label className="text-sm font-medium">Match & Scope</Label>
								<span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
									Required
								</span>
							</div>

							<div className="grid grid-cols-2 gap-3">
								{/* Scope Kind */}
								<div className="space-y-1.5">
									<Label htmlFor="mp-scope-kind" className="text-xs">
										Scope
									</Label>
									<Select
										value={form.scopeKind}
										onValueChange={(v) =>
											setForm((p) => ({ ...p, scopeKind: v as ScopeKind }))
										}
									>
										<SelectTrigger id="mp-scope-kind" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{SCOPE_KIND_OPTIONS.map((o) => (
												<SelectItem key={o.value} value={o.value}>
													{o.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>

								{/* Match Type */}
								<div className="space-y-1.5">
									<Label htmlFor="mp-match-type" className="text-xs">
										Match Type
									</Label>
									<Select
										value={form.matchType}
										onValueChange={(v) =>
											setForm((p) => ({ ...p, matchType: v as MatchType }))
										}
									>
										<SelectTrigger id="mp-match-type" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{MATCH_TYPE_OPTIONS.map((o) => (
												<SelectItem key={o.value} value={o.value}>
													{o.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>

							{/* Pattern */}
							<div className="space-y-1.5">
								<Label htmlFor="mp-pattern">
									<span className="text-xs">Pattern</span>{" "}
									<span className="text-red-500">*</span>
								</Label>
								<Input
									id="mp-pattern"
									placeholder={
										form.matchType === "exact"
											? "e.g., gpt-4o-mini"
											: "e.g., gpt-4*"
									}
									value={form.pattern}
									onChange={(e) =>
										setForm((p) => ({ ...p, pattern: e.target.value }))
									}
									className="font-mono text-sm"
								/>
								{form.pattern !== undefined &&
									validatePattern(form.matchType, form.pattern) && (
										<p className="text-xs text-red-500">
											{validatePattern(form.matchType, form.pattern)}
										</p>
									)}
								<p className="text-xs text-muted-foreground">
									{form.matchType === "exact"
										? "Exact model name to match (no wildcards)."
										: 'Wildcard: pattern* matches all names starting with pattern. Must end with *.'}
								</p>
							</div>
						</div>
					</div>

					{/* Pricing fields */}
						<div className="space-y-2">
							<Label>
								Pricing fields{" "}
								<span className="text-muted-foreground text-xs font-normal">
									(USD per unit)
								</span>
							</Label>
							<PricingFieldSelector
								key={
									open
										? editingOverride
											? `edit-${editingOverride.id ?? "new"}`
											: "create"
										: "closed"
								}
								values={pricingValues}
								errors={{}}
								selectedRequestTypes={form.requestTypes}
								onChange={(key: string, value: string) => {
									handleFieldInteraction();
									setPricingValues((prev) => ({ ...prev, [key]: value }));
								}}
								onFieldInteraction={handleFieldInteraction}
							/>
						</div>

						{/* JSON view */}
						<div className="space-y-2">
							<Label className="text-muted-foreground text-xs">JSON</Label>
							<div
								className={cn(
									"bg-muted/50 overflow-hidden rounded-md border",
									jsonError && "border-destructive",
								)}
							>
								<CodeEditor
									lang="json"
									code={jsonPatch}
									onChange={handleJSONChange}
									minHeight={40}
									maxHeight={200}
									autoResize
									shouldAdjustInitialHeight
									options={{ lineNumbers: "off", scrollBeyondLastLine: false }}
								/>
							</div>
							{jsonError && (
								<p className="text-destructive text-xs">{jsonError}</p>
							)}
						</div>
					</div>

				{/* Actions */}
				<div className="flex items-center justify-between gap-3 border-t px-3 pt-4">
					{editingOverride ? (
						<Button
							data-testid="mp-delete-btn"
							type="button"
							variant="destructive"
							size="sm"
							disabled={isSaving}
							onClick={async () => {
								try {
									await deleteMutation(editingOverride.id).unwrap();
									toast.success("Pricing override deleted");
									handleClose();
									onSaved?.();
								} catch (err) {
									toast.error("Failed to delete", {
										description: getErrorMessage(err),
									});
								}
							}}
						>
							Delete
						</Button>
					) : (
						<div />
					)}
					<div className="flex gap-3">
						<Button
							data-testid="mp-cancel-btn"
							type="button"
							variant="outline"
							size="sm"
							disabled={isSaving}
							onClick={handleClose}
						>
							<X className="h-4 w-4" />
							Cancel
						</Button>
						<Button
							data-testid="mp-save-btn"
							type="button"
							size="sm"
							disabled={isSaving}
							onClick={handleSave}
						>
							<Save className="h-4 w-4" />
							{editingOverride ? "Update" : "Create"}
						</Button>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
