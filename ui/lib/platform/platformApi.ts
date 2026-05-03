/**
 * Platform API — aggregated re-export of all endpoint modules.
 *
 * Each domain is defined in its own file under ./endpoints/ and injects
 * endpoints into platformBaseApi via injectEndpoints(). This file simply
 * re-exports every hook so consumers can keep importing from
 * "@/lib/platform/platformApi" as before.
 *
 * Endpoint conventions:
 *   /api/platform/login, /register, /verify           → public (no auth)
 *   /api/platform/profile                             → RequireAuth
 *   /api/platform/virtual-keys                       → RequireAuth (user-scoped)
 *   /api/platform/orgs                               → RequireAuth (user's orgs)
 *   /api/platform/orgs/:orgId/teams                 → RequireOrgAdmin
 *   /api/platform/orgs/:orgId/members               → RequireOrgAdmin
 *   /api/platform/teams                              → RequireAuth (user's teams)
 *   /api/platform/teams/:teamId                     → RequireTeamMember
 *   /api/platform/teams/:teamId/members             → RequireTeamAdmin
 *   /api/platform/admin/orgs                         → RequireAdmin (system-wide)
 *   /api/platform/admin/users                        → RequireAdmin
 *   /api/platform/invitations/:token/accept          → RequireAuth (email must match invite)
 *
 * Type conventions:
 *   API responses follow { code, message, data } wrapper.
 *   transformResponse extracts the inner data.
 */

// ─── Import all endpoint modules (triggers injectEndpoints) ────────
import "./endpoints/auth";
import "./endpoints/profile";
import "./endpoints/virtualKeys";
import "./endpoints/organizations";
import "./endpoints/teams";
import "./endpoints/admin";
import "./endpoints/billing";
import "./endpoints/invitations";
import "./endpoints/providers";

// ─── Re-export types (single source of truth: ./types.ts) ─────────
export type {
	PlatformUserInfo,
	PlatformOrg,
	PlatformOrgMember,
	PlatformTeam,
	PlatformTeamMember,
	PlatformInvitation,
	PlatformVirtualKey,
	PlatformCustomRole,
	PlatformUserRole,
	PlatformPackage,
	PlatformUserPackage,
	PlatformOrder,
	PlatformRecharge,
	PlatformBalance,
	PlatformBalanceHistoryItem,
	PlatformUsageStatRow,
	PlatformUsageStats,
	PlatformTokenUsage,
	PlatformModelPrice,
} from "./types";

// Provider key item type (defined in providers module)
export type { ProviderKeyItem } from "./endpoints/providers";

// ─── Re-export the fully-injected API slice ────────────────────────
export { platformBaseApi as platformApi } from "./platformBaseApi";

// ─── Re-export all hooks by domain ─────────────────────────────────

// Auth
export {
	usePlatformLoginMutation,
	usePlatformRegisterMutation,
	usePlatformVerifyEmailMutation,
	usePlatformResendVerificationMutation,
} from "./endpoints/auth";

// Profile
export {
	usePlatformGetProfileQuery,
	usePlatformUpdateProfileMutation,
	usePlatformChangePasswordMutation,
} from "./endpoints/profile";

// Virtual Keys
export {
	usePlatformListVKsQuery,
	usePlatformCreateVKMutation,
	usePlatformUpdateVKMutation,
	usePlatformDeleteVKMutation,
	usePlatformListTeamVKsQuery,
	usePlatformUpdateTeamVKMutation,
} from "./endpoints/virtualKeys";

// Organizations
export {
	usePlatformListOrgsQuery,
	usePlatformGetOrgQuery,
	usePlatformUpdateOrgMutation,
	usePlatformListOrgMembersQuery,
	usePlatformInviteOrgMemberMutation,
	usePlatformRemoveOrgMemberMutation,
	usePlatformUpdateOrgMemberMutation,
	usePlatformListOrgTeamsQuery,
	usePlatformCreateOrgTeamMutation,
} from "./endpoints/organizations";

// Teams
export {
	usePlatformListTeamsQuery,
	usePlatformGetTeamQuery,
	usePlatformUpdateTeamMutation,
	usePlatformDeleteTeamMutation,
	usePlatformListTeamMembersQuery,
	usePlatformInviteTeamMemberMutation,
	usePlatformRemoveTeamMemberMutation,
	usePlatformUpdateTeamMemberMutation,
} from "./endpoints/teams";

// Admin
export {
	usePlatformAdminListOrgsQuery,
	usePlatformAdminCreateOrgMutation,
	usePlatformAdminUpdateOrgMutation,
	usePlatformAdminDeleteOrgMutation,
	usePlatformListUsersQuery,
	usePlatformSetUserRoleMutation,
	usePlatformSetUserAdminMutation,
	usePlatformSetUserStatusMutation,
	usePlatformListRolesQuery,
	usePlatformCreateRoleMutation,
	usePlatformUpdateRoleMutation,
	usePlatformDeleteRoleMutation,
} from "./endpoints/admin";

// Billing
export {
	usePlatformListPackagesQuery,
	usePlatformGetBalanceQuery,
	usePlatformGetBalanceHistoryQuery,
	usePlatformListUserPackagesQuery,
	usePlatformGetTokenUsageQuery,
	usePlatformGetUsageStatsQuery,
	usePlatformAdminCreatePackageMutation,
	usePlatformAdminUpdatePackageMutation,
	usePlatformAdminDeletePackageMutation,
	usePlatformAdminListModelPricesQuery,
	usePlatformAdminUpsertModelPriceMutation,
	usePlatformAdminDeleteModelPriceMutation,
	usePlatformAdminGetUsageStatsQuery,
} from "./endpoints/billing";

// Providers
export {
	usePlatformAdminListProviderKeysQuery,
	usePlatformAdminCreateProviderKeyMutation,
	usePlatformAdminUpdateProviderKeyMutation,
	usePlatformAdminDeleteProviderKeyMutation,
} from "./endpoints/providers";

// Invitations
export {
	usePlatformGetInvitationQuery,
	usePlatformAcceptInvitationMutation,
} from "./endpoints/invitations";
