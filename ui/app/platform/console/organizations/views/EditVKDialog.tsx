import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlatformVirtualKey, usePlatformUpdateTeamVKMutation } from "@/lib/platform/platformApi";

const editVkSchema = z.object({
	name: z.string().min(1, "Name is required").max(100),
	description: z.string().max(500).optional(),
	is_active: z.boolean(),
	budget_limit: z.number().min(0, "Budget must be non-negative").max(9999999, "Budget too large").optional(),
	budget_reset_duration: z.string().max(50).optional(),
});

type EditVkForm = z.infer<typeof editVkSchema>;

const RESET_NONE = "__no_reset__";

interface EditVKDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	vk: PlatformVirtualKey | null;
	teamId: string;
	onUpdated?: () => void;
}

export function EditVKDialog({ open, onOpenChange, vk, teamId, onUpdated }: EditVKDialogProps) {
	const [updateVK, { isLoading }] = usePlatformUpdateTeamVKMutation();
	const [selectedResetDuration, setSelectedResetDuration] = useState(RESET_NONE);

	const {
		register,
		handleSubmit,
		reset,
		setValue,
		watch,
		formState: { errors },
	} = useForm<EditVkForm>({
		defaultValues: {
			name: vk?.name ?? "",
			description: vk?.description ?? "",
			is_active: vk?.is_active ?? true,
			budget_limit: vk?.budget_limit,
		},
	});

	// Sync form when vk changes (dialog opens)
	const isActive = watch("is_active");

	const handleOpen = (value: boolean) => {
		if (value && vk) {
			reset({
				name: vk.name ?? "",
				description: vk.description ?? "",
				is_active: vk.is_active ?? true,
				budget_limit: vk.budget_limit,
			});
			setSelectedResetDuration(vk.budget_reset_duration ?? RESET_NONE);
		}
		onOpenChange(value);
	};

	const onSubmit = async (data: EditVkForm) => {
		if (!vk) return;
		try {
			await updateVK({
				team_id: teamId,
				vk_id: vk.id,
				name: data.name,
				description: data.description,
				is_active: data.is_active,
				budget_limit: data.budget_limit,
				budget_reset_duration: selectedResetDuration !== RESET_NONE ? selectedResetDuration : undefined,
			}).unwrap();
			toast.success("Virtual key updated successfully");
			handleOpen(false);
			onUpdated?.();
		} catch (err: unknown) {
			const message =
				(err as { data?: { message?: string } })?.data?.message || (err as { message?: string })?.message || "Failed to update VK";
			toast.error(message);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpen}>
			<DialogContent className="sm:max-w-md" disableOutsideClick={false}>
				<DialogHeader>
					<DialogTitle>Edit Virtual Key</DialogTitle>
					<DialogDescription>
						Update settings for <span className="font-medium">{vk?.name}</span>
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
					{/* Name */}
					<div className="space-y-2">
						<Label htmlFor="edit-vk-name">Name</Label>
						<Input id="edit-vk-name" placeholder="Production Key" {...register("name")} />
						{errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
					</div>

					{/* Description */}
					<div className="space-y-2">
						<Label htmlFor="edit-vk-desc">Description (optional)</Label>
						<Input id="edit-vk-desc" placeholder="Used for production API calls" {...register("description")} />
						{errors.description && <p className="text-destructive text-xs">{errors.description.message}</p>}
					</div>

					{/* Active toggle */}
					<div className="flex items-center justify-between rounded-md border p-3">
						<div>
							<Label htmlFor="edit-vk-active" className="cursor-pointer">
								Active
							</Label>
							<p className="text-muted-foreground text-xs">Inactive keys will be rejected on use</p>
						</div>
						<Switch id="edit-vk-active" checked={isActive} onCheckedChange={(checked) => setValue("is_active", checked)} />
					</div>

					{/* Budget limit */}
					<div className="space-y-2">
						<Label htmlFor="edit-vk-budget">Budget Limit (USD, optional)</Label>
						<Input
							id="edit-vk-budget"
							type="number"
							min="0"
							step="0.01"
							placeholder="100.00 (leave empty for no limit)"
							{...register("budget_limit", {
								setValueAs: (v: string) => (v === "" ? undefined : parseFloat(v)),
							})}
						/>
						{errors.budget_limit && <p className="text-destructive text-xs">{errors.budget_limit.message}</p>}
						<p className="text-muted-foreground text-xs">Set to 0 or leave empty for unlimited budget</p>
					</div>

					{/* Budget reset duration */}
					<div className="space-y-2">
						<Label htmlFor="edit-vk-reset-duration">Budget Reset Duration (optional)</Label>
						<Select value={selectedResetDuration} onValueChange={setSelectedResetDuration}>
							<SelectTrigger id="edit-vk-reset-duration">
								<SelectValue placeholder="Select reset period (e.g., '1M' for monthly)" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={RESET_NONE}>No reset (one-time budget)</SelectItem>
								<SelectItem value="1D">Daily</SelectItem>
								<SelectItem value="1W">Weekly</SelectItem>
								<SelectItem value="2W">Bi-weekly</SelectItem>
								<SelectItem value="1M">Monthly</SelectItem>
								<SelectItem value="3M">Quarterly</SelectItem>
								<SelectItem value="1Y">Yearly</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-muted-foreground text-xs">Examples: "1D" (daily), "1W" (weekly), "1M" (monthly)</p>
					</div>

					<DialogFooter className="gap-2">
						<Button type="button" variant="outline" onClick={() => handleOpen(false)} disabled={isLoading}>
							Cancel
						</Button>
						<Button type="submit" disabled={isLoading}>
							{isLoading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Saving...
								</>
							) : (
								"Save Changes"
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}