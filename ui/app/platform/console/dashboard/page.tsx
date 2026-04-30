import { Link } from "@tanstack/react-router";
import { usePlatformGetProfileQuery, usePlatformListVKsQuery, usePlatformListCustomersQuery } from "@/lib/platform/platformApi";
import { getUser } from "@/lib/platform/auth";
import { useUserRole } from "@/lib/platform/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound, Building2, Wallet, Activity, ArrowRight, Package, Server, Users, DollarSign } from "lucide-react";

export default function DashboardPage() {
	const { data: profile, isLoading: profileLoading } = usePlatformGetProfileQuery();
	const { data: vks, isLoading: vksLoading } = usePlatformListVKsQuery();
	const { data: customers, isLoading: customersLoading } = usePlatformListCustomersQuery();
	const user = profile ?? getUser();
	const { isAdmin } = useUserRole();

	if (profileLoading && !user) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
			</div>
		);
	}

	return (
		<div className="space-y-8">
			{/* Welcome Header */}
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Welcome back, {user?.nickname || user?.username}</h1>
				<p className="text-muted-foreground">Here&apos;s an overview of your platform account.</p>
			</div>

			{/* Stats Grid */}
			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Balance</CardTitle>
						<Wallet className="text-muted-foreground h-4 w-4" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">${(user?.balance ?? 0).toFixed(2)}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Virtual Keys</CardTitle>
						<KeyRound className="text-muted-foreground h-4 w-4" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{vksLoading ? "..." : (vks?.length ?? 0)}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Organizations</CardTitle>
						<Building2 className="text-muted-foreground h-4 w-4" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{customersLoading ? "..." : (customers?.length ?? 0)}</div>
					</CardContent>
				</Card>
			</div>

			{/* Profile & Quick Actions */}
			<div className={`grid gap-4 ${isAdmin ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
				{/* Profile Card */}
				<Card>
					<CardHeader>
						<CardTitle>Profile</CardTitle>
						<CardDescription>Your account details</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground text-sm">Username</span>
							<span className="text-sm font-medium">{user?.username ?? "—"}</span>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground text-sm">Email</span>
							<span className="text-sm font-medium">{user?.email ?? "—"}</span>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground text-sm">Role</span>
							<Badge variant={user?.is_admin ? "default" : "secondary"}>{user?.role ?? "user"}</Badge>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground text-sm">Status</span>
							<Badge variant={user?.status === "active" ? "default" : "destructive"}>{user?.status ?? "unknown"}</Badge>
						</div>
					</CardContent>
				</Card>

				{/* Quick Actions Card */}
				<Card>
					<CardHeader>
						<CardTitle>Quick Actions</CardTitle>
						<CardDescription>Navigate to common sections</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						<Button variant="outline" className="w-full justify-between" asChild data-testid="dashboard-quick-virtual-keys">
							<Link to="/platform/console/virtual-keys">
								<span className="flex items-center gap-2">
									<KeyRound className="h-4 w-4" />
									Virtual Keys
								</span>
								<ArrowRight className="h-4 w-4" />
							</Link>
						</Button>
						<Button variant="outline" className="w-full justify-between" asChild data-testid="dashboard-quick-organizations">
							<Link to="/platform/console/organizations">
								<span className="flex items-center gap-2">
									<Building2 className="h-4 w-4" />
									Organizations
								</span>
								<ArrowRight className="h-4 w-4" />
							</Link>
						</Button>
						<Button variant="outline" className="w-full justify-between" asChild data-testid="dashboard-quick-usage">
							<Link to="/platform/console/usage">
								<span className="flex items-center gap-2">
									<Activity className="h-4 w-4" />
									Usage Analytics
								</span>
								<ArrowRight className="h-4 w-4" />
							</Link>
						</Button>
					</CardContent>
				</Card>

				{/* Admin Quick Actions Card */}
				{isAdmin && (
					<Card>
						<CardHeader>
							<CardTitle>Admin Actions</CardTitle>
							<CardDescription>Platform administration</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							<Button variant="outline" className="w-full justify-between" asChild data-testid="dashboard-admin-packages">
								<Link to="/platform/console/admin/packages">
									<span className="flex items-center gap-2">
										<Package className="h-4 w-4" />
										Packages
									</span>
									<ArrowRight className="h-4 w-4" />
								</Link>
							</Button>
							<Button variant="outline" className="w-full justify-between" asChild data-testid="dashboard-admin-providers">
								<Link to="/platform/console/admin/providers">
									<span className="flex items-center gap-2">
										<Server className="h-4 w-4" />
										Providers
									</span>
									<ArrowRight className="h-4 w-4" />
								</Link>
							</Button>
							<Button variant="outline" className="w-full justify-between" asChild data-testid="dashboard-admin-users">
								<Link to="/platform/console/admin/users">
									<span className="flex items-center gap-2">
										<Users className="h-4 w-4" />
										Users & Orgs
									</span>
									<ArrowRight className="h-4 w-4" />
								</Link>
							</Button>
							<Button variant="outline" className="w-full justify-between" asChild data-testid="dashboard-admin-model-prices">
								<Link to="/platform/console/admin/model-prices">
									<span className="flex items-center gap-2">
										<DollarSign className="h-4 w-4" />
										Model Prices
									</span>
									<ArrowRight className="h-4 w-4" />
								</Link>
							</Button>
						</CardContent>
					</Card>
				)}
			</div>

			{/* Recent Activity Placeholder */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Activity className="h-5 w-5" />
						Recent Activity
					</CardTitle>
					<CardDescription>Your latest actions on the platform</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex flex-col items-center justify-center py-8 text-center">
						<Activity className="text-muted-foreground/50 mb-3 h-8 w-8" />
						<p className="text-muted-foreground text-sm">No recent activity to display.</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}