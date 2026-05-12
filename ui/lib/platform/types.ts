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
export const OrgRoleAdmin = RoleAdmin; // org admin — can manage teams, members, VKs
export const OrgRoleMember = RoleMember; // org member — read-only access to org info
export const OrgRoleOwner = RoleOwner; // org owner/creator — full org control

/** Team-specific role aliases — semantically scoped to team membership */
export const TeamRoleAdmin = RoleAdmin; // team admin — can manage members, VKs
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
	id: string; // UUID
	name: string;
	description: string;
	price: number;
	quota: number; // credits amount (1 credit = $0.01)
	duration: number; // days; 0 = no expiry
	auto_renew: boolean;
	target_type: "user" | "customer" | "both"; // user=个人, customer=组织, both=均可
	max_purchase_per_user: number;
	is_active: boolean;
	sort_order: number;
	rate_limit_config?: string; // JSON string
	allowed_models?: string; // JSON string
	off_peak_discount?: string; // JSON string
	stripe_price_id?: string;
	created_at: string;
	updated_at?: string;
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
	id: number; // integer auto-increment
	order_no: string;
	type: string;
	amount: number;
	credits: number;
	status: string;
	gateway?: string; // payment gateway: stripe / alipay / manual
	payment_method?: string; // payment method type: card / alipay / bank_transfer / admin
	payment_id?: string;
	checkout_url?: string; // hosted checkout URL for pending orders
	checkout_expires_at?: string; // ISO8601 expiry time
	paid_at?: string;
	package_id?: string | null; // UUID, null for recharge orders
	entity_package_id?: string | null; // UUID
	created_at: string;
	updated_at: string;
	user_id?: string;
	customer_id?: string;
	tenant_type: "personal" | "organization";
	tenant_id: string;
}

/** Recharge response — extends order with optional Stripe checkout URL */
export interface PlatformRechargeResponse extends PlatformOrder {
	checkout_url?: string;
}

/** Purchase response — extends order with package details and optional checkout URL */
export interface PlatformPurchaseResponse extends PlatformOrder {
	package?: PlatformPackage;
	checkout_url?: string;
}

/** Payment gateway with supported payment methods */
export interface PlatformGateway {
	gateway: string;
	name: string;
	methods: { type: string; name: string }[];
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
	balance: number; // wallet balance in USD
	balance_credits: number; // wallet balance in credits (USD * 100)
	package_credits: number; // sum of all active package budgets in credits
	total_credits: number; // balance_credits + package_credits (all in credits)
}

export interface PlatformBalanceHistoryItem {
	type: string; // recharge | purchase | usage
	id: number;
	amount: number;
	note: string;
	status: string;
	created_at: string;
}

export interface PlatformEntityPackage {
	id: string; // UUID
	package_id: string; // UUID
	budget_id: string;
	rate_limit_id: string;
	user_provider_config_id: string;
	user_id?: string;
	customer_id?: string;
	tenant_type: "personal" | "organization";
	tenant_id: string;
	auto_renew: boolean;
	renewed_from_id?: string;
	started_at: string;
	expires_at: string;
	source: string;
	order_id: string;
	status: "active" | "expired" | "cancelled";
	off_peak_discount?: string; // JSON string e.g. "0.2"
	package?: PlatformPackage;
	created_at: string;
	updated_at: string;
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

// PlatformModelPrice 已迁移到 Governance PricingOverride
// 消费者请从 @/lib/types/governance 导入 PricingOverride / PricingOverridePatch 等

// ---- Unified Usage Types (org + team) ----

/**
 * Shared daily usage row for overview and breakdown.
 * Used by both overview (single series) and breakdown (per-group series).
 */
export interface PlatformUsageDailyRow {
	date: string;
	requests: number;
	input_tokens: number;
	output_tokens: number;
	tokens: number;
	cost: number;
}

/** Summary totals in overview response */
export interface PlatformUsageSummary {
	requests: number;
	input_tokens: number;
	output_tokens: number;
	tokens: number;
	cost: number;
}

/**
 * Usage overview — unified response for org and team scopes.
 * Response to GET /usage/orgs/{orgId}/overview and /usage/teams/{teamId}/overview.
 */
export interface PlatformUsageOverviewResponse {
	start_date: string;
	end_date: string;
	summary: PlatformUsageSummary;
	daily: PlatformUsageDailyRow[];
}

/**
 * Ranking entry — used in breakdown response.
 * key: team_id / user_id depending on dimension.
 * name: resolved display name (team name / username).
 */
export interface PlatformUsageRankingEntry {
	key: string;
	name: string;
	requests: number;
	tokens: number;
	cost: number;
}

/**
 * Daily series for a single ranked entity in breakdown.
 */
export interface PlatformUsageGroupDaily extends PlatformUsageDailyRow {}

/**
 * Breakdown group — a ranked entity with its daily time series.
 */
export interface PlatformUsageGroup {
	key: string;
	name: string;
	daily: PlatformUsageGroupDaily[];
}

/**
 * Usage breakdown — unified response for org and team scopes.
 * Response to:
 *   GET /usage/orgs/{orgId}/breakdown?dimension=team|user
 *   GET /usage/teams/{teamId}/breakdown?dimension=member
 *   GET /usage/teams/{teamId}/my-usage (same shape, only one entry)
 *
 * Returns Top N rankings + daily time series per ranked entity.
 */
export interface PlatformUsageBreakdownResponse {
	start_date: string;
	end_date: string;
	rankings: PlatformUsageRankingEntry[];
	groups: PlatformUsageGroup[];
}

// ---------------------------------------------------------------------------
// Usage Stability Types (Epic I-2, I-3)
// ---------------------------------------------------------------------------

export interface PlatformStabilitySummary {
	avg_latency: number;
	p90_latency: number;
	p95_latency: number;
	p99_latency: number;
	success_rate: number;
	total_success: number;
	total_error: number;
}

export interface PlatformStabilityDailyEntry {
	date: string;
	avg_latency: number;
	p90: number;
	p95: number;
	p99: number;
	success_count: number;
	error_count: number;
	success_rate: number;
}

export interface PlatformStabilitySeriesEntry {
	key: string;
	avg_latency: number;
	p90: number;
	p95: number;
	p99: number;
	success_count: number;
	error_count: number;
	success_rate: number;
}

export interface PlatformStabilityDailyGroup {
	date: string;
	series: PlatformStabilitySeriesEntry[];
}

export interface PlatformStabilityResponse {
	start_date: string;
	end_date: string;
	summary: PlatformStabilitySummary;
	daily: PlatformStabilityDailyEntry[] | PlatformStabilityDailyGroup[];
}

export interface PlatformAdminStabilityResponse extends PlatformStabilityResponse {
	user_id?: string;
	customer_id?: string;
	team_id?: string;
}

// ---------------------------------------------------------------------------
// Personal Usage Types — /api/platform/usage/me/* endpoints
// ---------------------------------------------------------------------------

/**
 * Personal usage stats — response to GET /api/platform/usage/me/stats.
 * Based on logstore.SearchStats.
 */
export interface PlatformMeStats {
	total_requests: number;
	success_rate: number;
	user_facing_success_rate: number;
	average_latency: number;
	total_tokens: number;
	total_cost: number;
}

/**
 * A single histogram bucket for request / token / cost trend.
 */
export interface PlatformMeHistogramBucket {
	timestamp: string;
	count?: number;
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	cached_read_tokens?: number;
	total_cost?: number;
}

/**
 * Trend data — response to GET /api/platform/usage/me/stats/trend.
 */
export interface PlatformMeHistogram {
	buckets: PlatformMeHistogramBucket[];
	bucket_size_seconds: number;
}


/**
 * A single ranking entry from /me/distribution.
 */
export interface PlatformMeRankingEntry {
	key: string;
	dimension_value: string;
	total_requests: number;
	total_tokens: number;
	total_cost: number;
}

/**
 * Distribution rankings — response to GET /api/platform/usage/me/distribution.
 */
export interface PlatformMeDistribution {
	rankings: PlatformMeRankingEntry[];
}

/**
 * Stability summary for /me/stability (dimension=all).
 */
export interface PlatformMeStabilitySummary {
	avg_latency: number;
	p90_latency: number;
	p95_latency: number;
	p99_latency: number;
	success_rate: number;
	total_success: number;
	total_error: number;
}

/**
 * A latency histogram bucket from /me/stability.
 */
export interface PlatformMeLatencyBucket {
	timestamp: string;
	avg_latency: number;
	p90_latency: number;
	p95_latency: number;
	p99_latency: number;
	success: number;
	total_requests: number;
}

/**
 * Personal stability metrics — response to GET /api/platform/usage/me/stability.
 */
export interface PlatformMeStabilityResponse {
	summary: PlatformMeStabilitySummary;
	buckets: PlatformMeLatencyBucket[];
	bucket_size_seconds: number;
}