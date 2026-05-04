import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePlatformCreateOrgTeamMutation } from "@/lib/platform/platformApi";

const createTeamSchema = z.object({
	name: z.string().min(1, "Team name is required").max(100),
});

type CreateTeamForm = z.infer<typeof createTeamSchema>;

interface CreateTeamDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	orgId: string;
	orgName: string;
	onCreated?: () => void;
}

export function CreateTeamDialog({ open, onOpenChange, orgId, orgName, onCreated }: CreateTeamDialogProps) {
	const [createTeam, { isLoading }] = usePlatformCreateOrgTeamMutation();

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<CreateTeamForm>({
		defaultValues: { name: "" },
	});

	const onSubmit = async (data: CreateTeamForm) => {
		try {
			await createTeam({
				org_id: orgId,
				name: data.name,
			}).unwrap();
			toast.success(`Team "${data.name}" created successfully`);
			handleClose(false);
			onCreated?.();
		} catch (err: unknown) {
			const message =
				(err as { data?: { message?: string } })?.data?.message || (err as { message?: string })?.message || "Failed to create team";
			toast.error(message);
		}
	};

	const handleClose = (value: boolean) => {
		if (!value) reset();
		onOpenChange(value);
	};

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-md" disableOutsideClick={false}>
				<DialogHeader>
					<DialogTitle>Create Team</DialogTitle>
					<DialogDescription>
						Create a new team within <strong>{orgName}</strong>. You can invite members and manage team resources after creation.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
					{/* Team name */}
					<div className="space-y-2">
						<Label htmlFor="team-name">Team Name</Label>
						<Input id="team-name" placeholder="e.g. Engineering, Product, ML Team" autoFocus {...register("name")} />
						{errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
					</div>

					<DialogFooter className="gap-2">
						<Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={isLoading}>
							Cancel
						</Button>
						<Button type="submit" disabled={isLoading}>
							{isLoading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Creating...
								</>
							) : (
								"Create Team"
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}