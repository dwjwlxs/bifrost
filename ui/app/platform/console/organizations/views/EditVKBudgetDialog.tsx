import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlatformVirtualKey, usePlatformUpdateTeamVKMutation } from "@/lib/platform/platformApi";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const editBudgetSchema = z.object({
	budget_limit: z.number().min(0, "Budget must be non-negative").max(9999999, "Budget too large").optional(),
	budget_reset_duration: z.string().max(50).optional(),
});

type EditBudgetForm = z.infer<typeof editBudgetSchema>;

interface EditVKBudgetDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	vk: PlatformVirtualKey;
	teamId: string;
}

export function EditVKBudgetDialog({ open, onOpenChange, vk, teamId }: EditVKBudgetDialogProps) {
	const [updateVK, { isLoading }] = usePlatformUpdateTeamVKMutation();

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<EditBudgetForm>({
		defaultValues: {
			budget_limit: vk.budget_limit ?? undefined,
			budget_reset_duration: vk.budget_reset_duration ?? undefined,
		},
	});

	const onSubmit = async (data: EditBudgetForm) => {
		try {
			await updateVK({
				team_id: teamId,
				vk_id: vk.id,
				budget_limit: data.budget_limit,
				budget_reset_duration: data.budget_reset_duration,
			}).unwrap();
			toast.success("Budget updated successfully");
			handleClose(false);
		} catch (err: unknown) {
			const message =
				(err as { data?: { message?: string } })?.data?.message || (err as { message?: string })?.message || "Failed to update budget";
			toast.error(message);
		}
	};

	const handleClose = (value: boolean) => {
		if (!value) {
			reset();
		}
		onOpenChange(value);
	};

	const usagePercent = vk.budget_limit && vk.budget_limit > 0 ? Math.min(((vk.current_usage ?? 0) / vk.budget_limit) * 100, 100) : 0;

	const usageColor = usagePercent > 90 ? "bg-destructive" : usagePercent > 70 ? "bg-yellow-500" : "bg-primary";

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-md" disableOutsideClick={false}>
				<DialogHeader>
					<DialogTitle>Edit VK Budget</DialogTitle>
					<DialogDescription>
						Update the budget limit for <strong>{vk.name}</strong>. Set to 0 for no limit.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
					{/* Current usage display */}
					<div className="bg-muted/50 rounded-md p-3">
						<div className="flex justify-between text-xs">
							<span className="text-muted-foreground">Current Usage</span>
							<span className="font-medium">${(vk.current_usage ?? 0).toFixed(4)}</span>
						</div>
						{vk.budget_limit !== undefined && vk.budget_limit > 0 && (
							<div className="mt-2">
								<div className="bg-muted h-2 w-full overflow-hidden rounded-full">
									<div className={`h-full rounded-full transition-all ${usageColor}`} style={{ width: `${usagePercent}%` }} />
								</div>
								<div className="mt-1 flex justify-between text-xs">
									<span className="text-muted-foreground">
										{usagePercent < 100 ? `${usagePercent.toFixed(1)}% used` : "Budget exhausted"}
									</span>
									<span className="text-muted-foreground">Limit: ${vk.budget_limit.toFixed(2)}</span>
								</div>
							</div>
						)}
					</div>

					{/* Budget limit */}
					<div className="space-y-2">
						<Label htmlFor="vk-budget">Budget Limit (USD)</Label>
						<Input
							id="vk-budget"
							type="number"
							min="0"
							step="0.01"
							placeholder="100.00 (leave empty for no limit)"
							{...register("budget_limit", {
								setValueAs: (v: string) => (v === "" ? undefined : parseFloat(v)),
							})}
						/>
						{errors.budget_limit && <p className="text-destructive text-xs">{errors.budget_limit.message}</p>}
						<p className="text-muted-foreground text-xs">Set to 0 or leave empty for unlimited budget.</p>
					</div>

					{/* Budget reset duration */}
					<div className="space-y-2">
						<Label htmlFor="vk-reset-duration">Budget Reset Duration (optional)</Label>
						<Select
							onValueChange={(value) => {
								const form = document.querySelector("form") as HTMLFormElement;
								if (form) {
									const input = form.querySelector("[name='budget_reset_duration']") as HTMLInputElement;
									if (input) {
										input.value = value;
									}
								}
							}}
							defaultValue={vk.budget_reset_duration || ""}
						>
							<SelectTrigger id="vk-reset-duration">
								<SelectValue placeholder="Select reset period (e.g., '1M' for monthly)" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="">No reset (one-time budget)</SelectItem>
								<SelectItem value="1D">Daily</SelectItem>
								<SelectItem value="1W">Weekly</SelectItem>
								<SelectItem value="2W">Bi-weekly</SelectItem>
								<SelectItem value="1M">Monthly</SelectItem>
								<SelectItem value="3M">Quarterly</SelectItem>
								<SelectItem value="1Y">Yearly</SelectItem>
							</SelectContent>
						</Select>
						<input type="hidden" {...register("budget_reset_duration")} />
						<p className="text-muted-foreground text-xs">Examples: "1D" (daily), "1W" (weekly), "1M" (monthly)</p>
					</div>

					<DialogFooter className="gap-2">
						<Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={isLoading}>
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