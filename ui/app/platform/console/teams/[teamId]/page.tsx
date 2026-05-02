/**
 * Team Detail Page
 * Route: /platform/console/teams/:teamId
 * Shows team profile, members, and VKs.
 * Requires: team_member (read) or team_admin (write) role.
 */
import { useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import {
	usePlatformGetTeamQuery,
	usePlatformListTeamMembersQuery,
	usePlatformInviteTeamMemberMutation,
	usePlatformRemoveTeamMemberMutation,
	usePlatformUpdateTeamMemberMutation,
	usePlatformListTeamVKsQuery,
	usePlatformUpdateTeamMutation,
} from "@/lib/platform/platformApi";
import { useIsTeamAdmin } from "@/lib/platform/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alertDialog";
import {
	ArrowLeft,
	UsersRound,
	KeyRound,
	Users,
	Plus,
	Trash2,
	Loader2,
	Shield,
	Copy,
	Eye,
	EyeOff,
} from "lucide-react";
import { toast } from "sonner";

export default function TeamDetailPage() {
	const params = useParams({ strict: false }) as { teamId?: string };
	const teamId = params.teamId;
	const navigate = useNavigate();
	const isAdmin = useIsTeamAdmin(teamId);

	const { data: team, isLoading: teamLoading } = usePlatformGetTeamQuery(teamId!);
	const { data: members, isLoading: membersLoading } = usePlatformListTeamMembersQuery(teamId!);
	const { data: vks, isLoading: vksLoading } = usePlatformListTeamVKsQuery(teamId!);

	const [inviteOpen, setInviteOpen] = useState(false);
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
	const [inviteTeamMember, { isLoading: isInviting }] = usePlatformInviteTeamMemberMutation();

	const [removeTeamMember] = usePlatformRemoveTeamMemberMutation();
	const [updateTeamMember] = usePlatformUpdateTeamMemberMutation();
	const [updateTeam] = usePlatformUpdateTeamMutation();

	const [budgetOpen, setBudgetOpen] = useState(false);
	const [budgetLimit, setBudgetLimit] = useState("");

	const handleInvite = async () => {
		if (!inviteEmail.trim() || !teamId) {
			toast.error("Email is required");
			return;
		}
		try {
			await inviteTeamMember({
				team_id: teamId,
				email: inviteEmail.trim(),
				role: inviteRole,
			}).unwrap();
			toast.success(`Invitation sent to ${inviteEmail}`);
			setInviteOpen(false);
			setInviteEmail("");
			setInviteRole("member");
		} catch (err) {
			toast.error("Failed to send invitation");
		}
	};

	const handleRemoveMember = async (userId: string) => {
		if (!teamId) return;
		try {
			await removeTeamMember({ team_id: teamId, user_id: userId }).unwrap();
			toast.success("Member removed");
		} catch (err) {
			toast.error("Failed to remove member");
		}
	};

	const handleUpdateMemberRole = async (userId: string, role: "admin" | "member") => {
		if (!teamId) return;
		try {
			await updateTeamMember({ team_id: teamId, user_id: userId, role }).unwrap();
			toast.success("Member role updated");
		} catch (err) {
			toast.error("Failed to update member role");
		}
	};

	const openBudgetDialog = () => {
		setBudgetLimit(team?.budget_limit?.toString() ?? "");
		setBudgetOpen(true);
	};

	const handleUpdateBudget = async () => {
		if (!teamId) return;
		const limit = parseFloat(budgetLimit);
		if (isNaN(limit) || limit < 0) {
			toast.error("Invalid budget amount");
			return;
		}
		try {
			await updateTeam({ id: teamId, budget_limit: limit }).unwrap();
			toast.success("Budget updated");
			setBudgetOpen(false);
		} catch (err) {
			toast.error("Failed to update budget");
		}
	};

	const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
	const toggleKeyVisibility = (vkId: string) => {
		setShowKeys((prev) => ({ ...prev, [vkId]: !prev[vkId] }));
	};
	const maskKey = (value: string, revealed: boolean) => {
		if (revealed) return value;
		if (value.length <= 8) return "•".repeat(value.length);
		return value.substring(0, 8) + "•".repeat(Math.max(0, value.length - 8));
	};
	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text).then(
			() => toast.success("Key copied to clipboard"),
			() => toast.error("Failed to copy key"),
		);
	};

	if (!teamId) {
		return (
			<div className="p-8">
				<p className="text-muted-foreground">Invalid team ID.</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Back + Header */}
			<div className="flex items-center gap-4">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => navigate({ to: "/platform/console/organizations" })}
				>
					<ArrowLeft className="mr-1.5 h-4 w-4" />
					Organizations
				</Button>
			</div>

			{teamLoading ? (
				<div className="flex items-center justify-center py-20">
					<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
				</div>
			) : team ? (
				<>
					{/* Team Header Card */}
					<Card>
						<CardHeader>
							<div className="flex items-center gap-3">
								<div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-lg">
									<UsersRound className="text-primary h-5 w-5" />
								</div>
								<div>
									<CardTitle className="text-xl">{team.name}</CardTitle>
									<CardDescription>Team ID: {team.id}</CardDescription>
								</div>
								{isAdmin && (
									<Badge variant="default" className="ml-auto">
										<Shield className="mr-1 h-3.5 w-3.5" />
										Admin
									</Badge>
								)}
							</div>
						</CardHeader>
						<CardContent>
							<div className="flex flex-wrap gap-8 text-sm">
								{team.customer_id && (
									<div>
										<span className="text-muted-foreground">Organization: </span>
										<Button
											variant="link"
											className="h-auto p-0 text-sm"
											onClick={() =>
												navigate({
													to: "/platform/console/organizations/$orgId",
													params: { orgId: team.customer_id! },
												})
											}
										>
											{team.customer_id}
										</Button>
									</div>
								)}
								{team.budget_limit != null && (
									<div>
										<span className="text-muted-foreground">Budget: </span>
										<span className="font-medium">${team.budget_limit.toFixed(2)}</span>
									</div>
								)}
								{team.budget_spent != null && (
									<div>
										<span className="text-muted-foreground">Spent: </span>
										<span className="font-medium">${team.budget_spent.toFixed(2)}</span>
									</div>
								)}
								{team.owner_user_id && (
									<div>
										<span className="text-muted-foreground">Owner: </span>
										<span className="font-mono text-xs">{team.owner_user_id}</span>
									</div>
								)}
								{isAdmin && (
									<Button variant="outline" size="sm" onClick={openBudgetDialog}>
										Set Budget
									</Button>
								)}
							</div>
						</CardContent>
					</Card>

					{/* Tabs */}
					<Tabs defaultValue="members">
						<TabsList>
							<TabsTrigger value="members">
								<Users className="mr-1.5 h-4 w-4" />
								Members ({members?.length ?? 0})
							</TabsTrigger>
							<TabsTrigger value="keys">
								<KeyRound className="mr-1.5 h-4 w-4" />
								Virtual Keys ({vks?.length ?? 0})
							</TabsTrigger>
						</TabsList>

						{/* Members Tab */}
						<TabsContent value="members">
							<Card>
								<CardHeader>
									<div className="flex items-center justify-between">
										<div>
											<CardTitle>Team Members</CardTitle>
											<CardDescription>Members of this team and their roles.</CardDescription>
										</div>
										{isAdmin && (
											<Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
												<DialogTrigger asChild>
													<Button size="sm">
														<Plus className="mr-1.5 h-4 w-4" />
														Invite
													</Button>
												</DialogTrigger>
												<DialogContent className="sm:max-w-[400px]">
													<DialogHeader>
														<DialogTitle>Invite Team Member</DialogTitle>
													</DialogHeader>
													<div className="grid gap-4 py-4">
														<div className="grid gap-2">
															<Label htmlFor="invite-email">Email</Label>
															<Input
																id="invite-email"
																type="email"
																placeholder="colleague@example.com"
																value={inviteEmail}
																onChange={(e) => setInviteEmail(e.target.value)}
																onKeyDown={(e) => {
																	if (e.key === "Enter") handleInvite();
																}}
															/>
														</div>
														<div className="grid gap-2">
															<Label htmlFor="invite-role">Role</Label>
															<select
																id="invite-role"
																className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
																value={inviteRole}
																onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
															>
																<option value="member">Member</option>
																<option value="admin">Admin</option>
															</select>
														</div>
													</div>
													<DialogFooter>
														<Button
															variant="outline"
															onClick={() => setInviteOpen(false)}
															disabled={isInviting}
														>
															Cancel
														</Button>
														<Button onClick={handleInvite} disabled={isInviting || !inviteEmail.trim()}>
															{isInviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
															Send Invite
														</Button>
													</DialogFooter>
												</DialogContent>
											</Dialog>
										)}
									</div>
								</CardHeader>
								<CardContent>
									{membersLoading ? (
										<div className="flex items-center justify-center py-10">
											<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
										</div>
									) : members?.length === 0 ? (
										<p className="text-muted-foreground py-8 text-center text-sm">No members found.</p>
									) : (
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Email</TableHead>
													<TableHead>Username</TableHead>
													<TableHead>Role</TableHead>
													{isAdmin && <TableHead className="text-right">Actions</TableHead>}
												</TableRow>
											</TableHeader>
											<TableBody>
												{members?.map((member) => (
													<TableRow key={member.user_id}>
														<TableCell className="text-sm">{member.email}</TableCell>
														<TableCell className="font-medium">{member.username}</TableCell>
														<TableCell>
															<Badge variant={member.role === "admin" ? "default" : "secondary"}>
																{member.role}
															</Badge>
														</TableCell>
														{isAdmin && (
															<TableCell className="text-right">
																<div className="flex items-center justify-end gap-1">
																	{/* Role toggle */}
																	<Button
																		variant="ghost"
																		size="sm"
																		className="h-8 px-2 text-xs"
																		onClick={() =>
																			handleUpdateMemberRole(
																				member.user_id,
																				member.role === "admin" ? "member" : "admin",
																			)
																		}
																		title={`Make ${member.role === "admin" ? "member" : "admin"}`}
																	>
																		{member.role === "admin" ? "→ Member" : "→ Admin"}
																	</Button>
																	<AlertDialog>
																		<AlertDialogTrigger asChild>
																			<Button
																				variant="ghost"
																				size="sm"
																				className="text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
																			>
																				<Trash2 className="h-4 w-4" />
																			</Button>
																		</AlertDialogTrigger>
																		<AlertDialogContent>
																			<AlertDialogHeader>
																				<AlertDialogTitle>Remove Member</AlertDialogTitle>
																				<AlertDialogDescription>
																					Remove &quot;{member.email}&quot; from this team? They can be
																					re-invited later.
																				</AlertDialogDescription>
																			</AlertDialogHeader>
																			<AlertDialogFooter>
																				<AlertDialogCancel>Cancel</AlertDialogCancel>
																				<AlertDialogAction
																					onClick={() => handleRemoveMember(member.user_id)}
																					className="bg-destructive hover:bg-destructive/90"
																				>
																					Remove
																				</AlertDialogAction>
																			</AlertDialogFooter>
																		</AlertDialogContent>
																	</AlertDialog>
																</div>
															</TableCell>
														)}
													</TableRow>
												))}
											</TableBody>
										</Table>
									)}
								</CardContent>
							</Card>
						</TabsContent>

						{/* VKs Tab */}
						<TabsContent value="keys">
							<Card>
								<CardHeader>
									<CardTitle>Team Virtual Keys</CardTitle>
									<CardDescription>
										Virtual keys created for this team.
									</CardDescription>
								</CardHeader>
								<CardContent>
									{vksLoading ? (
										<div className="flex items-center justify-center py-10">
											<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
										</div>
									) : vks?.length === 0 ? (
										<p className="text-muted-foreground py-8 text-center text-sm">
											No virtual keys for this team.
										</p>
									) : (
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Name</TableHead>
													<TableHead>Key</TableHead>
													<TableHead>Budget</TableHead>
													<TableHead>Usage</TableHead>
													<TableHead>Status</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{vks?.map((vk) => {
													const isRevealed = showKeys[vk.id] ?? false;
													return (
														<TableRow key={vk.id}>
															<TableCell className="font-medium">{vk.name}</TableCell>
															<TableCell>
																<div className="flex items-center gap-1.5">
																	<code className="bg-muted inline-block max-w-[180px] truncate rounded px-1.5 py-0.5 font-mono text-xs">
																		{maskKey(vk.value, isRevealed)}
																	</code>
																	<Button
																		variant="ghost"
																		size="sm"
																		className="h-6 w-6 p-0"
																		onClick={() => toggleKeyVisibility(vk.id)}
																	>
																		{isRevealed ? (
																			<EyeOff className="h-3 w-3" />
																		) : (
																			<Eye className="h-3 w-3" />
																		)}
																	</Button>
																	<Button
																		variant="ghost"
																		size="sm"
																		className="h-6 w-6 p-0"
																		onClick={() => copyToClipboard(vk.value)}
																	>
																		<Copy className="h-3 w-3" />
																	</Button>
																</div>
															</TableCell>
															<TableCell className="text-muted-foreground text-sm">
																{vk.budget_limit != null ? (
																	<>${vk.budget_limit.toFixed(2)}</>
																) : (
																	"∞"
																)}
															</TableCell>
															<TableCell className="text-muted-foreground text-sm">
																{vk.current_usage != null ? (
																	<>${vk.current_usage.toFixed(4)}</>
																) : (
																	"—"
																)}
															</TableCell>
															<TableCell>
																<Badge variant={vk.is_active ? "default" : "secondary"}>
																	{vk.is_active ? "Active" : "Inactive"}
																</Badge>
											</TableCell>
										</TableRow>
									);
								})}
											</TableBody>
										</Table>
									)}
								</CardContent>
							</Card>
						</TabsContent>
					</Tabs>
				</>
			) : (
				<div className="py-20 text-center">
					<p className="text-muted-foreground">Team not found.</p>
				</div>
			)}

			{/* Budget Dialog */}
			<Dialog open={budgetOpen} onOpenChange={setBudgetOpen}>
				<DialogContent className="sm:max-w-[360px]">
					<DialogHeader>
						<DialogTitle>Set Team Budget</DialogTitle>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="budget-limit">Monthly Budget Limit (USD)</Label>
							<Input
								id="budget-limit"
								type="number"
								min="0"
								step="0.01"
								placeholder="100.00"
								value={budgetLimit}
								onChange={(e) => setBudgetLimit(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleUpdateBudget();
								}}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setBudgetOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleUpdateBudget}>Save Budget</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
