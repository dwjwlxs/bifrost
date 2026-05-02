import { useState } from "react";
import {
	usePlatformListUsersQuery,
	usePlatformSetUserRoleMutation,
	usePlatformAdminListOrgsQuery,
	usePlatformAdminCreateOrgMutation,
	usePlatformAdminUpdateOrgMutation,
	usePlatformAdminDeleteOrgMutation,
	usePlatformListOrgTeamsQuery,
	type PlatformOrg,
} from "@/lib/platform/platformApi";
import { type PlatformUserInfo } from "@/lib/platform/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
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
import { Users, Building2, Search, Pencil, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

const ROLES = ["user", "admin"] as const;

const PAGE_SIZE = 20;

export default function AdminUsersPage() {
	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Users & Organizations</h1>
				<p className="text-muted-foreground">Manage platform users and organizations.</p>
			</div>

			<Tabs defaultValue="users">
				<TabsList>
					<TabsTrigger value="users" data-testid="admin-users-tab-users">
						Users
					</TabsTrigger>
					<TabsTrigger value="organizations" data-testid="admin-users-tab-orgs">
						Organizations
					</TabsTrigger>
				</TabsList>

				<TabsContent value="users">
					<UsersTab />
				</TabsContent>

				<TabsContent value="organizations">
					<OrganizationsTab />
				</TabsContent>
			</Tabs>
		</div>
	);
}

// ─── Users Tab ─────────────────────────────────────────────────────────────

function UsersTab() {
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const [roleDialogOpen, setRoleDialogOpen] = useState(false);
	const [editingUser, setEditingUser] = useState<PlatformUserInfo | null>(null);
	const [selectedRole, setSelectedRole] = useState<string>("");

	const { data, isLoading } = usePlatformListUsersQuery({
		search: search || undefined,
		limit: PAGE_SIZE,
		offset: page * PAGE_SIZE,
	});
	const [setUserRole, { isLoading: isSettingRole }] = usePlatformSetUserRoleMutation();

	const openRoleDialog = (user: PlatformUserInfo) => {
		setEditingUser(user);
		setSelectedRole(user.role ?? "user");
		setRoleDialogOpen(true);
	};

	const handleSetRole = async () => {
		if (!editingUser || !selectedRole) return;
		try {
			await setUserRole({ user_id: editingUser.id, role: selectedRole }).unwrap();
			toast.success(`Role updated for ${editingUser.username}`);
			setRoleDialogOpen(false);
		} catch (err) {
			toast.error("Failed to update user role");
		}
	};

	return (
		<>
			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<Search className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
					<Input
						placeholder="Search users by name or email..."
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							setPage(0);
						}}
						className="pl-8"
						data-testid="admin-users-search"
					/>
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Users className="h-5 w-5" />
						Users
					</CardTitle>
					<CardDescription>{data?.total ?? 0} total users</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex items-center justify-center py-10">
							<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
						</div>
					) : (
						<>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>ID</TableHead>
										<TableHead>Username</TableHead>
										<TableHead>Email</TableHead>
										<TableHead>Role</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Verified</TableHead>
										<TableHead>Joined</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{data?.items.length === 0 && (
										<TableRow>
											<TableCell colSpan={8} className="text-muted-foreground text-center">
												No users found.
											</TableCell>
										</TableRow>
									)}
									{data?.items.map((user) => (
										<TableRow key={user.id}>
											<TableCell className="font-mono text-sm">{user.id}</TableCell>
											<TableCell className="font-medium">{user.username}</TableCell>
											<TableCell className="text-sm">{user.email}</TableCell>
											<TableCell>
												<Badge
													variant={
														user.is_admin
															? "default"
															: user.role === "customer_owner"
																? "secondary"
																: "outline"
													}
												>
													{user.role ?? "user"}
												</Badge>
											</TableCell>
											<TableCell>
												<Badge variant={user.status === "active" ? "default" : "destructive"}>
													{user.status}
												</Badge>
											</TableCell>
											<TableCell>{user.is_email_verified ? "Yes" : "No"}</TableCell>
											<TableCell className="text-muted-foreground text-sm">
												{new Date(user.created_at).toLocaleDateString()}
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => openRoleDialog(user)}
													data-testid={`admin-users-edit-role-${user.id}`}
												>
													<Pencil className="h-4 w-4" />
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>

							{(data?.total ?? 0) > PAGE_SIZE && (
								<div className="flex items-center justify-between pt-4">
									<p className="text-muted-foreground text-sm">
										Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data?.total ?? 0)} of{" "}
										{data?.total}
									</p>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											disabled={page === 0}
											onClick={() => setPage(page - 1)}
										>
											Previous
										</Button>
										<Button
											variant="outline"
											size="sm"
											disabled={(page + 1) * PAGE_SIZE >= (data?.total ?? 0)}
											onClick={() => setPage(page + 1)}
										>
											Next
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>

			{/* Role Edit Dialog */}
			<Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Change User Role</DialogTitle>
						<DialogDescription>
							Update role for <span className="font-medium">{editingUser?.username}</span> (
							{editingUser?.email})
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label>Role</Label>
							<select
								className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
								value={selectedRole}
								onChange={(e) => setSelectedRole(e.target.value)}
								data-testid="admin-users-role-select"
							>
								{ROLES.map((role) => (
									<option key={role} value={role}>
										{role}
									</option>
								))}
							</select>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setRoleDialogOpen(false)} disabled={isSettingRole}>
							Cancel
						</Button>
						<Button onClick={handleSetRole} disabled={isSettingRole} data-testid="admin-users-role-submit">
							{isSettingRole && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							Update Role
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

// ─── Organizations Tab ────────────────────────────────────────────────────────

function OrganizationsTab() {
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const [createOpen, setCreateOpen] = useState(false);
	const [newOrgName, setNewOrgName] = useState("");
	const [editingOrg, setEditingOrg] = useState<PlatformOrg | null>(null);
	const [editOrgName, setEditOrgName] = useState("");

	const { data: orgsData, isLoading } = usePlatformAdminListOrgsQuery({
		search: search || undefined,
		limit: PAGE_SIZE,
		offset: page * PAGE_SIZE,
	});
	const [createOrg, { isLoading: isCreating }] = usePlatformAdminCreateOrgMutation();
	const [updateOrg, { isLoading: isUpdating }] = usePlatformAdminUpdateOrgMutation();
	const [deleteOrg] = usePlatformAdminDeleteOrgMutation();

	// Fetch teams per org for the teams column
	const [teamCounts, setTeamCounts] = useState<Record<string, number>>({});
	const [expandedOrg, setExpandedOrg] = useState<string | null>(null);

	const handleCreate = async () => {
		if (!newOrgName.trim()) {
			toast.error("Organization name is required");
			return;
		}
		try {
			await createOrg({ name: newOrgName.trim() }).unwrap();
			toast.success("Organization created");
			setCreateOpen(false);
			setNewOrgName("");
		} catch (err) {
			toast.error("Failed to create organization");
		}
	};

	const handleUpdate = async () => {
		if (!editingOrg || !editOrgName.trim()) return;
		try {
			await updateOrg({ id: editingOrg.id, name: editOrgName.trim() }).unwrap();
			toast.success("Organization updated");
			setEditingOrg(null);
		} catch (err) {
			toast.error("Failed to update organization");
		}
	};

	const handleDelete = async (orgId: string) => {
		try {
			await deleteOrg(orgId).unwrap();
			toast.success("Organization deleted");
		} catch (err) {
			toast.error("Failed to delete organization");
		}
	};

	const toggleExpand = async (orgId: string) => {
		if (expandedOrg === orgId) {
			setExpandedOrg(null);
			return;
		}
		setExpandedOrg(orgId);
	};

	return (
		<>
			<div className="flex items-center justify-between gap-2">
				<div className="relative flex-1">
					<Search className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
					<Input
						placeholder="Search organizations..."
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							setPage(0);
						}}
						className="pl-8"
					/>
				</div>
				<Dialog open={createOpen} onOpenChange={setCreateOpen}>
					<DialogTrigger asChild>
						<Button size="sm">
							<Plus className="mr-1.5 h-4 w-4" />
							New Organization
						</Button>
					</DialogTrigger>
					<DialogContent className="sm:max-w-[400px]">
						<DialogHeader>
							<DialogTitle>New Organization</DialogTitle>
						</DialogHeader>
						<div className="grid gap-4 py-4">
							<div className="grid gap-2">
								<Label htmlFor="org-name">Organization Name</Label>
								<Input
									id="org-name"
									placeholder="Acme Corp"
									value={newOrgName}
									onChange={(e) => setNewOrgName(e.target.value)}
								/>
							</div>
						</div>
						<DialogFooter>
							<Button variant="outline" onClick={() => setCreateOpen(false)} disabled={isCreating}>
								Cancel
							</Button>
							<Button onClick={handleCreate} disabled={isCreating || !newOrgName.trim()}>
								{isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
								Create
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Building2 className="h-5 w-5" />
						Organizations
					</CardTitle>
					<CardDescription>{orgsData?.total ?? 0} organizations</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex items-center justify-center py-10">
							<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
						</div>
					) : (
						<>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>ID</TableHead>
										<TableHead>Name</TableHead>
										<TableHead>Owner ID</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{orgsData?.items.length === 0 && (
										<TableRow>
											<TableCell colSpan={4} className="text-muted-foreground text-center">
												No organizations found.
											</TableCell>
										</TableRow>
									)}
									{orgsData?.items.map((org) => (
										<TableRow key={org.id}>
											<TableCell className="font-mono text-sm">{org.id}</TableCell>
											<TableCell className="font-medium">{org.name}</TableCell>
											<TableCell className="text-muted-foreground text-sm">
												{org.owner_user_id ?? "—"}
											</TableCell>
											<TableCell className="text-right">
												<div className="flex items-center justify-end gap-1">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => {
															setEditingOrg(org);
															setEditOrgName(org.name);
														}}
													>
														<Pencil className="h-4 w-4" />
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
																<AlertDialogTitle>Delete Organization</AlertDialogTitle>
																<AlertDialogDescription>
																	Are you sure you want to delete &quot;{org.name}&quot;? This action cannot be
																	undone.
																</AlertDialogDescription>
															</AlertDialogHeader>
															<AlertDialogFooter>
																<AlertDialogCancel>Cancel</AlertDialogCancel>
																<AlertDialogAction
																	onClick={() => handleDelete(org.id)}
																	className="bg-destructive hover:bg-destructive/90"
																>
																	Delete
																</AlertDialogAction>
															</AlertDialogFooter>
														</AlertDialogContent>
													</AlertDialog>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>

							{(orgsData?.total ?? 0) > PAGE_SIZE && (
								<div className="flex items-center justify-between pt-4">
									<p className="text-muted-foreground text-sm">
										Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, orgsData?.total ?? 0)}{" "}
										of {orgsData?.total}
									</p>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											disabled={page === 0}
											onClick={() => setPage(page - 1)}
										>
											Previous
										</Button>
										<Button
											variant="outline"
											size="sm"
											disabled={(page + 1) * PAGE_SIZE >= (orgsData?.total ?? 0)}
											onClick={() => setPage(page + 1)}
										>
											Next
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>

			{/* Edit Org Dialog */}
			<Dialog
				open={!!editingOrg}
				onOpenChange={(open) => {
					if (!open) setEditingOrg(null);
				}}
			>
				<DialogContent className="sm:max-w-[400px]">
					<DialogHeader>
						<DialogTitle>Edit Organization</DialogTitle>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="edit-org-name">Organization Name</Label>
							<Input
								id="edit-org-name"
								value={editOrgName}
								onChange={(e) => setEditOrgName(e.target.value)}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setEditingOrg(null)}
							disabled={isUpdating}
						>
							Cancel
						</Button>
						<Button onClick={handleUpdate} disabled={isUpdating || !editOrgName.trim()}>
							{isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							Save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
