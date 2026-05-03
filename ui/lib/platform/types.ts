/**
 * Platform shared type definitions.
 *
 * Single source of truth for all platform types — used by auth.ts,
 * endpoint modules, and UI components alike.
 */

// ─── Role Constants ─────────────────────────────────────────────
// Role VALUES are the actual strings stored in the database and returned
// by the API. Constant NAMES are globally unique so that code always
// indicates whether it's an org or team context.

/** Base role values — the actual strings stored in the database */
export const RoleAdmin = "admin" as const;
export const RoleMember = "member" as const;
export const RoleOwner = "owner" as const;

/** Org-specific role aliases — semantically scoped to organization membership */
export const OrgRoleAdmin = RoleAdmin;   // org admin — can manage teams, members, VKs
export const OrgRoleMember = RoleMember; // org member — read-only access to org info
export const OrgRoleOwner = RoleOwner;   // org owner/creator — full org control

/** Team-specific role aliases — semantically scoped to team membership */
export const TeamRoleAdmin = RoleAdmin;   // team admin — can manage members, VKs
export const TeamRoleMember = RoleMember; // team member — read-only access to team info

/** Resolved role values — set by backend middleware to indicate the effective role */
export const ResolvedRoleOrgAdmin = "org_admin" as const;
export const ResolvedRoleTeamAdmin = "team_admin" as const;
export const ResolvedRoleTeamMember = "team_member" as const;

/** All possible org member role values */
export type OrgRole = typeof OrgRoleAdmin | typeof OrgRoleMember | typeof OrgRoleOwner;

/** All possible team member role values */
export type TeamRole = typeof TeamRoleAdmin | typeof TeamRoleMember;

/** All possible DB-level role values (union of org + team) */
export type PlatformRole = OrgRole | TeamRole;

// ─── User & Membership ────────────────────────────────────────────

export interface PlatformUserInfo {
	id: string;
	email: string;
	username: string;
	nickname: string;
	balance: number;
	is_admin: boolean;
	is_email_verified: boolean;
	/** Primary role label for display (admin | customer_owner | team_admin | team_member | user) */
	role: string;
	/** Orgs the user belongs to */
	orgs: PlatformOrg[];
	/** Teams the user belongs to */
	teams: PlatformTeam[];
	/** Legacy: primary org id (for backward compat) */
	customer_id?: string;
	/** Legacy: primary team id (for backward compat) */
	team_id?: string;
	status: string;
	created_at: string;
	updated_at: string;
}

/** Organization (aka Customer) — full API response type.
 *  The optional `role` field is populated in JWT membership context. */
export interface PlatformOrg {
	id: string;
	name?: string;
	owner_user_id?: string;
	/** Owner's username (resolved from auth_users by backend) */
	owner_username?: string;
	budget_id?: string;
	rate_limit_id?: string;
	/** User's role within this org (present in JWT / membership context) */
	role?: OrgRole;
	created_at?: string;
	updated_at?: string;
}

/** Team — full API response type.
 *  The optional `role` field is populated in JWT membership context. */
export interface PlatformTeam {
	id: string;
	name?: string;
	customer_id?: string;
	owner_user_id?: string;
	budget_limit?: number;
	budget_spent?: number;
	budget_reset_at?: string;
	/** User's role within this team (present in JWT / membership context) */
	role?: TeamRole;
	created_at?: string;
	updated_at?: string;
}

// ─── Membership & Invitation ──────────────────────────────────────

/** Organization member (user membership in an org) */
export interface PlatformOrgMember {
	user_id: string;
	email: string;
	username: string;
	role: OrgRole;
	joined_at?: string;
}

/** Team member */
export interface PlatformTeamMember {
	user_id: string;
	email: string;
	username: string;
	role: TeamRole;
	joined_at?: string;
}

/** Invitation record */
export interface PlatformInvitation {
	id: string;
	token?: string;
	org_id?: string;
	team_id?: string;
	email: string;
	role: string;
	accepted: boolean;
	expires_at: string;
	created_at?: string;
}

/** Response from GET /api/platform/invitations/:token */
export interface PlatformInvitationDetails extends PlatformInvitation {
	org_name: string;
	team_name: string;
}

// ─── Virtual Key ──────────────────────────────────────────────────

export interface PlatformVirtualKey {
	id: string;
	name: string;
	value: string;
	description?: string;
	is_active: boolean;
	user_id?: string;
	team_id?: string;
	customer_id?: string;
	budget_limit?: number;
	budget_reset_duration?: string;
	current_usage?: number;
	created_at: string;
	updated_at: string;
}

// ─── RBAC ─────────────────────────────────────────────────────────

export interface PlatformCustomRole {
	id: string;
	name: string;
	scope: string;
	customer_id?: string;
	team_id?: string;
	permissions: string[];
	description?: string;
	created_at: string;
	updated_at: string;
}

export interface PlatformUserRole {
	user_id: number;
	role_id: string;
	customer_id?: string;
	team_id?: string;
	role?: PlatformCustomRole;
}

// ─── Billing Types ────────────────────────────────────────────────

export interface PlatformPackage {
	id: number;
	name: string;
	description: string;
	token_amount: number;
	credits: number;
	price: number;
	currency: string;
	package_type: string;
	duration_days: number | null;
	features: string[];
	is_active: boolean;
	sort_order: number;
	created_at: string;
}

export interface PlatformUserPackage {
	id: number;
	package_id: number;
	package_name: string;
	remaining_credits: number;
	remaining_tokens: number;
	remaining_calls: number;
	expires_at: string;
	status: string;
	created_at: string;
}

export interface PlatformOrder {
	id: number;
	order_no: string;
	package_id?: number;
	package_name: string;
	token_amount: number;
	original_price: number;
	discount_amount: number;
	final_amount: number;
	currency: string;
	status: string;
	payment_method: string;
	payment_no?: string;
	paid_at?: string;
	created_at: string;
}

export interface PlatformRecharge {
	id: number;
	recharge_no: string;
	amount: number;
	bonus_amount: number;
	final_amount: number;
	currency: string;
	payment_method: string;
	payment_no?: string;
	status: string;
	paid_at?: string;
	created_at: string;
}

export interface PlatformBalance {
	balance: number;
	package_credits: number;
	total_credits: number;
	currency: string;
}

export interface PlatformBalanceHistoryItem {
	type: string; // recharge | purchase | usage
	id: number;
	amount: number;
	note: string;
	status: string;
	created_at: string;
}

export interface PlatformUsageStatRow {
	key: string;
	call_count: number;
	input_tokens: number;
	output_tokens: number;
	total_tokens: number;
	credits_consumed: number;
}

export interface PlatformUsageStats {
	start_date: string;
	end_date: string;
	group_by: string;
	summary: {
		total_calls: number;
		total_tokens: number;
		total_credits: number;
	};
	details: PlatformUsageStatRow[];
}

export interface PlatformTokenUsage {
	id: number;
	api_key_id: string;
	package_id?: number;
	input_tokens: number;
	output_tokens: number;
	token_used: number;
	cost: number;
	deduct_source: string;
	model: string;
	provider: string;
	request_id?: string;
	created_at: string;
}

export interface PlatformModelPrice {
	id: number;
	model: string;
	provider: string;
	input_token_price: number;
	output_token_price: number;
	created_at: string;
	updated_at: string;
}
