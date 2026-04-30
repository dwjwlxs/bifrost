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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdownMenu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	getErrorMessage,
	useAssignUserCustomRoleMutation,
	useGetUsersQuery,
	useRemoveUserCustomRoleMutation,
	useSetUserRoleMutation,
	useSetUserTeamMutation,
	useSetUserCustomerMutation,
	useGetUserRolesQuery,
	useGetTeamsQuery,
	useGetCustomersQuery,
} from "@/lib/store";
import { Customer, PresetRole, Team, User } from "@/lib/types/governance";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/governance";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { Ban, ChevronLeft, ChevronRight, MoreHorizontal, Shield, UserCog, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface UsersTableProps {
	users: User[];
	totalCount: number;
	teams: Team[];
	customers: Customer[];
	search: string;
	debouncedSearch: string;
	onSearchChange: (value: string) => void;
	offset: number;
	limit: number;
	onOffsetChange: (offset: number) => void;
}

const PRESET_ROLE_OPTIONS: { value: PresetRole; label: string }[] = [
	{ value: "admin", label: "Admin" },
	{ value: "customer_owner", label: "Customer Owner" },
	{ value: "team_admin", label: "Team Admin" },
	{ value: "team_member", label: "Team Member" },
	{ value: "user", label: "User" },
];

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
	active: "default",
	banned: "destructive",
	deleted: "secondary",
};

function RoleSelectDialog({
	user,
	currentRole,
	onClose,
	teams,
	customers,
}: {
	user: User;
	currentRole: PresetRole;
	onClose: () => void;
	teams: Team[];
	customers: Customer[];
}) {
	const [tab, setTab] = useState<"preset" | "team" | "customer">("preset");
	const [selectedRole, setSelectedRole] = useState<PresetRole>(currentRole);
	const [selectedTeamId, setSelectedTeamId] = useState<string>(user.team_id || "");
	const [selectedCustomerId, setSelectedCustomerId] = useState<string>(user.customer_id || "");

	const [setUserRole, { isLoading: isSettingRole }] = useSetUserRoleMutation();
	const [setUserTeam, { isLoading: isSettingTeam }] = useSetUserTeamMutation();
	const [setUserCustomer, { isLoading: isSettingCustomer }] = useSetUserCustomerMutation();

	const isLoading = isSettingRole || isSettingTeam || isSettingCustomer;

	const handleSave = async () => {
		try {
			if (tab === "preset") {
				await setUserRole({ target_user_id: user.id, role: selectedRole }).unwrap();
				toast.success(`Role set to "${selectedRole}" for ${user.username}`);
			} else if (tab === "team") {
				await setUserTeam({ target_user_id: user.id, team_id: selectedTeamId }).unwrap();
				toast.success(`Assigned ${user.username} to team`);
			} else if (tab === "customer") {
				await setUserCustomer({ target_user_id: user.id, customer_id: selectedCustomerId }).unwrap();
				toast.success(`Assigned ${user.username} to customer`);
			}
			onClose();
		} catch (err) {
			toast.error(getErrorMessage(err));
		}
	};

	return (
		<AlertDialog open onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent className="max-w-lg">
				<AlertDialogHeader>
					<AlertDialogTitle>Manage User: {user.username}</AlertDialogTitle>
					<AlertDialogDescription>Set role, assign to team or customer for {user.email}</AlertDialogDescription>
				</AlertDialogHeader>

				<Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-2">
					<TabsList className="grid w-full grid-cols-3">
						<TabsTrigger value="preset">Role</TabsTrigger>
						<TabsTrigger value="team">Team</TabsTrigger>
						<TabsTrigger value="customer">Customer</TabsTrigger>
					</TabsList>

					<TabsContent value="preset" className="space-y-3 py-3">
						<p className="text-muted-foreground text-sm">Select a preset RBAC role:</p>
						<div className="space-y-1">
							{PRESET_ROLE_OPTIONS.map((opt) => (
								<button
									key={opt.value}
									onClick={() => setSelectedRole(opt.value)}
									className={cn(
										"flex w-full items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors",
										selectedRole === opt.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted",
									)}
								>
									<Shield className="h-4 w-4 shrink-0" />
									<span className="font-medium">{opt.label}</span>
									<span className="text-muted-foreground ml-auto text-xs">{opt.value}</span>
								</button>
							))}
						</div>
					</TabsContent>

					<TabsContent value="team" className="space-y-3 py-3">
						<p className="text-muted-foreground text-sm">Assign user to a team:</p>
						<select
							className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm"
							value={selectedTeamId}
							onChange={(e) => setSelectedTeamId(e.target.value)}
						>
							<option value="">— No Team —</option>
							{teams.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
									{t.customer_id ? ` (${t.customer_id})` : ""}
								</option>
							))}
						</select>
					</TabsContent>

					<TabsContent value="customer" className="space-y-3 py-3">
						<p className="text-muted-foreground text-sm">Assign user to a customer/organization:</p>
						<select
							className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm"
							value={selectedCustomerId}
							onChange={(e) => setSelectedCustomerId(e.target.value)}
						>
							<option value="">— No Customer —</option>
							{customers.map((c) => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
						</select>
					</TabsContent>
				</Tabs>

				<AlertDialogFooter>
					<AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
					<Button onClick={handleSave} disabled={isLoading}>
						{isLoading ? "Saving..." : "Save Changes"}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export default function UsersTable({
	users,
	totalCount,
	teams,
	customers,
	search,
	debouncedSearch,
	onSearchChange,
	offset,
	limit,
	onOffsetChange,
}: UsersTableProps) {
	const [editingUser, setEditingUser] = useState<User | null>(null);

	const hasUpdateAccess = useRbac(RbacResource.Users, RbacOperation.Update);

	const totalPages = Math.ceil(totalCount / limit);
	const currentPage = Math.floor(offset / limit) + 1;

	const handlePrev = () => {
		if (offset > 0) onOffsetChange(Math.max(0, offset - limit));
	};

	const handleNext = () => {
		if (offset + limit < totalCount) onOffsetChange(offset + limit);
	};

	const hasActiveFilters = debouncedSearch;

	if (totalCount === 0 && !hasActiveFilters) {
		return (
			<div className="flex min-h-[80vh] w-full flex-col items-center justify-center gap-4 py-16 text-center">
				<div className="text-muted-foreground">
					<UserCog className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />
				</div>
				<div className="flex flex-col gap-1">
					<h1 className="text-muted-foreground text-xl font-medium">No users yet</h1>
					<div className="text-muted-foreground mx-auto mt-2 max-w-[600px] text-sm font-normal">
						Users will appear here once they register or are invited to the platform.
					</div>
				</div>
			</div>
		);
	}

	return (
		<>
			{editingUser && (
				<RoleSelectDialog
					user={editingUser}
					currentRole={editingUser.role}
					onClose={() => setEditingUser(null)}
					teams={teams}
					customers={customers}
				/>
			)}

			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-lg font-semibold">Users</h2>
						<p className="text-muted-foreground text-sm">Manage user accounts, roles, and organization assignments.</p>
					</div>
				</div>

				<div className="flex items-center gap-3">
					<div className="relative max-w-sm flex-1">
						<Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
						<Input
							aria-label="Search users by email or username"
							placeholder="Search by email or username..."
							value={search}
							onChange={(e) => onSearchChange(e.target.value)}
							className="pl-9"
						/>
					</div>
					<span className="text-muted-foreground text-sm">{totalCount} total</span>
				</div>

				<div className="overflow-hidden rounded-sm border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>User</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Balance</TableHead>
								<TableHead>Team</TableHead>
								<TableHead>Customer</TableHead>
								<TableHead>Joined</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{users.length === 0 ? (
								<TableRow>
									<TableCell colSpan={8} className="h-24 text-center">
										<span className="text-muted-foreground text-sm">No matching users found.</span>
									</TableCell>
								</TableRow>
							) : (
								users.map((user) => {
									const team = teams.find((t) => t.id === user.team_id);
									const customer = customers.find((c) => c.id === user.customer_id);

									return (
										<TableRow key={user.id}>
											<TableCell className="py-4">
												<div className="flex flex-col gap-0.5">
													<span className="font-medium">{user.username}</span>
													<span className="text-muted-foreground text-xs">{user.email}</span>
													{user.nickname && <span className="text-muted-foreground text-xs">{user.nickname}</span>}
												</div>
											</TableCell>
											<TableCell>
												<Badge variant="outline" className="text-xs">
													{user.role}
												</Badge>
												{user.is_admin && (
													<Badge variant="destructive" className="ml-1 text-xs">
														admin
													</Badge>
												)}
											</TableCell>
											<TableCell>
												<Badge variant={STATUS_VARIANTS[user.status] || "outline"} className="text-xs">
													{user.status}
												</Badge>
											</TableCell>
											<TableCell>
												<span className="text-sm">{formatCurrency(user.balance)}</span>
											</TableCell>
											<TableCell>
												{team ? (
													<Badge variant="secondary" className="text-xs">
														{team.name}
													</Badge>
												) : (
													<span className="text-muted-foreground text-sm">—</span>
												)}
											</TableCell>
											<TableCell>
												{customer ? (
													<Badge variant="secondary" className="text-xs">
														{customer.name}
													</Badge>
												) : (
													<span className="text-muted-foreground text-sm">—</span>
												)}
											</TableCell>
											<TableCell>
												<span className="text-muted-foreground text-xs">{new Date(user.created_at).toLocaleDateString()}</span>
											</TableCell>
											<TableCell className="text-right">
												{hasUpdateAccess && (
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button variant="ghost" size="sm" className="h-8 w-8 p-0">
																<MoreHorizontal className="h-4 w-4" />
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuLabel>Actions</DropdownMenuLabel>
															<DropdownMenuSeparator />
															<DropdownMenuItem onClick={() => setEditingUser(user)} className="cursor-pointer">
																<UserCog className="mr-2 h-4 w-4" />
																Manage Role / Team
															</DropdownMenuItem>
															{user.status === "active" && (
																<DropdownMenuItem className="text-destructive focus:text-destructive cursor-pointer" disabled>
																	<Ban className="mr-2 h-4 w-4" />
																	Ban User
																</DropdownMenuItem>
															)}
														</DropdownMenuContent>
													</DropdownMenu>
												)}
											</TableCell>
										</TableRow>
									);
								})
							)}
						</TableBody>
					</Table>
				</div>

				{totalPages > 1 && (
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">
							Page {currentPage} of {totalPages}
						</span>
						<div className="flex items-center gap-2">
							<Button variant="outline" size="sm" onClick={handlePrev} disabled={offset === 0}>
								<ChevronLeft className="h-4 w-4" />
								Previous
							</Button>
							<Button variant="outline" size="sm" onClick={handleNext} disabled={offset + limit >= totalCount}>
								Next
								<ChevronRight className="h-4 w-4" />
							</Button>
						</div>
					</div>
				)}
			</div>
		</>
	);
}