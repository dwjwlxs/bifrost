import { useState } from "react";
import {
	usePlatformListUsersQuery,
	usePlatformSetUserRoleMutation,
	usePlatformListCustomersQuery,
	usePlatformListTeamsQuery,
	type PlatformUserInfo,
} from "@/lib/platform/platformApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Building2, Search, Pencil } from "lucide-react";
import { toast } from "sonner";

const ROLES = ["user", "admin", "customer_owner", "team_admin", "team_member"] as const;

export default function UsersPage() {
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const pageSize = 20;

	const { data: usersData, isLoading: usersLoading } = usePlatformListUsersQuery({
		search: search || undefined,
		limit: pageSize,
		offset: page * pageSize,
	});
	const { data: customers, isLoading: customersLoading } = usePlatformListCustomersQuery();
	const { data: teams, isLoading: teamsLoading } = usePlatformListTeamsQuery();
	const [setUserRole] = usePlatformSetUserRoleMutation();

	const [roleDialogOpen, setRoleDialogOpen] = useState(false);
	const [editingUser, setEditingUser] = useState<PlatformUserInfo | null>(null);
	const [selectedRole, setSelectedRole] = useState("");

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

	const openRoleDialog = (user: PlatformUserInfo) => {
		setEditingUser(user);
		setSelectedRole(user.role);
		setRoleDialogOpen(true);
	};

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Users & Organizations</h1>
				<p className="text-muted-foreground">Manage platform users, organizations, and teams.</p>
			</div>

			<Tabs defaultValue="users">
				<TabsList>
					<TabsTrigger value="users" data-testid="admin-users-tab-users">
						Users
					</TabsTrigger>
					<TabsTrigger value="organizations" data-testid="admin-users-tab-orgs">
						Organizations
					</TabsTrigger>
					<TabsTrigger value="teams" data-testid="admin-users-tab-teams">
						Teams
					</TabsTrigger>
				</TabsList>

				{/* Users Tab */}
				<TabsContent value="users" className="space-y-4">
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
							<CardDescription>{usersData?.total ?? 0} total users</CardDescription>
						</CardHeader>
						<CardContent>
							{usersLoading ? (
								<div className="flex items-center justify-center py-10">
									<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
								</div>
							) : (
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
										{usersData?.users.length === 0 && (
											<TableRow>
												<TableCell colSpan={8} className="text-muted-foreground text-center">
													No users found.
												</TableCell>
											</TableRow>
										)}
										{usersData?.users.map((user) => (
											<TableRow key={user.id}>
												<TableCell className="font-mono text-sm">{user.id}</TableCell>
												<TableCell className="font-medium">{user.username}</TableCell>
												<TableCell className="text-sm">{user.email}</TableCell>
												<TableCell>
													<Badge variant={user.is_admin ? "default" : user.role === "customer_owner" ? "secondary" : "outline"}>
														{user.role}
													</Badge>
												</TableCell>
												<TableCell>
													<Badge variant={user.status === "active" ? "default" : "destructive"}>{user.status}</Badge>
												</TableCell>
												<TableCell>{user.is_email_verified ? "Yes" : "No"}</TableCell>
												<TableCell className="text-muted-foreground text-sm">{new Date(user.created_at).toLocaleDateString()}</TableCell>
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
							)}
							{(usersData?.total ?? 0) > pageSize && (
								<div className="flex items-center justify-between pt-4">
									<p className="text-muted-foreground text-sm">
										Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, usersData?.total ?? 0)} of {usersData?.total}
									</p>
									<div className="flex gap-2">
										<Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
											Previous
										</Button>
										<Button
											variant="outline"
											size="sm"
											disabled={(page + 1) * pageSize >= (usersData?.total ?? 0)}
											onClick={() => setPage(page + 1)}
										>
											Next
										</Button>
									</div>
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* Organizations Tab */}
				<TabsContent value="organizations">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Building2 className="h-5 w-5" />
								Organizations
							</CardTitle>
							<CardDescription>{customers?.length ?? 0} organizations</CardDescription>
						</CardHeader>
						<CardContent>
							{customersLoading ? (
								<div className="flex items-center justify-center py-10">
									<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
								</div>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>ID</TableHead>
											<TableHead>Name</TableHead>
											<TableHead>Owner</TableHead>
											<TableHead>Teams</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{(!customers || customers.length === 0) && (
											<TableRow>
												<TableCell colSpan={4} className="text-muted-foreground text-center">
													No organizations found.
												</TableCell>
											</TableRow>
										)}
										{customers?.map((c) => (
											<TableRow key={c.id}>
												<TableCell className="font-mono text-sm">{c.id}</TableCell>
												<TableCell className="font-medium">{c.name}</TableCell>
												<TableCell className="text-muted-foreground text-sm">{c.owner_user_id ?? "—"}</TableCell>
												<TableCell>{c.teams?.length ?? 0}</TableCell>
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
							<CardTitle>Teams</CardTitle>
							<CardDescription>{teams?.length ?? 0} teams</CardDescription>
						</CardHeader>
						<CardContent>
							{teamsLoading ? (
								<div className="flex items-center justify-center py-10">
									<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
								</div>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>ID</TableHead>
											<TableHead>Name</TableHead>
											<TableHead>Organization</TableHead>
											<TableHead>Owner</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{(!teams || teams.length === 0) && (
											<TableRow>
												<TableCell colSpan={4} className="text-muted-foreground text-center">
													No teams found.
												</TableCell>
											</TableRow>
										)}
										{teams?.map((t) => (
											<TableRow key={t.id}>
												<TableCell className="font-mono text-sm">{t.id}</TableCell>
												<TableCell className="font-medium">{t.name}</TableCell>
												<TableCell className="text-muted-foreground text-sm">{t.customer_id ?? "—"}</TableCell>
												<TableCell className="text-muted-foreground text-sm">{t.owner_user_id ?? "—"}</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			{/* Role Edit Dialog */}
			<Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Change User Role</DialogTitle>
						<DialogDescription>
							Update role for <span className="font-medium">{editingUser?.username}</span> ({editingUser?.email})
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label>Role</Label>
							<Select value={selectedRole} onValueChange={setSelectedRole}>
								<SelectTrigger data-testid="admin-users-role-select">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{ROLES.map((role) => (
										<SelectItem key={role} value={role}>
											{role}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setRoleDialogOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleSetRole} data-testid="admin-users-role-submit">
							Update Role
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}