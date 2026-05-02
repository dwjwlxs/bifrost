/**
 * Platform shared type definitions.
 *
 * Single source of truth for all platform types — used by auth.ts,
 * endpoint modules, and UI components alike.
 */

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
	budget_id?: string;
	rate_limit_id?: string;
	/** User's role within this org (present in JWT / membership context) */
	role?: "admin" | "member";
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
	role?: "admin" | "member";
	created_at?: string;
	updated_at?: string;
}

// ─── Membership & Invitation ──────────────────────────────────────

/** Organization member (user membership in an org) */
export interface PlatformOrgMember {
	user_id: string;
	email: string;
	username: string;
	role: "admin" | "member";
	joined_at?: string;
}

/** Team member */
export interface PlatformTeamMember {
	user_id: string;
	email: string;
	username: string;
	role: "admin" | "member";
	joined_at?: string;
}

/** Invitation record */
export interface PlatformInvitation {
	id: string;
	org_id?: string;
	team_id?: string;
	email: string;
	role: string;
	accepted: boolean;
	expires_at: string;
	created_at?: string;
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
