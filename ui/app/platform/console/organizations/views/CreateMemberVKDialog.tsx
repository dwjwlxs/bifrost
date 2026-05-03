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
  PlatformTeamMember,
  usePlatformCreateVKMutation,
} from "@/lib/platform/platformApi";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const createVkSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  user_id: z.string().optional(),
  budget_limit: z
    .number()
    .min(0, "Budget must be non-negative")
    .max(9999999, "Budget too large")
    .optional(),
  budget_reset_duration: z.string().max(50).optional(),
});

type CreateVkForm = z.infer<typeof createVkSchema>;

interface CreateMemberVKDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  teamName: string;
  members: PlatformTeamMember[];
  onCreated?: () => void;
}

/**
 * Dialog for team_admin to create a VK within their team.
 * The VK is created for the current admin (team_id is set on creation).
 * Members are listed for reference only — backend controls VK ownership.
 */
export function CreateMemberVKDialog({
  open,
  onOpenChange,
  teamId,
  teamName,
  members,
  onCreated,
}: CreateMemberVKDialogProps) {
  const [createVK, { isLoading }] = usePlatformCreateVKMutation();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateVkForm>({
    defaultValues: {
      name: "",
      description: "",
      user_id: "",
      budget_limit: undefined,
      budget_reset_duration: undefined,
    },
  });

  const onSubmit = async (data: CreateVkForm) => {
    try {
      await createVK({
        name: data.name,
        description: data.description,
        team_id: teamId,
        user_id: data.user_id && data.user_id !== "" ? data.user_id : undefined,
        budget_limit: data.budget_limit,
        budget_reset_duration: data.budget_reset_duration && data.budget_reset_duration !== "" ? data.budget_reset_duration : undefined,
      }).unwrap();
      toast.success("Virtual key created successfully");
      handleClose(false);
      onCreated?.();
    } catch (err: unknown) {
      const message =
        (err as { data?: { message?: string } })?.data?.message ||
        (err as { message?: string })?.message ||
        "Failed to create VK";
      toast.error(message);
    }
  };

  const handleClose = (value: boolean) => {
    if (!value) {
      reset();
    }
    onOpenChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Virtual Key</DialogTitle>
          <DialogDescription>
            Create a new virtual key for {teamName}. The key will be bound to
            this team. You can assign it to a team member and set budget limits.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Members reference */}
          {members.length > 0 && (
            <div className="rounded-md bg-muted/50 p-3">
              <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                Team Members ({members.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => (
                  <span
                    key={m.user_id}
                    className="bg-background rounded-full px-2 py-0.5 text-xs"
                  >
                    {m.username}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* User selection for team_admin */}
          <div className="space-y-2">
            <Label htmlFor="vk-user">Assign to Member (optional)</Label>
            <Select
              onValueChange={(value) => {
                // 使用 react-hook-form 的 register 处理值
                const form = (document.querySelector("form") as HTMLFormElement);
                if (form) {
                  const input = form.querySelector("[name='user_id']") as HTMLInputElement;
                  if (input) {
                    input.value = value;
                  }
                }
              }}
              defaultValue=""
            >
              <SelectTrigger id="vk-user">
                <SelectValue placeholder="Select a team member (defaults to current user)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Current User (Team Admin)</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.username} {m.role && `(${m.role})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              type="hidden"
              {...register("user_id")}
            />
            <p className="text-muted-foreground text-xs">
              Leave empty to create VK for the current team admin
            </p>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="vk-name">Name</Label>
            <Input
              id="vk-name"
              placeholder="Production Key"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-destructive text-xs">{errors.name.message}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="vk-desc">Description (optional)</Label>
            <Input
              id="vk-desc"
              placeholder="Used for production API calls"
              {...register("description")}
            />
            {errors.description && (
              <p className="text-destructive text-xs">
                {errors.description.message}
              </p>
            )}
          </div>

          {/* Budget limit */}
          <div className="space-y-2">
            <Label htmlFor="vk-budget">Budget Limit (USD, optional)</Label>
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
            {errors.budget_limit && (
              <p className="text-destructive text-xs">
                {errors.budget_limit.message}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Set to 0 or leave empty for unlimited budget
            </p>
          </div>

          {/* Budget reset duration */}
          <div className="space-y-2">
            <Label htmlFor="vk-reset-duration">Budget Reset Duration (optional)</Label>
            <Select
              onValueChange={(value) => {
                const form = (document.querySelector("form") as HTMLFormElement);
                if (form) {
                  const input = form.querySelector("[name='budget_reset_duration']") as HTMLInputElement;
                  if (input) {
                    input.value = value;
                  }
                }
              }}
              defaultValue=""
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
            <input
              type="hidden"
              {...register("budget_reset_duration")}
            />
            <p className="text-muted-foreground text-xs">
              Examples: "1D" (daily), "1W" (weekly), "1M" (monthly)
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
                  Creating...
                </>
              ) : (
                "Create VK"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
