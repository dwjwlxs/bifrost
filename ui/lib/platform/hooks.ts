/**
 * useUserRole — convenience hook for role-based UI visibility.
 * Returns boolean flags for each preset role based on the current user.
 */
import { useMemo } from "react";
import { getUser } from "./auth";

export interface UserRoleFlags {
	/** True if user is a system admin */
	isAdmin: boolean;
	/** True if user is an organization owner (customer_owner) */
	isOwner: boolean;
	/** True if user is a team admin (team lead) */
	isTeamAdmin: boolean;
	/** True if user is a team member (read-only) */
	isTeamMember: boolean;
	/** True if user is a regular user (no org role) */
	isUser: boolean;
	/** The raw role string from the user profile */
	role: string;
}

const defaultFlags: UserRoleFlags = {
	isAdmin: false,
	isOwner: false,
	isTeamAdmin: false,
	isTeamMember: false,
	isUser: true,
	role: "user",
};

export function useUserRole(): UserRoleFlags {
	return useMemo(() => {
		const user = getUser();
		if (!user) return defaultFlags;

		const role = user.role ?? "user";
		return {
			isAdmin: role === "admin" || user.is_admin,
			isOwner: role === "customer_owner",
			isTeamAdmin: role === "team_admin",
			isTeamMember: role === "team_member",
			isUser: role === "user",
			role,
		};
	}, []);
}