import { useState } from "react";
import {
	usePlatformListCustomersQuery,
	usePlatformCreateCustomerMutation,
	usePlatformUpdateCustomerMutation,
	usePlatformDeleteCustomerMutation,
	usePlatformListTeamsQuery,
	usePlatformCreateTeamMutation,
	usePlatformUpdateTeamMutation,
	usePlatformDeleteTeamMutation,
	usePlatformListTeamMembersQuery,
	usePlatformRemoveTeamMemberMutation,
	usePlatformOwnerSetUserRoleMutation,
	usePlatformOwnerSetUserTeamMutation,
	usePlatformOwnerSetTeamBudgetMutation,
	type PlatformCustomer,
	type PlatformTeam,
	type PlatformUserInfo,
} from "@/lib/platform/platformApi";
import { useUserRole } from "@/lib/platform/hooks";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil, Building2, Users, ChevronRight, DollarSign } from "lucide-react";

// ─── Customers Tab ───────────────────────────────────────────────

function CustomersTab({ customers }: { customers: PlatformCustomer[] }) {
	const [createOpen, setCreateOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);
	const [editingCustomer, setEditingCustomer] = useState<PlatformCustomer | null>(null);
	const [newName, setNewName] = useState("");
	const [editName, setEditName] = useState("");

	const [createCustomer, { isLoading: creating }] = usePlatformCreateCustomerMutation();
	const [updateCustomer, { isLoading: updating }] = usePlatformUpdateCustomerMutation();
	const [deleteCustomer] = usePlatformDeleteCustomerMutation();

	const handleCreate = async () => {
		if (!newName.trim()) return;
		try {
			await createCustomer({ name: newName.trim() }).unwrap();
			toast.success("Customer created successfully");
			setNewName("");
			setCreateOpen(false);
		} catch (err: any) {
			toast.error(err?.data?.message || "Failed to create customer");
		}
	};

	const handleEdit = (customer: PlatformCustomer) => {
		setEditingCustomer(customer);
		setEditName(customer.name);
		setEditOpen(true);
	};

	const handleUpdate = async () => {
		if (!editingCustomer || !editName.trim()) return;
		try {
			await updateCustomer({ id: editingCustomer.id, data: { name: editName.trim() } }).unwrap();
			toast.success("Customer updated successfully");
			setEditOpen(false);
			setEditingCustomer(null);
		} catch (err: any) {
			toast.error(err?.data?.message || "Failed to update customer");
		}
	};

	const handleDelete = async (id: string) => {
		if (!confirm("Are you sure you want to delete this customer?")) return;
		try {
			await deleteCustomer(id).unwrap();
			toast.success("Customer deleted successfully");
		} catch (err: any) {
			toast.error(err?.data?.message || "Failed to delete customer");
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h2 className="flex items-center gap-2 text-lg font-semibold">
					<Building2 className="h-5 w-5" />
					Customers
				</h2>
				<Dialog open={createOpen} onOpenChange={setCreateOpen}>
					<DialogTrigger asChild>
						<Button size="sm">
							<Plus className="mr-1.5 h-4 w-4" />
							Create Customer
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Create Customer</DialogTitle>
						</DialogHeader>
						<div className="space-y-4 pt-2">
							<div className="space-y-2">
								<Label htmlFor="customer-name">Name</Label>
								<Input
									id="customer-name"
									placeholder="Customer name"
									value={newName}
									onChange={(e) => setNewName(e.target.value)}
									onKeyDown={(e) => e.key === "Enter" && handleCreate()}
								/>
							</div>
							<Button onClick={handleCreate} disabled={creating || !newName.trim()} className="w-full">
								{creating ? "Creating..." : "Create"}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</div>

			{customers.length === 0 ? (
				<div className="text-muted-foreground flex items-center justify-center py-12 text-sm">
					No customers found. Create one to get started.
				</div>
			) : (
				<Card>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>ID</TableHead>
								<TableHead>Owner User ID</TableHead>
								<TableHead>Teams</TableHead>
								<TableHead>Virtual Keys</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{customers.map((customer) => (
								<TableRow key={customer.id}>
									<TableCell className="font-medium">{customer.name}</TableCell>
									<TableCell>
										<code className="text-xs">{customer.id}</code>
									</TableCell>
									<TableCell>{customer.owner_user_id ?? "—"}</TableCell>
									<TableCell>
										<Badge variant="secondary">{customer.teams?.length ?? 0}</Badge>
									</TableCell>
									<TableCell>
										<Badge variant="secondary">{customer.virtual_keys?.length ?? 0}</Badge>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex items-center justify-end gap-1">
											<Button variant="ghost" size="icon" onClick={() => handleEdit(customer)}>
												<Pencil className="h-4 w-4" />
											</Button>
											<Button variant="ghost" size="icon" onClick={() => handleDelete(customer.id)}>
												<Trash2 className="text-destructive h-4 w-4" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</Card>
			)}

			{/* Edit Dialog */}
			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit Customer</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 pt-2">
						<div className="space-y-2">
							<Label htmlFor="edit-customer-name">Name</Label>
							<Input
								id="edit-customer-name"
								placeholder="Customer name"
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
							/>
						</div>
						<Button onClick={handleUpdate} disabled={updating || !editName.trim()} className="w-full">
							{updating ? "Saving..." : "Save Changes"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

// ─── Team Members Panel (with owner controls) ────────────────────

function TeamMembersPanel({ teamId, teams }: { teamId: string; teams: PlatformTeam[] }) {
	const { data: members, isLoading } = usePlatformListTeamMembersQuery(teamId);
	const [removeMember] = usePlatformRemoveTeamMemberMutation();
	const [ownerSetRole] = usePlatformOwnerSetUserRoleMutation();
	const [ownerSetTeam] = usePlatformOwnerSetUserTeamMutation();
	const { isOwner, isAdmin } = useUserRole();
	const canManage = isOwner || isAdmin;

	const [roleDialogOpen, setRoleDialogOpen] = useState(false);
	const [teamDialogOpen, setTeamDialogOpen] = useState(false);
	const [selectedMember, setSelectedMember] = useState<PlatformUserInfo | null>(null);
	const [selectedRole, setSelectedRole] = useState("");
	const [selectedTeamId, setSelectedTeamId] = useState("");

	const handleRemove = async (userId: number) => {
		if (!confirm("Remove this member from the team?")) return;
		try {
			await removeMember({ team_id: teamId, user_id: userId }).unwrap();
			toast.success("Member removed");
		} catch (err: any) {
			toast.error(err?.data?.message || "Failed to remove member");
		}
	};

	const handleChangeRole = async () => {
		if (!selectedMember || !selectedRole) return;
		try {
			await ownerSetRole({ user_id: selectedMember.id, role: selectedRole }).unwrap();
			toast.success(`Role updated for ${selectedMember.username}`);
			setRoleDialogOpen(false);
		} catch (err: any) {
			toast.error(err?.data?.message || "Failed to update role");
		}
	};

	const handleChangeTeam = async () => {
		if (!selectedMember || !selectedTeamId) return;
		try {
			await ownerSetTeam({ user_id: selectedMember.id, team_id: selectedTeamId }).unwrap();
			toast.success(`Team updated for ${selectedMember.username}`);
			setTeamDialogOpen(false);
		} catch (err: any) {
			toast.error(err?.data?.message || "Failed to update team");
		}
	};

	if (isLoading) {
		return <div className="text-muted-foreground p-4 text-sm">Loading members...</div>;
	}

	if (!members || members.length === 0) {
		return <div className="text-muted-foreground p-4 text-sm">No members in this team.</div>;
	}

	return (
		<div className="border-t">
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
					{members.map((member: PlatformUserInfo) => (
						<TableRow key={member.id}>
							<TableCell className="font-medium">{member.username}</TableCell>
							<TableCell>{member.email}</TableCell>
							<TableCell>
								<Badge variant={member.is_admin ? "default" : "secondary"}>{member.role}</Badge>
							</TableCell>
							<TableCell>
								<Badge variant={member.status === "active" ? "default" : "destructive"}>{member.status}</Badge>
							</TableCell>
							<TableCell className="text-right">
								<div className="flex items-center justify-end gap-1">
									{canManage && (
										<>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => {
													setSelectedMember(member);
													setSelectedRole(member.role);
													setRoleDialogOpen(true);
												}}
												title="Change role"
											>
												<Pencil className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => {
													setSelectedMember(member);
													setSelectedTeamId(teamId);
													setTeamDialogOpen(true);
												}}
												title="Change team"
											>
												<Users className="h-4 w-4" />
											</Button>
										</>
									)}
									<Button variant="ghost" size="icon" onClick={() => handleRemove(member.id)}>
										<Trash2 className="text-destructive h-4 w-4" />
									</Button>
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>

			{/* Role Change Dialog */}
			<Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Change Member Role</DialogTitle>
						<DialogDescription>Only team_admin and team_member roles can be assigned by owners.</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 pt-2">
						<p className="text-muted-foreground text-sm">
							Updating role for <span className="font-medium">{selectedMember?.username}</span>
						</p>
						<div className="space-y-2">
							<Label>Role</Label>
							<Select value={selectedRole} onValueChange={setSelectedRole}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="team_admin">team_admin</SelectItem>
									<SelectItem value="team_member">team_member</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<Button onClick={handleChangeRole} className="w-full">
							Update Role
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			{/* Team Change Dialog */}
			<Dialog open={teamDialogOpen} onOpenChange={setTeamDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Change Member Team</DialogTitle>
						<DialogDescription>Move this member to a different team within the same organization.</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 pt-2">
						<p className="text-muted-foreground text-sm">
							Moving <span className="font-medium">{selectedMember?.username}</span> to a different team
						</p>
						<div className="space-y-2">
							<Label>Team</Label>
							<Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{teams.map((t) => (
										<SelectItem key={t.id} value={t.id}>
											{t.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<Button onClick={handleChangeTeam} className="w-full">
							Move to Team
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

// ─── Teams Tab ───────────────────────────────────────────────────

function TeamsTab({ teams, customers }: { teams: PlatformTeam[]; customers: PlatformCustomer[] }) {
	const [createOpen, setCreateOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);
	const [editingTeam, setEditingTeam] = useState<PlatformTeam | null>(null);
	const [newName, setNewName] = useState("");
	const [newCustomerId, setNewCustomerId] = useState<string>("");
	const [editName, setEditName] = useState("");
	const [editCustomerId, setEditCustomerId] = useState<string>("");
	const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

	// Budget dialog state
	const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
	const [budgetTeam, setBudgetTeam] = useState<PlatformTeam | null>(null);
	const [budgetLimit, setBudgetLimit] = useState(0);
	const [budgetDuration, setBudgetDuration] = useState("");

	const { isOwner, isAdmin } = useUserRole();
	const canManage = isOwner || isAdmin;

	const [createTeam, { isLoading: creating }] = usePlatformCreateTeamMutation();
	const [updateTeam, { isLoading: updating }] = usePlatformUpdateTeamMutation();
	const [deleteTeam] = usePlatformDeleteTeamMutation();
	const [ownerSetTeamBudget] = usePlatformOwnerSetTeamBudgetMutation();

	const getCustomerName = (id?: string) => {
		if (!id) return "—";
		const c = customers.find((c) => c.id === id);
		return c?.name ?? id;
	};

	const handleCreate = async () => {
		if (!newName.trim()) return;
		try {
			await createTeam({
				name: newName.trim(),
				customer_id: newCustomerId || undefined,
			}).unwrap();
			toast.success("Team created successfully");
			setNewName("");
			setNewCustomerId("");
			setCreateOpen(false);
		} catch (err: any) {
			toast.error(err?.data?.message || "Failed to create team");
		}
	};

	const handleEdit = (team: PlatformTeam) => {
		setEditingTeam(team);
		setEditName(team.name);
		setEditCustomerId(team.customer_id ?? "");
		setEditOpen(true);
	};

	const handleUpdate = async () => {
		if (!editingTeam || !editName.trim()) return;
		try {
			await updateTeam({
				id: editingTeam.id,
				data: {
					name: editName.trim(),
					customer_id: editCustomerId || undefined,
				},
			}).unwrap();
			toast.success("Team updated successfully");
			setEditOpen(false);
			setEditingTeam(null);
		} catch (err: any) {
			toast.error(err?.data?.message || "Failed to update team");
		}
	};

	const handleDelete = async (id: string) => {
		if (!confirm("Are you sure you want to delete this team?")) return;
		try {
			await deleteTeam(id).unwrap();
			toast.success("Team deleted successfully");
		} catch (err: any) {
			toast.error(err?.data?.message || "Failed to delete team");
		}
	};

	const handleSetBudget = (team: PlatformTeam) => {
		setBudgetTeam(team);
		setBudgetLimit(0);
		setBudgetDuration("");
		setBudgetDialogOpen(true);
	};

	const handleSaveBudget = async () => {
		if (!budgetTeam) return;
		try {
			await ownerSetTeamBudget({
				id: budgetTeam.id,
				max_limit: budgetLimit,
				reset_duration: budgetDuration || undefined,
			}).unwrap();
			toast.success(`Budget set for ${budgetTeam.name}`);
			setBudgetDialogOpen(false);
		} catch (err: any) {
			toast.error(err?.data?.message || "Failed to set budget");
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h2 className="flex items-center gap-2 text-lg font-semibold">
					<Users className="h-5 w-5" />
					Teams
				</h2>
				<Dialog open={createOpen} onOpenChange={setCreateOpen}>
					<DialogTrigger asChild>
						<Button size="sm">
							<Plus className="mr-1.5 h-4 w-4" />
							Create Team
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Create Team</DialogTitle>
						</DialogHeader>
						<div className="space-y-4 pt-2">
							<div className="space-y-2">
								<Label htmlFor="team-name">Name</Label>
								<Input
									id="team-name"
									placeholder="Team name"
									value={newName}
									onChange={(e) => setNewName(e.target.value)}
									onKeyDown={(e) => e.key === "Enter" && handleCreate()}
								/>
							</div>
							<div className="space-y-2">
								<Label>Customer (optional)</Label>
								<Select value={newCustomerId} onValueChange={setNewCustomerId}>
									<SelectTrigger>
										<SelectValue placeholder="Select a customer" />
									</SelectTrigger>
									<SelectContent>
										{customers.map((c) => (
											<SelectItem key={c.id} value={c.id}>
												{c.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<Button onClick={handleCreate} disabled={creating || !newName.trim()} className="w-full">
								{creating ? "Creating..." : "Create"}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</div>

			{teams.length === 0 ? (
				<div className="text-muted-foreground flex items-center justify-center py-12 text-sm">
					No teams found. Create one to get started.
				</div>
			) : (
				<Card>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-8" />
								<TableHead>Name</TableHead>
								<TableHead>ID</TableHead>
								<TableHead>Customer</TableHead>
								<TableHead>Members</TableHead>
								<TableHead>Virtual Keys</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{teams.map((team) => (
								<TeamRow
									key={team.id}
									team={team}
									teams={teams}
									isExpanded={expandedTeamId === team.id}
									onToggleExpand={() => setExpandedTeamId(expandedTeamId === team.id ? null : team.id)}
									getCustomerName={getCustomerName}
									onEdit={handleEdit}
									onDelete={handleDelete}
									onSetBudget={handleSetBudget}
									canManage={canManage}
								/>
							))}
						</TableBody>
					</Table>
				</Card>
			)}

			{/* Edit Dialog */}
			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit Team</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 pt-2">
						<div className="space-y-2">
							<Label htmlFor="edit-team-name">Name</Label>
							<Input
								id="edit-team-name"
								placeholder="Team name"
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
							/>
						</div>
						<div className="space-y-2">
							<Label>Customer</Label>
							<Select value={editCustomerId} onValueChange={setEditCustomerId}>
								<SelectTrigger>
									<SelectValue placeholder="Select a customer" />
								</SelectTrigger>
								<SelectContent>
									{customers.map((c) => (
										<SelectItem key={c.id} value={c.id}>
											{c.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<Button onClick={handleUpdate} disabled={updating || !editName.trim()} className="w-full">
							{updating ? "Saving..." : "Save Changes"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			{/* Budget Dialog */}
			<Dialog open={budgetDialogOpen} onOpenChange={setBudgetDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<DollarSign className="h-5 w-5" />
							Set Team Budget
						</DialogTitle>
						<DialogDescription>Set a spending limit for team &quot;{budgetTeam?.name}&quot;.</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 pt-2">
						<div className="space-y-2">
							<Label htmlFor="budget-limit">Max Limit (credits)</Label>
							<Input
								id="budget-limit"
								type="number"
								step="0.01"
								value={budgetLimit}
								onChange={(e) => setBudgetLimit(Number(e.target.value))}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="budget-duration">Reset Duration (e.g. &quot;24h&quot;, &quot;30d&quot;)</Label>
							<Input id="budget-duration" placeholder="24h" value={budgetDuration} onChange={(e) => setBudgetDuration(e.target.value)} />
						</div>
						<Button onClick={handleSaveBudget} className="w-full">
							Save Budget
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

// ─── Team Row (with expandable members) ──────────────────────────

function TeamRow({
	team,
	teams,
	isExpanded,
	onToggleExpand,
	getCustomerName,
	onEdit,
	onDelete,
	onSetBudget,
	canManage,
}: {
	team: PlatformTeam;
	teams: PlatformTeam[];
	isExpanded: boolean;
	onToggleExpand: () => void;
	getCustomerName: (id?: string) => string;
	onEdit: (team: PlatformTeam) => void;
	onDelete: (id: string) => void;
	onSetBudget: (team: PlatformTeam) => void;
	canManage: boolean;
}) {
	return (
		<>
			<TableRow>
				<TableCell>
					<button onClick={onToggleExpand} className="hover:bg-muted rounded p-0.5">
						<ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
					</button>
				</TableCell>
				<TableCell className="font-medium">{team.name}</TableCell>
				<TableCell>
					<code className="text-xs">{team.id}</code>
				</TableCell>
				<TableCell>{getCustomerName(team.customer_id)}</TableCell>
				<TableCell>
					<Badge variant="secondary">{team.members?.length ?? 0}</Badge>
				</TableCell>
				<TableCell>
					<Badge variant="secondary">{team.virtual_keys?.length ?? 0}</Badge>
				</TableCell>
				<TableCell className="text-right">
					<div className="flex items-center justify-end gap-1">
						{canManage && (
							<Button variant="ghost" size="icon" onClick={() => onSetBudget(team)} title="Set budget">
								<DollarSign className="h-4 w-4" />
							</Button>
						)}
						<Button variant="ghost" size="icon" onClick={() => onEdit(team)}>
							<Pencil className="h-4 w-4" />
						</Button>
						<Button variant="ghost" size="icon" onClick={() => onDelete(team.id)}>
							<Trash2 className="text-destructive h-4 w-4" />
						</Button>
					</div>
				</TableCell>
			</TableRow>
			{isExpanded && (
				<TableRow>
					<TableCell colSpan={7} className="p-0">
						<TeamMembersPanel teamId={team.id} teams={teams} />
					</TableCell>
				</TableRow>
			)}
		</>
	);
}

// ─── Main Page ──────────────────────────────────────────────────

export default function OrganizationsPage() {
	const { data: customers, isLoading: customersLoading } = usePlatformListCustomersQuery();
	const { data: teams, isLoading: teamsLoading } = usePlatformListTeamsQuery();

	const isLoading = customersLoading || teamsLoading;

	return (
		<div className="space-y-6">
			<div>
				<h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
					<Building2 className="h-6 w-6" />
					Organizations
				</h1>
				<p className="text-muted-foreground">Manage customers, teams, and their members.</p>
			</div>

			<Tabs defaultValue="customers" className="space-y-4">
				<TabsList>
					<TabsTrigger value="customers" className="gap-1.5">
						<Building2 className="h-4 w-4" />
						Customers
					</TabsTrigger>
					<TabsTrigger value="teams" className="gap-1.5">
						<Users className="h-4 w-4" />
						Teams
					</TabsTrigger>
				</TabsList>

				{isLoading ? (
					<div className="text-muted-foreground flex items-center justify-center py-12 text-sm">Loading organizations...</div>
				) : (
					<>
						<TabsContent value="customers">
							<CustomersTab customers={customers ?? []} />
						</TabsContent>
						<TabsContent value="teams">
							<TeamsTab teams={teams ?? []} customers={customers ?? []} />
						</TabsContent>
					</>
				)}
			</Tabs>
		</div>
	);
}