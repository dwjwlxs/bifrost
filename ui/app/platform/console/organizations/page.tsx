import { useState, useMemo } from "react";
import { getUser } from "@/lib/platform/auth";
import {
  usePlatformListOrgsQuery,
  usePlatformListTeamsQuery,
  usePlatformListOrgTeamsQuery,
  usePlatformListTeamVKsQuery,
  usePlatformListTeamMembersQuery,
} from "@/lib/platform/platformApi";
import { useIsOrgAdmin, useIsTeamAdmin } from "@/lib/platform/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  UsersRound,
  KeyRound,
  UserPlus,
  Copy,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import type {
  PlatformOrg,
  PlatformTeam,
  PlatformVirtualKey,
  PlatformTeamMember,
} from "@/lib/platform/platformApi";
import {
  OrgRoleAdmin,
  OrgRoleOwner,
  OrgRoleMember,
  TeamRoleAdmin,
} from "@/lib/platform/types";
import { InviteMemberDialog } from "./views/InviteMemberDialog";
import { MemberActions } from "./views/MemberActions";
import { CreateMemberVKDialog } from "./views/CreateMemberVKDialog";
import { EditVKBudgetDialog } from "./views/EditVKBudgetDialog";
import { CreateTeamDialog } from "./views/CreateTeamDialog";
import { EditTeamDialog } from "./views/EditTeamDialog";

// ─── Sub-components ─────────────────────────────────────────────

/** Role badge for org/team membership */
function RoleBadge({ role }: { role?: string }) {
  if (!role) return null;
  const variant =
    role === OrgRoleAdmin || role === OrgRoleOwner || role === TeamRoleAdmin
      ? "default"
      : "secondary";
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

/** A single VK row inside a team's expanded section */
function VirtualKeyRow({
  vk,
  teamId,
  isTeamAdmin,
  onEdit,
}: {
  vk: PlatformVirtualKey;
  teamId: string;
  isTeamAdmin: boolean;
  onEdit?: (vk: PlatformVirtualKey) => void;
}) {
  const [revealed, setRevealed] = useState(false);

  const maskKey = (value: string) => {
    if (revealed) return value;
    if (value.length <= 8) return "\u2022".repeat(value.length);
    return (
      value.substring(0, 8) + "\u2022".repeat(Math.max(0, value.length - 8))
    );
  };

  const copyKey = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Key copied to clipboard"),
      () => toast.error("Failed to copy key"),
    );
  };

  const budgetPercent =
    vk.budget_limit && vk.budget_limit > 0
      ? Math.min(((vk.current_usage ?? 0) / vk.budget_limit) * 100, 100)
      : null;

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        {vk.id.slice(0, 8)}...
      </TableCell>
      <TableCell className="font-medium">{vk.name}</TableCell>
      <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
        {vk.description || "\u2014"}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <code className="bg-muted inline-block max-w-[200px] truncate rounded px-1.5 py-0.5 font-mono text-xs">
            {maskKey(vk.value)}
          </code>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
            onClick={() => setRevealed(!revealed)}
            title={revealed ? "Hide key" : "Reveal key"}
          >
            {revealed ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
            onClick={() => copyKey(vk.value)}
            title="Copy key"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </TableCell>
      <TableCell>
        {budgetPercent !== null ? (
          <div className="flex items-center gap-2">
            <div className="bg-muted h-2 w-20 overflow-hidden rounded-full">
              <div
                className={`h-full rounded-full transition-all ${budgetPercent > 90 ? "bg-destructive" : budgetPercent > 70 ? "bg-yellow-500" : "bg-primary"}`}
                style={{ width: `${budgetPercent}%` }}
              />
            </div>
            <span className="text-muted-foreground text-xs">
              ${(vk.current_usage ?? 0).toFixed(2)} / $
              {vk.budget_limit!.toFixed(2)}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">No budget</span>
        )}
      </TableCell>
      {isTeamAdmin && (
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onEdit?.(vk)}
          >
            Edit
          </Button>
        </TableCell>
      )}
    </TableRow>
  );
}

/** Members table (team_admin only) */
function MembersTable({
  members,
  teamId,
  currentUserId,
  onMemberRemoved,
}: {
  members: PlatformTeamMember[];
  teamId: string;
  currentUserId?: string;
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
            <TableHead className="text-xs w-[180px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.user_id}>
              <TableCell className="font-medium text-sm">
                {m.username}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {m.email}
              </TableCell>
              <TableCell>
                <RoleBadge role={m.role} />
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {m.joined_at
                  ? new Date(m.joined_at).toLocaleDateString()
                  : "\u2014"}
              </TableCell>
              <TableCell>
                <MemberActions
                  member={m}
                  teamId={teamId}
                  currentUserId={currentUserId}
                  onMemberRemoved={onMemberRemoved}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Team card with expandable VK list + member management for team_admin */
function TeamSection({ team, isOrgAdmin }: { team: PlatformTeam; isOrgAdmin: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createVKOpen, setCreateVKOpen] = useState(false);
  const [editBudgetVk, setEditBudgetVk] = useState<PlatformVirtualKey | null>(null);
  const [editTeamOpen, setEditTeamOpen] = useState(false);
  const isTeamAdmin = useIsTeamAdmin(team.id);

  const { data: vks, isLoading: vksLoading } = usePlatformListTeamVKsQuery(
    team.id,
    { skip: !expanded },
  );
  const { data: members, isLoading: membersLoading, refetch: refetchMembers } =
    usePlatformListTeamMembersQuery(team.id, {
      skip: !expanded || !isTeamAdmin,
    });

  const currentUserId = getUser()?.id;

  const handleEditBudget = (vk: PlatformVirtualKey) => {
    setEditBudgetVk(vk);
  };

  return (
    <div className="border-l-2 border-primary/20 pl-4">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md py-2 text-left transition-colors hover:bg-accent/50"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0" />
        )}
        <KeyRound className="text-muted-foreground h-4 w-4 flex-shrink-0" />
        <span className="font-medium text-sm">{team.name || team.id}</span>
        <RoleBadge role={team.role} />
        {isOrgAdmin && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-1 h-6 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              setEditTeamOpen(true);
            }}
          >
            Edit
          </Button>
        )}
        <span className="text-muted-foreground ml-auto text-xs">
          {expanded && vks
            ? `${vks.length} key${vks.length !== 1 ? "s" : ""}`
            : ""}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-3">
          {/* Members section — team_admin only */}
          {isTeamAdmin && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UsersRound className="text-muted-foreground h-4 w-4" />
                  <span className="text-sm font-medium">Members</span>
                  {members && (
                    <span className="text-muted-foreground text-xs">
                      ({members.length})
                    </span>
                  )}
                </div>
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
              </div>

              {membersLoading ? (
                <div className="text-muted-foreground py-4 text-center text-sm">
                  Loading members...
                </div>
              ) : members && members.length > 0 ? (
                <MembersTable
                  members={members}
                  teamId={team.id}
                  currentUserId={currentUserId}
                  onMemberRemoved={refetchMembers}
                />
              ) : (
                <div className="text-muted-foreground py-4 text-center text-sm">
                  No members in this team.
                </div>
              )}
            </div>
          )}

          {/* Virtual keys section */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="text-muted-foreground h-4 w-4" />
                <span className="text-sm font-medium">Virtual Keys</span>
                {vks && (
                  <span className="text-muted-foreground text-xs">
                    ({vks.length})
                  </span>
                )}
              </div>
              {isTeamAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreateVKOpen(true);
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Create VK
                </Button>
              )}
            </div>
            {vksLoading ? (
              <div className="text-muted-foreground py-4 text-center text-sm">
                Loading virtual keys...
              </div>
            ) : vks && vks.length > 0 ? (
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">ID</TableHead>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Description</TableHead>
                      <TableHead className="text-xs">Key</TableHead>
                      <TableHead className="text-xs">Budget</TableHead>
                      {isTeamAdmin && (
                        <TableHead className="text-xs">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vks.map((vk) => (
                      <VirtualKeyRow
                        key={vk.id}
                        vk={vk}
                        teamId={team.id}
                        isTeamAdmin={isTeamAdmin}
                        onEdit={handleEditBudget}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-muted-foreground py-4 text-center text-sm">
                No virtual keys in this team.
              </div>
            )}
          </div>
        </div>
      )}

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        teamId={team.id}
        teamName={team.name || team.id}
      />
      <CreateMemberVKDialog
        open={createVKOpen}
        onOpenChange={setCreateVKOpen}
        teamId={team.id}
        teamName={team.name || team.id}
        members={members ?? []}
      />
      {editBudgetVk && (
        <EditVKBudgetDialog
          open={editBudgetVk !== null}
          onOpenChange={(open) => {
            if (!open) setEditBudgetVk(null);
          }}
          vk={editBudgetVk}
          teamId={team.id}
        />
      )}
      <EditTeamDialog
        open={editTeamOpen}
        onOpenChange={setEditTeamOpen}
        team={team}
      />
    </div>
  );
}

/** Organization card with expandable team list */
function OrgCard({
  org,
  userTeamsForOrg,
}: {
  org: PlatformOrg;
  userTeamsForOrg: PlatformTeam[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const isOrgAdmin = useIsOrgAdmin(org.id);

  // org_admin: list ALL teams in the org via dedicated API
  // member: show only the teams the user belongs to (from userTeamsForOrg)
  const { data: apiTeams, isLoading: teamsLoading, refetch: refetchTeams } =
    usePlatformListOrgTeamsQuery(org.id, {
      skip: !expanded || !isOrgAdmin,
    });

  const teams = isOrgAdmin ? apiTeams : userTeamsForOrg;

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none transition-colors hover:bg-accent/30"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {expanded ? (
              <ChevronDown className="h-5 w-5" />
            ) : (
              <ChevronRight className="h-5 w-5" />
            )}
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
              <span>
                Created:{" "}
                {org.created_at
                  ? new Date(org.created_at).toLocaleDateString()
                  : "\u2014"}
              </span>
            </div>

            {/* Teams section */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UsersRound className="text-muted-foreground h-4 w-4" />
                  <span className="text-sm font-medium">
                    {isOrgAdmin ? "All Teams" : "Your Teams"}
                  </span>
                  {teams && (
                    <span className="text-muted-foreground text-xs">
                      ({teams.length})
                    </span>
                  )}
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
                <div className="text-muted-foreground py-4 text-center text-sm">
                  Loading teams...
                </div>
              ) : teams && teams.length > 0 ? (
                <div className="space-y-1">
                  {teams.map((team) => (
                    <TeamSection key={team.id} team={team} isOrgAdmin={isOrgAdmin} />
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground py-4 text-center text-sm">
                  {isOrgAdmin
                    ? "No teams in this organization."
                    : "You are not a member of any team in this organization."}
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
        <p className="text-muted-foreground">
          View your organizations, teams, and virtual keys.
        </p>
      </div>

      {/* Org list */}
      {!orgs || orgs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16">
          <Building2 className="text-muted-foreground/40 mb-4 h-12 w-12" />
          <p className="mb-1 text-lg font-medium">No organizations yet</p>
          <p className="text-muted-foreground max-w-sm text-center text-sm leading-relaxed">
            Contact your organization administrator or team manager and ask them
            to send you an invitation. You&apos;ll receive an email with a link
            — just click it to join the organization.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orgs.map((org) => (
            <OrgCard
              key={org.id}
              org={org}
              userTeamsForOrg={teamsByOrg.get(org.id) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
