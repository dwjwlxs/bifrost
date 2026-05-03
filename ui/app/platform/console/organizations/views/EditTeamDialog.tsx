import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PlatformTeam,
  usePlatformUpdateTeamMutation,
} from "@/lib/platform/platformApi";

const editTeamSchema = z.object({
  name: z.string().min(1, "Team name is required").max(100),
  budget_limit: z
    .number()
    .min(0, "Budget must be non-negative")
    .max(9999999, "Budget too large")
    .optional(),
});

type EditTeamForm = z.infer<typeof editTeamSchema>;

interface EditTeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: PlatformTeam;
  onUpdated?: () => void;
}

export function EditTeamDialog({
  open,
  onOpenChange,
  team,
  onUpdated,
}: EditTeamDialogProps) {
  const [updateTeam, { isLoading }] = usePlatformUpdateTeamMutation();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditTeamForm>({
    defaultValues: {
      name: team.name ?? "",
      budget_limit: team.budget_limit ?? undefined,
    },
  });

  const onSubmit = async (data: EditTeamForm) => {
    try {
      await updateTeam({
        id: team.id,
        name: data.name,
        budget_limit: data.budget_limit,
      }).unwrap();
      toast.success("Team updated successfully");
      handleClose(false);
      onUpdated?.();
    } catch (err: unknown) {
      const message =
        (err as { data?: { message?: string } })?.data?.message ||
        (err as { message?: string })?.message ||
        "Failed to update team";
      toast.error(message);
    }
  };

  const handleClose = (value: boolean) => {
    if (!value) reset();
    onOpenChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Team</DialogTitle>
          <DialogDescription>
            Update team <strong>{team.name || team.id}</strong>. Changes will
            apply immediately.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Team name */}
          <div className="space-y-2">
            <Label htmlFor="team-name">Team Name</Label>
            <Input
              id="team-name"
              placeholder="e.g. Engineering, Product"
              autoFocus
              {...register("name")}
            />
            {errors.name && (
              <p className="text-destructive text-xs">{errors.name.message}</p>
            )}
          </div>

          {/* Budget limit */}
          <div className="space-y-2">
            <Label htmlFor="team-budget">Team Budget Limit (USD)</Label>
            <Input
              id="team-budget"
              type="number"
              min="0"
              step="0.01"
              placeholder="Leave empty for no team-wide budget"
              {...register("budget_limit", {
                setValueAs: (v: string) =>
                  v === "" ? undefined : parseFloat(v),
              })}
            />
            {errors.budget_limit && (
              <p className="text-destructive text-xs">
                {errors.budget_limit.message}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              This is a team-wide budget cap. Individual VK budgets are
              independent.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={isLoading}
            >
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
