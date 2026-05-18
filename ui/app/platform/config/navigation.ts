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
	CreditCard,
	Activity,
	Package,
	Server,
	Users,
	DollarSign,
	UsersRound,
	ShoppingCart,
	Receipt,
	Boxes,
} from "lucide-react";

export interface NavItem {
	label: string;
	to: string;
	icon: typeof LayoutDashboard;
	/** If true, only visible when user.is_admin === true */
	requireAdmin?: boolean;
	/** If true, visible when user is org_admin or team_admin */
	requireOrgOrTeamAdmin?: boolean;
	/** If true, renders as a visual separator instead of a link */
	separator?: boolean;
}

export const consoleNavItems: NavItem[] = [
	{ label: "Dashboard", to: "/platform/console/dashboard", icon: LayoutDashboard },
	{ label: "Virtual Keys", to: "/platform/console/virtual-keys", icon: KeyRound },
	// { label: "Organizations", to: "/platform/console/organizations", icon: Building2 },
	{ label: "Usage", to: "/platform/console/usage", icon: Activity },
	// { label: "Org Usage", to: "/platform/console/organization/usage", icon: LayoutDashboard, requireOrgOrTeamAdmin: true },
	// { label: "RBAC", to: "/platform/console/rbac", icon: ShieldCheck, requireOrgOrTeamAdmin: true },
	{ label: "Billing", to: "/platform/console/billing", icon: CreditCard },
	// { label: "Wallet", to: "/platform/console/wallet", icon: Wallet },
	{ label: "Package Marketplace", to: "/platform/console/packages", icon: ShoppingCart },
	// { label: "My Packages", to: "/platform/console/entity-packages", icon: Boxes },
];

export const adminNavItems: NavItem[] = [
	{ label: "Providers", to: "/platform/console/admin/providers", icon: Server, requireAdmin: true },
	{ label: "Packages", to: "/platform/console/admin/packages", icon: Package, requireAdmin: true },
	{ label: "Orders", to: "/platform/console/admin/orders", icon: Receipt, requireAdmin: true },
	{ label: "Users & Orgs", to: "/platform/console/admin/users", icon: Users, requireAdmin: true },
	{ label: "Price Override", to: "/platform/console/admin/model-prices", icon: DollarSign, requireAdmin: true },
];

const adminSeparator: NavItem = { label: "", to: "", icon: Building2, separator: true };

/**
 * Returns all visible nav items for a given user role flags.
 */
export function getVisibleNavItems(opts: { isAdmin: boolean; isOwner: boolean; isTeamAdmin: boolean }): NavItem[] {
	const isPrivileged = opts.isAdmin || opts.isOwner || opts.isTeamAdmin;
	const visibleConsole = consoleNavItems.filter((item) => {
		if (item.requireAdmin) return false;
		if (item.requireOrgOrTeamAdmin) return isPrivileged;
		return true;
	});
	const visibleAdmin = adminNavItems.filter((item) => item.requireAdmin && opts.isAdmin);
	if (visibleConsole.length === 0 || visibleAdmin.length === 0) {
		return [...visibleConsole, ...visibleAdmin];
	}
	return [...visibleConsole, adminSeparator, ...visibleAdmin];
}