import { useState } from "react";
import {
	usePlatformListUsersQuery,
	usePlatformSetUserAdminMutation,
	usePlatformSetUserStatusMutation,
	usePlatformAdminListOrgsQuery,
	usePlatformAdminCreateOrgMutation,
	usePlatformAdminUpdateOrgMutation,
	usePlatformAdminDeleteOrgMutation,
	usePlatformListOrgTeamsQuery,
} from "@/lib/platform/platformApi";
import { type PlatformOrg, type PlatformUserInfo } from "@/lib/platform/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/ui/copy-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import { Users, Building2, Search, Pencil, Plus, Trash2, Loader2, Shield } from "lucide-react";
import { toast } from "sonner";

const STATUS_OPTIONS = ["active", "suspended", "pending_verification"] as const;

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
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [editingUser, setEditingUser] = useState<PlatformUserInfo | null>(null);
	const [editStatus, setEditStatus] = useState<string>("active");
	const [editAdmin, setEditAdmin] = useState(false);

	const { data, isLoading } = usePlatformListUsersQuery({
		search: search || undefined,
		limit: PAGE_SIZE,
		offset: page * PAGE_SIZE,
	});
	const [setUserAdmin, { isLoading: isSettingAdmin }] = usePlatformSetUserAdminMutation();
	const [setUserStatus, { isLoading: isSettingStatus }] = usePlatformSetUserStatusMutation();

	const openEditDialog = (user: PlatformUserInfo) => {
		setEditingUser(user);
		setEditStatus(user.status ?? "active");
		setEditAdmin(user.is_admin ?? false);
		setEditDialogOpen(true);
	};

	const isSaving = isSettingAdmin || isSettingStatus;

	const handleSave = async () => {
		if (!editingUser) return;
		let hasError = false;

		// Update admin status if changed
		if (editAdmin !== (editingUser.is_admin ?? false)) {
			try {
				await setUserAdmin({ user_id: editingUser.id, is_admin: editAdmin }).unwrap();
			} catch {
				toast.error("Failed to update admin status");
				hasError = true;
			}
		}

		// Update status if changed
		if (editStatus !== (editingUser.status ?? "active")) {
			try {
				await setUserStatus({
					user_id: editingUser.id,
					status: editStatus as "active" | "suspended" | "pending_verification",
				}).unwrap();
			} catch {
				toast.error("Failed to update user status");
				hasError = true;
			}
		}

		if (!hasError) {
			toast.success(`User ${editingUser.username} updated`);
			setEditDialogOpen(false);
		}
	};

	const statusVariant = (status: string) => {
		switch (status) {
			case "active":
				return "default" as const;
			case "suspended":
				return "destructive" as const;
			default:
				return "secondary" as const;
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
										<TableHead>Admin</TableHead>
										<TableHead>Role</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Joined</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{data?.items.length === 0 && (
										<TableRow>
											<TableCell colSpan={9} className="text-muted-foreground text-center">
												No users found.
											</TableCell>
										</TableRow>
									)}
									{data?.items.map((user) => (
										<TableRow key={user.id}>
											<TableCell className="font-mono text-sm">
												<span className="flex items-center gap-1">
													<span>{user.id}</span>
													<CopyButton text={user.id} />
												</span>
											</TableCell>
											<TableCell className="font-medium">{user.username}</TableCell>
											<TableCell className="text-sm">{user.email}</TableCell>
											<TableCell>
												{user.is_admin && (
													<Badge variant="default" className="gap-1">
														<Shield className="h-3 w-3" />
														Admin
													</Badge>
												)}
											</TableCell>
											<TableCell>
												<Badge variant={user.role === "customer_owner" ? "secondary" : "outline"}>{user.role ?? "user"}</Badge>
											</TableCell>
											<TableCell>
												<Badge variant={statusVariant(user.status ?? "active")}>{user.status ?? "active"}</Badge>
											</TableCell>
											<TableCell className="text-muted-foreground text-sm">{new Date(user.created_at).toLocaleDateString()}</TableCell>
											<TableCell className="text-right">
												<Button variant="ghost" size="sm" onClick={() => openEditDialog(user)} data-testid={`admin-users-edit-${user.id}`}>
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
										Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data?.total ?? 0)} of {data?.total}
									</p>
									<div className="flex gap-2">
										<Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
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

			{/* Edit User Dialog */}
			<Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit User</DialogTitle>
						<DialogDescription>
							Update settings for <span className="font-medium">{editingUser?.username}</span> ({editingUser?.email})
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						{/* Admin toggle */}
						<div className="flex items-center justify-between rounded-lg border p-3">
							<div className="space-y-0.5">
								<Label className="flex items-center gap-2">
									<Shield className="h-4 w-4" />
									Platform Admin
								</Label>
								<p className="text-muted-foreground text-xs">Grant full platform administration access</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={editAdmin}
								onClick={() => setEditAdmin(!editAdmin)}
								className={`focus-visible:ring-ring relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none ${
									editAdmin ? "bg-primary" : "bg-input"
								}`}
								data-testid="admin-users-admin-toggle"
							>
								<span
									className={`bg-background pointer-events-none block h-5 w-5 rounded-full shadow-lg ring-0 transition-transform ${
										editAdmin ? "translate-x-5" : "translate-x-0"
									}`}
								/>
							</button>
						</div>

						{/* Status select */}
						<div className="grid gap-2">
							<Label>Status</Label>
							<select
								className="border-input placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
								value={editStatus}
								onChange={(e) => setEditStatus(e.target.value)}
								data-testid="admin-users-status-select"
							>
								{STATUS_OPTIONS.map((s) => (
									<option key={s} value={s}>
										{s}
									</option>
								))}
							</select>
							<p className="text-muted-foreground text-xs">suspended = user cannot login; pending_verification = skip email check</p>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={isSaving}>
							Cancel
						</Button>
						<Button onClick={handleSave} disabled={isSaving} data-testid="admin-users-edit-submit">
							{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							Save Changes
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
	const [editOwnerId, setEditOwnerId] = useState("");

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
			const payload: { id: string; name: string; owner_user_id?: string } = {
				id: editingOrg.id,
				name: editOrgName.trim(),
			};
			if (editOwnerId.trim()) {
				payload.owner_user_id = editOwnerId.trim();
			}
			await updateOrg(payload).unwrap();
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
								<Input id="org-name" placeholder="Acme Corp" value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} />
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
											<TableCell className="font-mono text-sm">
												<span className="flex items-center gap-1">
													<span>{org.id}</span>
													<CopyButton text={org.id} />
												</span>
											</TableCell>
											<TableCell className="font-medium">{org.name}</TableCell>
											<TableCell className="text-muted-foreground text-sm">{org.owner_user_id ?? "—"}</TableCell>
											<TableCell className="text-right">
												<div className="flex items-center justify-end gap-1">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => {
															setEditingOrg(org);
															setEditOrgName(org.name);
															setEditOwnerId(org.owner_user_id?.toString() ?? "");
														}}
													>
														<Pencil className="h-4 w-4" />
													</Button>
													<AlertDialog>
														<AlertDialogTrigger asChild>
															<Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 h-8 w-8 p-0">
																<Trash2 className="h-4 w-4" />
															</Button>
														</AlertDialogTrigger>
														<AlertDialogContent>
															<AlertDialogHeader>
																<AlertDialogTitle>Delete Organization</AlertDialogTitle>
																<AlertDialogDescription>
																	Are you sure you want to delete &quot;{org.name}&quot;? This action cannot be undone.
																</AlertDialogDescription>
															</AlertDialogHeader>
															<AlertDialogFooter>
																<AlertDialogCancel>Cancel</AlertDialogCancel>
																<AlertDialogAction onClick={() => handleDelete(org.id)} className="bg-destructive hover:bg-destructive/90">
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
										Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, orgsData?.total ?? 0)} of {orgsData?.total}
									</p>
									<div className="flex gap-2">
										<Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
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
							<Input id="edit-org-name" value={editOrgName} onChange={(e) => setEditOrgName(e.target.value)} />
						</div>
						<div className="grid gap-2">
							<Label htmlFor="edit-org-owner">Owner User ID</Label>
							<Input
								id="edit-org-owner"
								type="text"
								placeholder="Enter user ID"
								value={editOwnerId}
								onChange={(e) => setEditOwnerId(e.target.value)}
							/>
							<p className="text-muted-foreground text-xs">Set the owner of this organization by user ID</p>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setEditingOrg(null)} disabled={isUpdating}>
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