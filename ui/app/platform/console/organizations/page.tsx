import { useState, useMemo } from "react";
import { getUser } from "@/lib/platform/auth";
import {
	usePlatformListOrgsQuery,
	usePlatformListTeamsQuery,
	usePlatformListOrgTeamsQuery,
	usePlatformListTeamMembersQuery,
} from "@/lib/platform/platformApi";
import { useIsOrgAdmin, useIsTeamAdmin } from "@/lib/platform/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Building2, ChevronDown, ChevronRight, UsersRound, KeyRound, UserPlus, Plus, FolderOpen, Network, Settings } from "lucide-react";
import type { PlatformOrg, PlatformTeam, PlatformTeamMember } from "@/lib/platform/platformApi";
import { OrgRoleAdmin, OrgRoleOwner, OrgRoleMember, TeamRoleAdmin } from "@/lib/platform/types";
import { InviteMemberDialog } from "./views/InviteMemberDialog";
import { MemberActions } from "./views/MemberActions";
import { CreateTeamDialog } from "./views/CreateTeamDialog";
import { EditTeamDialog } from "./views/EditTeamDialog";
import { TeamVKsDialog } from "./views/TeamVKsDialog";
import { TeamMyVKsDialog } from "./views/TeamMyVKsDialog";
import { CreateMemberVKDialog } from "./views/CreateMemberVKDialog";

// ─── Sub-components ─────────────────────────────────────────────

/** Role badge for org/team membership */
function RoleBadge({ role }: { role?: string }) {
	if (!role) return null;
	const variant = role === OrgRoleAdmin || role === OrgRoleOwner || role === TeamRoleAdmin ? "default" : "secondary";
	const label =
		role === OrgRoleAdmin
			? "Admin"
			: role === OrgRoleOwner
				? "Owner"
				: role === OrgRoleMember
					? "Member"
					: role === TeamRoleAdmin
						? "Admin"
						: role;
	return <Badge variant={variant}>{label}</Badge>;
}

/** Members table — visible to all team members, actions only for team_admin */
function MembersTable({
	members,
	teamId,
	currentUserId,
	isTeamAdmin,
	onMemberRemoved,
}: {
	members: PlatformTeamMember[];
	teamId: string;
	currentUserId?: string;
	isTeamAdmin: boolean;
	onMemberRemoved?: () => void;
}) {
	return (
		<div className="overflow-hidden rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="text-xs">Username</TableHead>
						<TableHead className="text-xs">Email</TableHead>
						<TableHead className="text-xs">Role</TableHead>
						<TableHead className="text-xs">Joined</TableHead>
						{isTeamAdmin && <TableHead className="w-[80px] text-xs">Actions</TableHead>}
					</TableRow>
				</TableHeader>
				<TableBody>
					{members.map((m) => (
						<TableRow key={m.user_id}>
							<TableCell className="text-sm font-medium">{m.username}</TableCell>
							<TableCell className="text-muted-foreground text-sm">{m.email}</TableCell>
							<TableCell>
								<RoleBadge role={m.role} />
							</TableCell>
							<TableCell className="text-muted-foreground text-xs">
								{m.joined_at ? new Date(m.joined_at).toLocaleDateString() : "\u2014"}
							</TableCell>
							{isTeamAdmin && (
								<TableCell>
									<MemberActions member={m} teamId={teamId} currentUserId={currentUserId} onMemberRemoved={onMemberRemoved} />
								</TableCell>
							)}
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

/** Team card with expandable members list + VK dialogs */
function TeamSection({ team, isOrgAdmin }: { team: PlatformTeam; isOrgAdmin: boolean }) {
	const [expanded, setExpanded] = useState(false);
	const [inviteOpen, setInviteOpen] = useState(false);
	const [editTeamOpen, setEditTeamOpen] = useState(false);
	const [myVKsOpen, setMyVKsOpen] = useState(false);
	const [allVKsOpen, setAllVKsOpen] = useState(false);
	const [createVKOpen, setCreateVKOpen] = useState(false);
	const isTeamAdmin = useIsTeamAdmin(team.id);

	// Members: always fetch when expanded (visible to all team members)
	const {
		data: members,
		isLoading: membersLoading,
		refetch: refetchMembers,
	} = usePlatformListTeamMembersQuery(team.id, {
		skip: !expanded,
	});

	const currentUserId = getUser()?.id;
	const canViewAllVKs = isTeamAdmin || isOrgAdmin;

	return (
		<div className="border-primary/20 border-l-2 pl-4">
			{/* Team header — name + VK action buttons */}
			<div className="flex w-full items-center gap-2 py-2">
				<button
					type="button"
					className="hover:bg-accent/50 flex flex-1 items-center gap-2 rounded-md text-left transition-colors"
					onClick={() => setExpanded(!expanded)}
				>
					{expanded ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
					<FolderOpen className="text-muted-foreground h-4 w-4 flex-shrink-0" />
					<span className="text-sm font-medium">{team.name || team.id}</span>
					<RoleBadge role={team.role} />
				</button>

				{/* VK action buttons — right-aligned in header */}
				<div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
					<Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setMyVKsOpen(true)}>
						<KeyRound className="h-3.5 w-3.5" />
						My Keys
					</Button>
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<span>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 gap-1.5 text-xs"
										disabled={!canViewAllVKs}
										onClick={() => setAllVKsOpen(true)}
									>
										<KeyRound className="h-3.5 w-3.5" />
										All Keys
									</Button>
								</span>
							</TooltipTrigger>
							{!canViewAllVKs && <TooltipContent>Requires Team Admin or Org Admin role</TooltipContent>}
						</Tooltip>
					</TooltipProvider>
					{isTeamAdmin && (
						<Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setCreateVKOpen(true)}>
							<Plus className="h-3.5 w-3.5" />
							Create VK
						</Button>
					)}
					{isOrgAdmin && (
						<Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setEditTeamOpen(true)}>
							<Settings className="h-3.5 w-3.5" />
							Edit
						</Button>
					)}
				</div>
			</div>

			{expanded && (
				<div className="mt-2 space-y-3">
					{/* Members section — visible to all team members */}
					<div>
						<div className="mb-2 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<UsersRound className="text-muted-foreground h-4 w-4" />
								<span className="text-sm font-medium">Members</span>
								{members && <span className="text-muted-foreground text-xs">({members.length})</span>}
							</div>
							{isTeamAdmin && (
								<Button
									variant="outline"
									size="sm"
									className="h-7 gap-1.5 text-xs"
									onClick={(e) => {
										e.stopPropagation();
										setInviteOpen(true);
									}}
								>
									<UserPlus className="h-3.5 w-3.5" />
									Invite
								</Button>
							)}
						</div>

						{membersLoading ? (
							<div className="text-muted-foreground py-4 text-center text-sm">Loading members...</div>
						) : members && members.length > 0 ? (
							<MembersTable
								members={members}
								teamId={team.id}
								currentUserId={currentUserId}
								isTeamAdmin={isTeamAdmin}
								onMemberRemoved={refetchMembers}
							/>
						) : (
							<div className="text-muted-foreground py-4 text-center text-sm">No members in this team.</div>
						)}
					</div>
				</div>
			)}

			<InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} teamId={team.id} teamName={team.name || team.id} />
			<TeamMyVKsDialog open={myVKsOpen} onOpenChange={setMyVKsOpen} teamId={team.id} teamName={team.name || team.id} />
			<TeamVKsDialog
				open={allVKsOpen}
				onOpenChange={setAllVKsOpen}
				teamId={team.id}
				teamName={team.name || team.id}
				isTeamAdmin={isTeamAdmin}
			/>
			<EditTeamDialog open={editTeamOpen} onOpenChange={setEditTeamOpen} team={team} />
			<CreateMemberVKDialog
				open={createVKOpen}
				onOpenChange={setCreateVKOpen}
				teamId={team.id}
				teamName={team.name || team.id}
				members={members ?? []}
			/>
		</div>
	);
}

/** Organization card with expandable team list */
function OrgCard({ org, userTeamsForOrg }: { org: PlatformOrg; userTeamsForOrg: PlatformTeam[] }) {
	const [expanded, setExpanded] = useState(false);
	const [createTeamOpen, setCreateTeamOpen] = useState(false);
	const isOrgAdmin = useIsOrgAdmin(org.id);

	// org_admin: list ALL teams in the org via dedicated API
	// member: show only the teams the user belongs to (from userTeamsForOrg)
	const {
		data: apiTeams,
		isLoading: teamsLoading,
		refetch: refetchTeams,
	} = usePlatformListOrgTeamsQuery(org.id, {
		skip: !expanded || !isOrgAdmin,
	});

	const teams = isOrgAdmin ? apiTeams : userTeamsForOrg;

	return (
		<Card>
			<CardHeader className="hover:bg-accent/30 cursor-pointer transition-colors select-none" onClick={() => setExpanded(!expanded)}>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						{expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
						<Building2 className="text-muted-foreground h-5 w-5" />
						<CardTitle className="text-base">{org.name || org.id}</CardTitle>
						<RoleBadge role={org.role} />
					</div>
					<div className="text-muted-foreground flex items-center gap-2 text-xs">
						<span className="font-mono">{org.id.slice(0, 8)}...</span>
					</div>
				</div>
			</CardHeader>

			{expanded && (
				<CardContent className="pt-0">
					<div className="space-y-3">
						{/* Org info row */}
						<div className="text-muted-foreground flex items-center gap-4 text-xs">
							<span>Created: {org.created_at ? new Date(org.created_at).toLocaleDateString() : "\u2014"}</span>
						</div>

						{/* Teams section */}
						<div>
							<div className="mb-2 flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Network className="text-muted-foreground h-4 w-4" />
									<span className="text-sm font-medium">{isOrgAdmin ? "All Teams" : "Your Teams"}</span>
									{teams && <span className="text-muted-foreground text-xs">({teams.length})</span>}
								</div>
								{isOrgAdmin && (
									<Button
										variant="outline"
										size="sm"
										className="h-7 gap-1.5 text-xs"
										onClick={(e) => {
											e.stopPropagation();
											setCreateTeamOpen(true);
										}}
									>
										<UserPlus className="h-3.5 w-3.5" />
										Create Team
									</Button>
								)}
							</div>

							{teamsLoading ? (
								<div className="text-muted-foreground py-4 text-center text-sm">Loading teams...</div>
							) : teams && teams.length > 0 ? (
								<div className="space-y-1">
									{teams.map((team) => (
										<TeamSection key={team.id} team={team} isOrgAdmin={isOrgAdmin} />
									))}
								</div>
							) : (
								<div className="text-muted-foreground py-4 text-center text-sm">
									{isOrgAdmin ? "No teams in this organization." : "You are not a member of any team in this organization."}
								</div>
							)}
						</div>
					</div>
				</CardContent>
			)}

			<CreateTeamDialog
				open={createTeamOpen}
				onOpenChange={setCreateTeamOpen}
				orgId={org.id}
				orgName={org.name || org.id}
				onCreated={refetchTeams}
			/>
		</Card>
	);
}

// ─── Main Page ────────────────────────────────────────────────────

export default function OrganizationsPage() {
	const { data: orgs, isLoading: orgsLoading } = usePlatformListOrgsQuery();
	// Fetch all teams the user belongs to — used for non-admin org member view
	const { data: userTeams } = usePlatformListTeamsQuery();

	// Group user's teams by customer_id (org_id) for non-admin org view
	const teamsByOrg = useMemo(() => {
		const map = new Map<string, PlatformTeam[]>();
		if (!userTeams) return map;
		for (const team of userTeams) {
			const orgId = team.customer_id;
			if (!orgId) continue;
			const list = map.get(orgId) ?? [];
			list.push(team);
			map.set(orgId, list);
		}
		return map;
	}, [userTeams]);

	if (orgsLoading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
				<p className="text-muted-foreground">View your organizations, teams, and virtual keys.</p>
			</div>

			{/* Org list */}
			{!orgs || orgs.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16">
					<Building2 className="text-muted-foreground/40 mb-4 h-12 w-12" />
					<p className="mb-1 text-lg font-medium">No organizations yet</p>
					<p className="text-muted-foreground max-w-sm text-center text-sm leading-relaxed">
						Contact your organization administrator or team manager and ask them to send you an invitation. You&apos;ll receive an email
						with a link — just click it to join the organization.
					</p>
				</div>
			) : (
				<div className="space-y-3">
					{orgs.map((org) => (
						<OrgCard key={org.id} org={org} userTeamsForOrg={teamsByOrg.get(org.id) ?? []} />
					))}
				</div>
			)}
		</div>
	);
}