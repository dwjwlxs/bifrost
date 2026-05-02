/**
 * Organization Detail Page
 * Route: /platform/console/organizations/:orgId
 * Shows org profile, members, and teams.
 * Requires: org_admin (customer_owner) role for this org.
 */
import { useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import {
	usePlatformGetOrgQuery,
	usePlatformListOrgMembersQuery,
	usePlatformListOrgTeamsQuery,
	usePlatformCreateOrgTeamMutation,
	usePlatformUpdateTeamMutation,
} from "@/lib/platform/platformApi";
import { useIsOrgAdmin } from "@/lib/platform/hooks";
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
	Building2,
	Users,
	UsersRound,
	Plus,
	Trash2,
	Loader2,
	ShieldCheck,
	Shield,
} from "lucide-react";
import { toast } from "sonner";

export default function OrganizationDetailPage() {
	const params = useParams({ strict: false }) as { orgId?: string };
	const orgId = params.orgId;
	const navigate = useNavigate();
	const isAdmin = useIsOrgAdmin(orgId);

	const { data: org, isLoading: orgLoading } = usePlatformGetOrgQuery(orgId!);
	const { data: members, isLoading: membersLoading } = usePlatformListOrgMembersQuery(orgId!);
	const { data: teams, isLoading: teamsLoading } = usePlatformListOrgTeamsQuery(orgId!);

	const [createTeamOpen, setCreateTeamOpen] = useState(false);
	const [newTeamName, setNewTeamName] = useState("");
	const [createTeam, { isLoading: isCreating }] = usePlatformCreateOrgTeamMutation();
	const [deleteTeam] = usePlatformUpdateTeamMutation(); // teams are deleted by setting a flag; reuse update for now

	const handleCreateTeam = async () => {
		if (!newTeamName.trim() || !orgId) {
			toast.error("Team name is required");
			return;
		}
		try {
			await createTeam({ org_id: orgId, name: newTeamName.trim() }).unwrap();
			toast.success("Team created");
			setCreateTeamOpen(false);
			setNewTeamName("");
		} catch (err) {
			toast.error("Failed to create team");
		}
	};

	if (!orgId) {
		return (
			<div className="p-8">
				<p className="text-muted-foreground">Invalid organization ID.</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Back + Header */}
			<div className="flex items-center gap-4">
				<Button variant="ghost" size="sm" onClick={() => navigate({ to: "/platform/console/organizations" })}>
					<ArrowLeft className="mr-1.5 h-4 w-4" />
					Organizations
				</Button>
			</div>

			{orgLoading ? (
				<div className="flex items-center justify-center py-20">
					<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
				</div>
			) : org ? (
				<>
					{/* Org Header Card */}
					<Card>
						<CardHeader>
							<div className="flex items-center gap-3">
								<div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-lg">
									<Building2 className="text-primary h-5 w-5" />
								</div>
								<div>
									<CardTitle className="text-xl">{org.name}</CardTitle>
									<CardDescription>Organization ID: {org.id}</CardDescription>
								</div>
								{isAdmin && (
									<Badge variant="default" className="ml-auto">
										<ShieldCheck className="mr-1 h-3.5 w-3.5" />
										Admin
									</Badge>
								)}
							</div>
						</CardHeader>
						<CardContent>
							<div className="flex gap-8 text-sm">
								<div>
									<span className="text-muted-foreground">Owner ID: </span>
									<span className="font-mono">{org.owner_user_id ?? "—"}</span>
								</div>
								{org.created_at && (
									<div>
										<span className="text-muted-foreground">Created: </span>
										{new Date(org.created_at).toLocaleDateString()}
									</div>
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
							<TabsTrigger value="teams">
								<UsersRound className="mr-1.5 h-4 w-4" />
								Teams ({teams?.length ?? 0})
							</TabsTrigger>
						</TabsList>

						{/* Members Tab */}
						<TabsContent value="members">
							<Card>
								<CardHeader>
									<CardTitle>Organization Members</CardTitle>
									<CardDescription>
										Members belong to this organization. To invite new members, create a team and invite
										through the team.
									</CardDescription>
								</CardHeader>
								<CardContent>
									{membersLoading ? (
										<div className="flex items-center justify-center py-10">
											<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
										</div>
									) : members?.length === 0 ? (
										<p className="text-muted-foreground py-8 text-center text-sm">
											No members found.
										</p>
									) : (
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Email</TableHead>
													<TableHead>Username</TableHead>
													<TableHead>Role</TableHead>
													<TableHead>Joined</TableHead>
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
														<TableCell className="text-muted-foreground text-sm">
															{member.joined_at
																? new Date(member.joined_at).toLocaleDateString()
																: "—"}
														</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									)}
								</CardContent>
							</Card>
						</TabsContent>

						{/* Teams Tab */}
						<TabsContent value="teams">
							<Card>
								<CardHeader>
									<div className="flex items-center justify-between">
										<div>
											<CardTitle>Teams</CardTitle>
											<CardDescription>Teams within this organization.</CardDescription>
										</div>
										{isAdmin && (
											<Dialog open={createTeamOpen} onOpenChange={setCreateTeamOpen}>
												<DialogTrigger asChild>
													<Button size="sm">
														<Plus className="mr-1.5 h-4 w-4" />
														New Team
													</Button>
												</DialogTrigger>
												<DialogContent className="sm:max-w-[400px]">
													<DialogHeader>
														<DialogTitle>Create Team</DialogTitle>
													</DialogHeader>
													<div className="grid gap-4 py-4">
														<div className="grid gap-2">
															<Label htmlFor="team-name">Team Name</Label>
															<Input
																id="team-name"
																placeholder="Engineering"
																value={newTeamName}
																onChange={(e) => setNewTeamName(e.target.value)}
																onKeyDown={(e) => {
																	if (e.key === "Enter") handleCreateTeam();
																}}
															/>
														</div>
													</div>
													<DialogFooter>
														<Button
															variant="outline"
															onClick={() => setCreateTeamOpen(false)}
															disabled={isCreating}
														>
															Cancel
														</Button>
														<Button
															onClick={handleCreateTeam}
															disabled={isCreating || !newTeamName.trim()}
														>
															{isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
															Create
														</Button>
													</DialogFooter>
												</DialogContent>
											</Dialog>
										)}
									</div>
								</CardHeader>
								<CardContent>
									{teamsLoading ? (
										<div className="flex items-center justify-center py-10">
											<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
										</div>
									) : teams?.length === 0 ? (
										<p className="text-muted-foreground py-8 text-center text-sm">
											No teams in this organization.
										</p>
									) : (
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Name</TableHead>
													<TableHead>ID</TableHead>
													<TableHead>Owner</TableHead>
													<TableHead>Budget</TableHead>
													{isAdmin && <TableHead className="text-right">Actions</TableHead>}
												</TableRow>
											</TableHeader>
											<TableBody>
												{teams?.map((team) => (
													<TableRow key={team.id}>
														<TableCell
															className="font-medium cursor-pointer hover:underline"
															onClick={() =>
																		navigate({
																			to: "/platform/console/teams/$teamId",
																			params: { teamId: team.id },
																		})
																	}
														>
															{team.name}
														</TableCell>
														<TableCell className="font-mono text-sm">{team.id}</TableCell>
														<TableCell className="text-muted-foreground text-sm">
															{team.owner_user_id ?? "—"}
														</TableCell>
														<TableCell className="text-muted-foreground text-sm">
															{team.budget_limit != null
																? `$${team.budget_limit.toFixed(2)}`
																: "—"}
														</TableCell>
														{isAdmin && (
															<TableCell className="text-right">
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
																			<AlertDialogTitle>Delete Team</AlertDialogTitle>
																			<AlertDialogDescription>
																				Are you sure you want to delete &quot;{team.name}&quot;? This
																				action cannot be undone.
																			</AlertDialogDescription>
																		</AlertDialogHeader>
																		<AlertDialogFooter>
																			<AlertDialogCancel>Cancel</AlertDialogCancel>
																			<AlertDialogAction className="bg-destructive hover:bg-destructive/90">
																				Delete
																			</AlertDialogAction>
																		</AlertDialogFooter>
																	</AlertDialogContent>
																</AlertDialog>
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
					</Tabs>
				</>
			) : (
				<div className="py-20 text-center">
					<p className="text-muted-foreground">Organization not found.</p>
				</div>
			)}
		</div>
	);
}
