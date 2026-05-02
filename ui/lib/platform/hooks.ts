/**
 * Platform role hooks — convenience utilities for role-based UI visibility.
 * All hooks read from the stored PlatformUserInfo (set on login).
 */
import { useMemo } from "react";
import { getUser, type PlatformOrg, type PlatformTeam } from "./auth";

export interface UserRoleFlags {
	/** True if user is a system admin */
	isAdmin: boolean;
	/** True if user is an organization admin (customer_owner) */
	isOwner: boolean;
	/** True if user is a team admin */
	isTeamAdmin: boolean;
	/** True if user is a team member (read-only) */
	isTeamMember: boolean;
	/** True if user has no org/team membership */
	isUser: boolean;
	/** The derived display role string */
	role: string;
	/** Whether the user has any org membership */
	hasOrg: boolean;
	/** Whether the user has any team membership */
	hasTeam: boolean;
}

const defaultFlags: UserRoleFlags = {
	isAdmin: false,
	isOwner: false,
	isTeamAdmin: false,
	isTeamMember: false,
	isUser: true,
	role: "user",
	hasOrg: false,
	hasTeam: false,
};

/**
 * Primary role flags hook — mirrors the old behavior but with updated role logic.
 */
export function useUserRole(): UserRoleFlags {
	return useMemo(() => {
		const user = getUser();
		if (!user) return defaultFlags;

		const role = user.role ?? "user";
		return {
			isAdmin: user.is_admin === true,
			isOwner: role === "customer_owner",
			isTeamAdmin: role === "team_admin",
			isTeamMember: role === "team_member",
			isUser: role === "user",
			role,
			hasOrg: (user.orgs?.length ?? 0) > 0,
			hasTeam: (user.teams?.length ?? 0) > 0,
		};
	}, []);
}

/**
 * Check if user is org_admin (customer_owner) for a specific org.
 */
export function useIsOrgAdmin(orgId: string | undefined): boolean {
	return useMemo(() => {
		if (!orgId) return false;
		const user = getUser();
		if (!user) return false;
		if (user.is_admin) return true;
		return user.orgs?.some((o) => o.id === orgId && o.role === "admin") ?? false;
	}, [orgId]);
}

/**
 * Check if user is team_admin (or org_admin of the parent org) for a specific team.
 */
export function useIsTeamAdmin(teamId: string | undefined): boolean {
	return useMemo(() => {
		if (!teamId) return false;
		const user = getUser();
		if (!user) return false;
		if (user.is_admin) return true;
		// Direct team admin
		if (user.teams?.some((t) => t.id === teamId && t.role === "admin")) return true;
		return false;
	}, [teamId]);
}

/**
 * Check if user is a member of a specific org (any role).
 */
export function useIsOrgMember(orgId: string | undefined): boolean {
	return useMemo(() => {
		if (!orgId) return false;
		const user = getUser();
		if (!user) return false;
		return user.orgs?.some((o) => o.id === orgId) ?? false;
	}, [orgId]);
}

/**
 * Check if user is a member of a specific team (any role).
 */
export function useIsTeamMember(teamId: string | undefined): boolean {
	return useMemo(() => {
		if (!teamId) return false;
		const user = getUser();
		if (!user) return false;
		if (user.is_admin) return true; // admin can see all teams
		return user.teams?.some((t) => t.id === teamId) ?? false;
	}, [teamId]);
}

/**
 * Get all orgs the user belongs to.
 */
export function useUserOrgs(): PlatformOrg[] {
	return useMemo(() => {
		const user = getUser();
		return user?.orgs ?? [];
	}, []);
}

/**
 * Get all teams the user belongs to.
 */
export function useUserTeams(): PlatformTeam[] {
	return useMemo(() => {
		const user = getUser();
		return user?.teams ?? [];
	}, []);
}
