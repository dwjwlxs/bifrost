import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alertDialog";
import {
  PlatformTeamMember,
  usePlatformUpdateTeamMemberMutation,
  usePlatformRemoveTeamMemberMutation,
} from "@/lib/platform/platformApi";
import { TeamRoleAdmin, TeamRoleMember } from "@/lib/platform/types";

interface MemberActionsProps {
  member: PlatformTeamMember;
  teamId: string;
  currentUserId?: string;
  onRoleChanged?: () => void;
  onMemberRemoved?: () => void;
}

/**
 * Inline member actions — role select + remove button.
 * Renders nothing if the member is the last admin (safety guard).
 */
export function MemberActions({
  member,
  teamId,
  currentUserId,
  onRoleChanged,
  onMemberRemoved,
}: MemberActionsProps) {
  const [removeOpen, setRemoveOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"admin" | "member">(
    member.role === TeamRoleAdmin ? "admin" : "member",
  );
  const [isRoleLoading, setIsRoleLoading] = useState(false);

  const [updateMember] = usePlatformUpdateTeamMemberMutation();
  const [removeMember, { isLoading: isRemoving }] =
    usePlatformRemoveTeamMemberMutation();

  const isSelf = currentUserId && member.user_id === currentUserId;
  const isLastAdmin = member.role === TeamRoleAdmin;

  const handleRoleChange = async (newRole: "admin" | "member") => {
    if (newRole === selectedRole) return;
    setIsRoleLoading(true);
    try {
      await updateMember({
        team_id: teamId,
        user_id: member.user_id,
        role: newRole,
      }).unwrap();
      setSelectedRole(newRole);
      toast.success(`Role updated to ${newRole}`);
      onRoleChanged?.();
    } catch (err: unknown) {
      const message =
        (err as { data?: { message?: string } })?.data?.message ||
        (err as { message?: string })?.message ||
        "Failed to update role";
      toast.error(message);
    } finally {
      setIsRoleLoading(false);
    }
  };

  const handleRemove = async () => {
    try {
      await removeMember({
        team_id: teamId,
        user_id: member.user_id,
      }).unwrap();
      toast.success("Member removed from team");
      setRemoveOpen(false);
      onMemberRemoved?.();
    } catch (err: unknown) {
      const message =
        (err as { data?: { message?: string } })?.data?.message ||
        (err as { message?: string })?.message ||
        "Failed to remove member";
      toast.error(message);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Role select */}
      <Select
        value={selectedRole}
        onValueChange={(v) => handleRoleChange(v as "admin" | "member")}
        disabled={isRoleLoading || !!isSelf}
      >
        <SelectTrigger className="h-7 w-[120px] text-xs">
          {isRoleLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="member">Member</SelectItem>
        </SelectContent>
      </Select>

      {/* Remove button */}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground h-7 px-2 text-xs hover:text-destructive"
        onClick={() => setRemoveOpen(true)}
        disabled={!!isSelf}
        title={!isSelf ? "Remove member" : "Cannot remove yourself"}
      >
        Remove
      </Button>

      {/* Remove confirmation */}
      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {member.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              {member.username} ({member.email}) will be removed from this
              team. They will lose access to team resources.{" "}
              {isLastAdmin && (
                <span className="font-medium text-destructive">
                  This is the last admin — removing them may leave the team
                  unmanaged.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={isRemoving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRemoving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
