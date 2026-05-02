/**
 * Platform Console Navigation Configuration
 * Used by the console sidebar to render nav items based on user role.
 */

import {
	LayoutDashboard,
	KeyRound,
	Building2,
	ShieldCheck,
	Wallet,
	Activity,
	Package,
	Server,
	Users,
	DollarSign,
	UsersRound,
} from "lucide-react";

export interface NavItem {
	label: string;
	to: string;
	icon: typeof LayoutDashboard;
	/** If true, only visible when user.is_admin === true */
	requireAdmin?: boolean;
	/** If true, visible when user is org_admin or team_admin */
	requireOrgOrTeamAdmin?: boolean;
}

export const consoleNavItems: NavItem[] = [
	{ label: "Dashboard", to: "/platform/console/dashboard", icon: LayoutDashboard },
	{ label: "Virtual Keys", to: "/platform/console/virtual-keys", icon: KeyRound },
	{ label: "Organizations", to: "/platform/console/organizations", icon: Building2 },
	{ label: "Usage", to: "/platform/console/usage", icon: Activity },
	{ label: "RBAC", to: "/platform/console/rbac", icon: ShieldCheck, requireOrgOrTeamAdmin: true },
];

export const adminNavItems: NavItem[] = [
	{ label: "Packages", to: "/platform/console/admin/packages", icon: Package, requireAdmin: true },
	{ label: "Providers", to: "/platform/console/admin/providers", icon: Server, requireAdmin: true },
	{ label: "Users & Orgs", to: "/platform/console/admin/users", icon: Users, requireAdmin: true },
	{ label: "Model Prices", to: "/platform/console/admin/model-prices", icon: DollarSign, requireAdmin: true },
];

/**
 * Returns all visible nav items for a given user role flags.
 */
export function getVisibleNavItems(opts: { isAdmin: boolean; isOwner: boolean; isTeamAdmin: boolean }): NavItem[] {
	const isPrivileged = opts.isAdmin || opts.isOwner || opts.isTeamAdmin;
	return [...consoleNavItems, ...adminNavItems].filter((item) => {
		if (item.requireAdmin) return opts.isAdmin;
		if (item.requireOrgOrTeamAdmin) return isPrivileged;
		return true;
	});
}