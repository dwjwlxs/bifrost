package model

// ─── Platform Role Constants ─────────────────────────────────────
// All role-related constants for the platform multi-tenant system.
//
// Role values are stored in DB (platform_org_members.role,
// platform_team_members.role). Constant NAMES are globally unique
// so that code referencing a role always indicates its context.

// Base role values — the actual strings stored in the database.
const (
	RoleAdmin  = "admin"
	RoleMember = "member"
	RoleOwner  = "owner"
)

// Org-specific role aliases — semantically scoped to organization membership.
const (
	OrgRoleAdmin  = RoleAdmin  // org admin — can manage teams, members, VKs
	OrgRoleMember = RoleMember // org member — read-only access to org info
	OrgRoleOwner  = RoleOwner  // org owner/creator — full org control
)

// Team-specific role aliases — semantically scoped to team membership.
const (
	TeamRoleAdmin  = RoleAdmin  // team admin — can manage members, VKs
	TeamRoleMember = RoleMember // team member — read-only access to team info
)

// Resolved role values — set by middleware on the request context to
// indicate the *effective* role that authorized the request. These differ
// from DB-level roles: "org_admin" implies team_admin for any team in
// the org, "team_admin" is direct team admin, etc.
const (
	ResolvedRoleOrgAdmin   = "org_admin"
	ResolvedRoleTeamAdmin  = "team_admin"
	ResolvedRoleTeamMember = "team_member"
)

// isValidOrgRole returns true if the given string is a valid org member role.
func IsValidOrgRole(role string) bool {
	switch role {
	case OrgRoleAdmin, OrgRoleMember, OrgRoleOwner:
		return true
	default:
		return false
	}
}

// isValidTeamRole returns true if the given string is a valid team member role.
func IsValidTeamRole(role string) bool {
	switch role {
	case TeamRoleAdmin, TeamRoleMember:
		return true
	default:
		return false
	}
}

// isOrgAdminRole returns true if the given DB-level role string represents
// an org admin or owner (both have admin-level permissions).
func IsOrgAdminRole(role string) bool {
	return role == OrgRoleAdmin || role == OrgRoleOwner
}

// isTeamAdminRole returns true if the given DB-level role string represents
// a team admin.
func IsTeamAdminRole(role string) bool {
	return role == TeamRoleAdmin
}
