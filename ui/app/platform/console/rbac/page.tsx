import { useState } from "react";
import { toast } from "sonner";
import {
	usePlatformListRolesQuery,
	usePlatformCreateRoleMutation,
	usePlatformUpdateRoleMutation,
	usePlatformDeleteRoleMutation,
	usePlatformListUsersQuery,
	usePlatformSetUserRoleMutation,
	usePlatformAssignUserRoleMutation,
} from "@/lib/platform/platformApi";
import type { PlatformCustomRole } from "@/lib/platform/platformApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Pencil, ShieldCheck, Users, Key, AlertCircle } from "lucide-react";

// ─── Constants ──────────────────────────────────────────────────

const RESOURCES = ["virtual_key", "team", "customer", "budget", "user", "role"] as const;

const RESOURCE_LABELS: Record<string, string> = {
	virtual_key: "VK",
	team: "Team",
	customer: "Customer",
	budget: "Budget",
	user: "User",
	role: "Role",
};

const ACTIONS = ["create", "read", "update", "delete"] as const;

const PRESET_ROLES = [
	{ name: "admin", description: "Full platform administrator" },
	{ name: "customer_owner", description: "Owner of a customer organization" },
	{ name: "team_admin", description: "Administrator of a team" },
	{ name: "team_member", description: "Standard team member" },
];

const PRESET_ROLE_OPTIONS = ["admin", "customer_owner", "team_admin", "team_member"];

// Permission matrix: role -> resource -> actions
const PERMISSION_MATRIX: Record<string, Record<string, string[]>> = {
	admin: {
		virtual_key: ["create", "read", "update", "delete"],
		team: ["create", "read", "update", "delete"],
		customer: ["create", "read", "update", "delete"],
		budget: ["create", "read", "update", "delete"],
		user: ["create", "read", "update", "delete"],
		role: ["create", "read", "update", "delete"],
	},
	customer_owner: {
		virtual_key: ["create", "read", "update", "delete"],
		team: ["create", "read", "update", "delete"],
		customer: ["read", "update"],
		budget: ["read", "update"],
		user: ["read", "invite"],
		role: [],
	},
	team_admin: {
		virtual_key: ["create", "read", "update", "delete"],
		team: ["read", "update"],
		customer: ["read"],
		budget: ["read"],
		user: ["read", "invite"],
		role: [],
	},
	team_member: {
		virtual_key: ["create", "read", "update"],
		team: ["read"],
		customer: ["read"],
		budget: ["read"],
		user: ["read"],
		role: [],
	},
};

function buildPermissionPairs(): string[] {
	const pairs: string[] = [];
	for (const resource of RESOURCES) {
		for (const action of ACTIONS) {
			pairs.push(`${resource}:${action}`);
		}
	}
	return pairs;
}

const ALL_PERMISSIONS = buildPermissionPairs();

// ─── Sub-components ─────────────────────────────────────────────

function RoleDialog({
	open,
	onOpenChange,
	role,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	role?: PlatformCustomRole | null;
	onSaved: () => void;
}) {
	const [name, setName] = useState(role?.name ?? "");
	const [scope, setScope] = useState(role?.scope ?? "global");
	const [description, setDescription] = useState(role?.description ?? "");
	const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);

	const [createRole, { isLoading: creating }] = usePlatformCreateRoleMutation();
	const [updateRole, { isLoading: updating }] = usePlatformUpdateRoleMutation();

	const isEditing = !!role;
	const isLoading = creating || updating;

	// Reset form when dialog opens with different role
	const handleOpenChange = (nextOpen: boolean) => {
		if (nextOpen) {
			setName(role?.name ?? "");
			setScope(role?.scope ?? "global");
			setDescription(role?.description ?? "");
			setPermissions(role?.permissions ?? []);
		}
		onOpenChange(nextOpen);
	};

	const togglePermission = (perm: string) => {
		setPermissions((prev) => (prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]));
	};

	const toggleResource = (resource: string) => {
		const resourcePerms = ALL_PERMISSIONS.filter((p) => p.startsWith(`${resource}:`));
		const allSelected = resourcePerms.every((p) => permissions.includes(p));
		if (allSelected) {
			setPermissions((prev) => prev.filter((p) => !p.startsWith(`${resource}:`)));
		} else {
			setPermissions((prev) => {
				const next = [...prev];
				for (const rp of resourcePerms) {
					if (!next.includes(rp)) next.push(rp);
				}
				return next;
			});
		}
	};

	const handleSubmit = async () => {
		if (!name.trim()) {
			toast.error("Role name is required");
			return;
		}
		try {
			if (isEditing && role) {
				await updateRole({
					id: role.id,
					data: { name, permissions, description: description || undefined },
				}).unwrap();
				toast.success("Role updated successfully");
			} else {
				await createRole({
					name,
					scope,
					permissions,
					description: description || undefined,
				}).unwrap();
				toast.success("Role created successfully");
			}
			onSaved();
			onOpenChange(false);
		} catch (err: any) {
			toast.error(err?.data?.message ?? err?.message ?? "Operation failed");
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{isEditing ? "Edit Role" : "Create Role"}</DialogTitle>
					<DialogDescription>
						{isEditing ? "Update the role details and permissions." : "Define a new custom role with specific permissions."}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-2">
					<div className="space-y-2">
						<Label htmlFor="role-name">Name</Label>
						<Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. billing_manager" />
					</div>
					{!isEditing && (
						<div className="space-y-2">
							<Label htmlFor="role-scope">Scope</Label>
							<Select value={scope} onValueChange={setScope}>
								<SelectTrigger id="role-scope">
									<SelectValue placeholder="Select scope" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="global">Global</SelectItem>
									<SelectItem value="customer">Customer</SelectItem>
									<SelectItem value="team">Team</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
					<div className="space-y-2">
						<Label htmlFor="role-desc">Description</Label>
						<Input
							id="role-desc"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Brief description of this role"
						/>
					</div>
					<div className="space-y-3">
						<Label>Permissions</Label>
						<div className="rounded-md border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-32">Resource</TableHead>
										{ACTIONS.map((action) => (
											<TableHead key={action} className="text-center capitalize">
												{action}
											</TableHead>
										))}
										<TableHead className="w-16 text-center">All</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{RESOURCES.map((resource) => {
										const resourcePerms = ALL_PERMISSIONS.filter((p) => p.startsWith(`${resource}:`));
										const allSelected = resourcePerms.every((p) => permissions.includes(p));
										const someSelected = resourcePerms.some((p) => permissions.includes(p));
										return (
											<TableRow key={resource}>
												<TableCell className="font-medium">{RESOURCE_LABELS[resource]}</TableCell>
												{ACTIONS.map((action) => {
													const perm = `${resource}:${action}`;
													return (
														<TableCell key={action} className="text-center">
															<Checkbox checked={permissions.includes(perm)} onCheckedChange={() => togglePermission(perm)} />
														</TableCell>
													);
												})}
												<TableCell className="text-center">
													<Checkbox
														checked={allSelected}
														{...(someSelected && !allSelected ? { indeterminate: true } : {})}
														onCheckedChange={() => toggleResource(resource)}
													/>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={isLoading}>
						{isLoading ? "Saving..." : isEditing ? "Update" : "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function AssignRoleDialog({
	open,
	onOpenChange,
	userId,
	username,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	userId: number;
	username: string;
}) {
	const [selectedRoleId, setSelectedRoleId] = useState("");
	const [assignRole, { isLoading }] = usePlatformAssignUserRoleMutation();
	const { data: roles } = usePlatformListRolesQuery();

	const handleSubmit = async () => {
		if (!selectedRoleId) {
			toast.error("Please select a role");
			return;
		}
		try {
			await assignRole({
				user_id: userId,
				role_id: selectedRoleId,
			}).unwrap();
			toast.success(`Role assigned to ${username}`);
			onOpenChange(false);
		} catch (err: any) {
			toast.error(err?.data?.message ?? err?.message ?? "Failed to assign role");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Assign Custom Role</DialogTitle>
					<DialogDescription>
						Assign a custom role to <strong>{username}</strong>.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-2">
					<div className="space-y-2">
						<Label htmlFor="assign-role-select">Custom Role</Label>
						<Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
							<SelectTrigger id="assign-role-select">
								<SelectValue placeholder="Select a custom role" />
							</SelectTrigger>
							<SelectContent>
								{roles?.map((role) => (
									<SelectItem key={role.id} value={role.id}>
										{role.name} <span className="text-muted-foreground">({role.scope})</span>
									</SelectItem>
								))}
								{(!roles || roles.length === 0) && (
									<SelectItem value="__none" disabled>
										No custom roles available
									</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={isLoading}>
						{isLoading ? "Assigning..." : "Assign Role"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ─── Main Page ──────────────────────────────────────────────────

export default function RbacPage() {
	const [roleDialogOpen, setRoleDialogOpen] = useState(false);
	const [editingRole, setEditingRole] = useState<PlatformCustomRole | null>(null);
	const [assignDialogOpen, setAssignDialogOpen] = useState(false);
	const [assignTarget, setAssignTarget] = useState<{
		userId: number;
		username: string;
	} | null>(null);

	const { data: roles, isLoading: rolesLoading, error: rolesError, refetch: refetchRoles } = usePlatformListRolesQuery();
	const { data: usersData, isLoading: usersLoading, error: usersError, refetch: refetchUsers } = usePlatformListUsersQuery();

	const [deleteRole] = usePlatformDeleteRoleMutation();
	const [setUserRole] = usePlatformSetUserRoleMutation();

	const users = usersData?.users ?? [];

	// Check if user has admin access
	const hasAccess = !rolesError && !usersError;
	const errorMessage =
		(rolesError as any)?.data?.message ||
		(usersError as any)?.data?.message ||
		(rolesError as any)?.message ||
		(usersError as any)?.message;

	const handleDeleteRole = async (role: PlatformCustomRole) => {
		if (!confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
		try {
			await deleteRole(role.id).unwrap();
			toast.success(`Role "${role.name}" deleted`);
			refetchRoles();
		} catch (err: any) {
			toast.error(err?.data?.message ?? err?.message ?? "Failed to delete role");
		}
	};

	const handleEditRole = (role: PlatformCustomRole) => {
		setEditingRole(role);
		setRoleDialogOpen(true);
	};

	const handleCreateRole = () => {
		setEditingRole(null);
		setRoleDialogOpen(true);
	};

	const handlePresetRoleChange = async (userId: number, role: string) => {
		try {
			await setUserRole({ user_id: userId, role }).unwrap();
			toast.success("Preset role updated");
			refetchUsers();
		} catch (err: any) {
			toast.error(err?.data?.message ?? err?.message ?? "Failed to update preset role");
		}
	};

	const handleOpenAssignDialog = (userId: number, username: string) => {
		setAssignTarget({ userId, username });
		setAssignDialogOpen(true);
	};

	// Show error message if user doesn't have admin access
	if (!hasAccess) {
		return (
			<div className="space-y-6">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
						<ShieldCheck className="h-6 w-6" />
						RBAC Management
					</h1>
					<p className="text-muted-foreground">Manage roles, user assignments, and view the permission matrix.</p>
				</div>
				<Alert variant="destructive">
					<AlertCircle className="h-4 w-4" />
					<AlertTitle>Access Denied</AlertTitle>
					<AlertDescription>
						{errorMessage || "You don't have permission to access this page. Only administrators can manage RBAC."}
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
					<ShieldCheck className="h-6 w-6" />
					RBAC Management
				</h1>
				<p className="text-muted-foreground">Manage roles, user assignments, and view the permission matrix.</p>
			</div>

			<Tabs defaultValue="roles" className="space-y-4">
				<TabsList>
					<TabsTrigger value="roles" className="gap-1.5">
						<Key className="h-4 w-4" />
						Roles
					</TabsTrigger>
					<TabsTrigger value="users" className="gap-1.5">
						<Users className="h-4 w-4" />
						Users
					</TabsTrigger>
					<TabsTrigger value="permissions" className="gap-1.5">
						<ShieldCheck className="h-4 w-4" />
						Permissions
					</TabsTrigger>
				</TabsList>

				{/* ── Roles Tab ─────────────────────────────────── */}
				<TabsContent value="roles" className="space-y-4">
					<div className="flex items-center justify-between">
						<h2 className="text-lg font-semibold">Roles</h2>
						<Button size="sm" onClick={handleCreateRole}>
							<Plus className="mr-1.5 h-4 w-4" />
							Create Role
						</Button>
					</div>

					{rolesLoading ? (
						<div className="text-muted-foreground flex items-center justify-center py-12 text-sm">Loading roles...</div>
					) : (
						<Card>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Name</TableHead>
										<TableHead>Scope</TableHead>
										<TableHead>Description</TableHead>
										<TableHead>Permissions</TableHead>
										<TableHead>Type</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{/* Preset (built-in) roles */}
									{PRESET_ROLES.map((preset) => (
										<TableRow key={preset.name} className="bg-muted/30">
											<TableCell className="font-medium">{preset.name}</TableCell>
											<TableCell>
												<Badge variant="outline">global</Badge>
											</TableCell>
											<TableCell className="text-muted-foreground">{preset.description}</TableCell>
											<TableCell>
												<Badge variant="secondary">{Object.values(PERMISSION_MATRIX[preset.name] ?? {}).flat().length} perms</Badge>
											</TableCell>
											<TableCell>
												<Badge>Built-in</Badge>
											</TableCell>
											<TableCell className="text-right">
												<span className="text-muted-foreground text-xs">—</span>
											</TableCell>
										</TableRow>
									))}

									{/* Custom roles */}
									{roles?.map((role) => (
										<TableRow key={role.id}>
											<TableCell className="font-medium">{role.name}</TableCell>
											<TableCell>
												<Badge variant="outline">{role.scope}</Badge>
											</TableCell>
											<TableCell className="text-muted-foreground">{role.description ?? "—"}</TableCell>
											<TableCell>
												<Badge variant="secondary">{role.permissions.length} perms</Badge>
											</TableCell>
											<TableCell>
												<Badge variant="secondary">Custom</Badge>
											</TableCell>
											<TableCell className="text-right">
												<div className="flex items-center justify-end gap-1">
													<Button variant="ghost" size="icon" onClick={() => handleEditRole(role)}>
														<Pencil className="h-4 w-4" />
													</Button>
													<Button variant="ghost" size="icon" onClick={() => handleDeleteRole(role)}>
														<Trash2 className="text-destructive h-4 w-4" />
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))}

									{roles && roles.length === 0 && (
										<TableRow>
											<TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
												No custom roles yet. Create one to get started.
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						</Card>
					)}
				</TabsContent>

				{/* ── Users Tab ─────────────────────────────────── */}
				<TabsContent value="users" className="space-y-4">
					<div className="flex items-center justify-between">
						<h2 className="text-lg font-semibold">Users</h2>
					</div>

					{usersLoading ? (
						<div className="text-muted-foreground flex items-center justify-center py-12 text-sm">Loading users...</div>
					) : users.length === 0 ? (
						<div className="text-muted-foreground flex items-center justify-center py-12 text-sm">No users found.</div>
					) : (
						<Card>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Username</TableHead>
										<TableHead>Email</TableHead>
										<TableHead>Role</TableHead>
										<TableHead>Status</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{users.map((user) => (
										<TableRow key={user.id}>
											<TableCell className="font-medium">{user.username}</TableCell>
											<TableCell>{user.email}</TableCell>
											<TableCell>
												<Badge variant={user.is_admin ? "default" : "secondary"}>{user.role}</Badge>
											</TableCell>
											<TableCell>
												<Badge variant={user.status === "active" ? "default" : "destructive"}>{user.status}</Badge>
											</TableCell>
											<TableCell className="text-right">
												<div className="flex items-center justify-end gap-1">
													<Select value={user.role} onValueChange={(value) => handlePresetRoleChange(user.id, value)}>
														<SelectTrigger className="h-8 w-36">
															<SelectValue placeholder="Set role" />
														</SelectTrigger>
														<SelectContent>
															{PRESET_ROLE_OPTIONS.map((r) => (
																<SelectItem key={r} value={r}>
																	{r}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
													<Button
														variant="outline"
														size="sm"
														className="h-8"
														onClick={() => handleOpenAssignDialog(user.id, user.username)}
													>
														<Plus className="mr-1 h-3.5 w-3.5" />
														Custom
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</Card>
					)}
				</TabsContent>

				{/* ── Permissions Tab (Reference Matrix) ────────── */}
				<TabsContent value="permissions" className="space-y-4">
					<div className="flex items-center justify-between">
						<h2 className="text-lg font-semibold">Permission Matrix</h2>
						<p className="text-muted-foreground text-sm">Read-only reference for built-in roles</p>
					</div>

					<Card>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-36">Role</TableHead>
									{RESOURCES.map((resource) => (
										<TableHead key={resource} className="text-center">
											{RESOURCE_LABELS[resource]}
										</TableHead>
									))}
								</TableRow>
							</TableHeader>
							<TableBody>
								{PRESET_ROLES.map((preset) => (
									<TableRow key={preset.name}>
										<TableCell className="font-medium">
											<div className="flex items-center gap-2">
												{preset.name}
												<Badge variant="outline" className="text-xs">
													Built-in
												</Badge>
											</div>
										</TableCell>
										{RESOURCES.map((resource) => {
											const perms = PERMISSION_MATRIX[preset.name]?.[resource] ?? [];
											return (
												<TableCell key={resource} className="text-center">
													{perms.length === 0 ? (
														<span className="text-muted-foreground text-xs">—</span>
													) : (
														<div className="flex flex-wrap justify-center gap-0.5">
															{perms.map((action) => (
																<Badge
																	key={action}
																	variant={action === "create" ? "default" : action === "delete" ? "destructive" : "secondary"}
																	className="px-1 py-0 text-[10px]"
																>
																	{action.charAt(0).toUpperCase()}
																</Badge>
															))}
														</div>
													)}
												</TableCell>
											);
										})}
									</TableRow>
								))}
							</TableBody>
						</Table>
					</Card>

					<div className="text-muted-foreground flex items-center gap-3 text-xs">
						<span className="flex items-center gap-1">
							<Badge variant="default" className="px-1 py-0 text-[10px]">
								C
							</Badge>
							Create
						</span>
						<span className="flex items-center gap-1">
							<Badge variant="secondary" className="px-1 py-0 text-[10px]">
								R
							</Badge>
							Read
						</span>
						<span className="flex items-center gap-1">
							<Badge variant="secondary" className="px-1 py-0 text-[10px]">
								U
							</Badge>
							Update
						</span>
						<span className="flex items-center gap-1">
							<Badge variant="destructive" className="px-1 py-0 text-[10px]">
								D
							</Badge>
							Delete
						</span>
						<span className="flex items-center gap-1">
							<Badge variant="outline" className="px-1 py-0 text-[10px]">
								I
							</Badge>
							Invite
						</span>
					</div>
				</TabsContent>
			</Tabs>

			{/* ── Dialogs ───────────────────────────────────── */}
			<RoleDialog
				open={roleDialogOpen}
				onOpenChange={setRoleDialogOpen}
				role={editingRole}
				onSaved={() => {
					refetchRoles();
				}}
			/>

			{assignTarget && (
				<AssignRoleDialog
					open={assignDialogOpen}
					onOpenChange={setAssignDialogOpen}
					userId={assignTarget.userId}
					username={assignTarget.username}
				/>
			)}
		</div>
	);
}