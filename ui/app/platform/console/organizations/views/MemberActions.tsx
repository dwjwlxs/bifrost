import { useState } from "react";
import { Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PlatformTeamMember, usePlatformUpdateTeamMemberMutation, usePlatformRemoveTeamMemberMutation } from "@/lib/platform/platformApi";
import { TeamRoleAdmin, TeamRoleMember } from "@/lib/platform/types";

interface MemberActionsProps {
	member: PlatformTeamMember;
	teamId: string;
	currentUserId?: string;
	onRoleChanged?: () => void;
	onMemberRemoved?: () => void;
}

/**
 * Member row actions — edit role (icon + dialog) + remove (icon + alert).
 * Renders nothing if the member is the current user.
 */
export function MemberActions({ member, teamId, currentUserId, onRoleChanged, onMemberRemoved }: MemberActionsProps) {
	const [editRoleOpen, setEditRoleOpen] = useState(false);
	const [removeOpen, setRemoveOpen] = useState(false);
	const [selectedRole, setSelectedRole] = useState<"admin" | "member">(member.role === TeamRoleAdmin ? "admin" : "member");
	const [isRoleLoading, setIsRoleLoading] = useState(false);

	const [updateMember] = usePlatformUpdateTeamMemberMutation();
	const [removeMember, { isLoading: isRemoving }] = usePlatformRemoveTeamMemberMutation();

	const isSelf = currentUserId && member.user_id === currentUserId;
	const isLastAdmin = member.role === TeamRoleAdmin;

	const handleEditRoleOpen = (open: boolean) => {
		if (open) {
			// Reset to current role when opening
			setSelectedRole(member.role === TeamRoleAdmin ? "admin" : "member");
		}
		setEditRoleOpen(open);
	};

	const handleRoleChange = async () => {
		if (selectedRole === (member.role === TeamRoleAdmin ? "admin" : "member")) {
			setEditRoleOpen(false);
			return;
		}
		setIsRoleLoading(true);
		try {
			await updateMember({
				team_id: teamId,
				user_id: member.user_id,
				role: selectedRole,
			}).unwrap();
			toast.success(`Role updated to ${selectedRole}`);
			setEditRoleOpen(false);
			onRoleChanged?.();
		} catch (err: unknown) {
			const message =
				(err as { data?: { message?: string } })?.data?.message || (err as { message?: string })?.message || "Failed to update role";
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
				(err as { data?: { message?: string } })?.data?.message || (err as { message?: string })?.message || "Failed to remove member";
			toast.error(message);
		}
	};

	if (isSelf) return null;

	return (
		<TooltipProvider>
			<div className="flex items-center gap-1">
				{/* Edit role — icon button + dialog */}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="text-muted-foreground hover:text-foreground h-7 w-7"
							onClick={() => handleEditRoleOpen(true)}
						>
							<Pencil className="h-3.5 w-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Change role</TooltipContent>
				</Tooltip>

				<Dialog open={editRoleOpen} onOpenChange={handleEditRoleOpen}>
					<DialogContent className="sm:max-w-md" disableOutsideClick={false}>
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<Pencil className="h-5 w-5" />
								Change Role
							</DialogTitle>
							<DialogDescription>Update the role for {member.username || member.email || member.user_id} in this team.</DialogDescription>
						</DialogHeader>

						<div className="space-y-2">
							<Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as "admin" | "member")} disabled={isRoleLoading}>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="member">Member — read-only access to team resources</SelectItem>
									<SelectItem value="admin">Admin — can manage members and virtual keys</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<DialogFooter className="gap-2">
							<Button type="button" variant="outline" onClick={() => setEditRoleOpen(false)} disabled={isRoleLoading}>
								Cancel
							</Button>
							<Button type="button" onClick={handleRoleChange} disabled={isRoleLoading}>
								{isRoleLoading ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Saving...
									</>
								) : (
									"Save"
								)}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				{/* Remove — icon button + alert confirmation */}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="text-muted-foreground hover:text-destructive h-7 w-7"
							onClick={() => setRemoveOpen(true)}
						>
							<Trash2 className="h-3.5 w-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Remove member</TooltipContent>
				</Tooltip>

				<AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Remove {member.username || member.email || "member"}?</AlertDialogTitle>
							<AlertDialogDescription>
								{member.username && member.email ? `${member.username} (${member.email})` : member.email || member.user_id} will be removed
								from this team. They will lose access to team resources.{" "}
								{isLastAdmin && (
									<span className="text-destructive font-medium">This is the last admin — removing them may leave the team unmanaged.</span>
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
		</TooltipProvider>
	);
}