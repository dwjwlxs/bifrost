/**
 * BalanceOverview — a compact billing summary component.
 * Displays wallet balance, package credits, and total credits.
 * Suitable for embedding in sidebars, dashboards, or nav bars.
 *
 * Usage:
 *   import { BalanceOverview } from "@/components/billing";
 *   <BalanceOverview />
 */
import { usePlatformGetBalanceQuery, usePlatformListEntityPackagesQuery } from "@/lib/platform/platformApi";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Wallet, Package, Zap, AlertCircle } from "lucide-react";

interface BalanceOverviewProps {
	/** Compact mode — hides labels and reduces padding for sidebar use */
	compact?: boolean;
	/** Show active package count and quota usage bar */
	showPackageDetails?: boolean;
}

export function BalanceOverview({ compact = false, showPackageDetails = false }: BalanceOverviewProps) {
	const { data: balance, isLoading: balanceLoading } = usePlatformGetBalanceQuery();
	const { data: epsData } = usePlatformListEntityPackagesQuery({
		status: "active",
		limit: 100,
	});

	const activeEps = epsData?.items?.filter((ep) => ep.status === "active") ?? [];
	const totalPackageQuota = activeEps.reduce((sum, ep) => sum + (ep.package?.quota ?? 0), 0);
	const remainingPackageCredits = balance?.package_credits ?? 0;
	const usedPackageCredits = totalPackageQuota > 0 ? totalPackageQuota - remainingPackageCredits : 0;
	const packageUsagePct = totalPackageQuota > 0 ? Math.min(100, (usedPackageCredits / totalPackageQuota) * 100) : 0;

	if (balanceLoading) {
		if (compact) {
			return (
				<div className="flex items-center gap-2 px-3 py-2">
					<Skeleton className="h-4 w-4 rounded-full" />
					<Skeleton className="h-4 w-16" />
				</div>
			);
		}
		return (
			<Card>
				<CardContent className="space-y-3 pt-6">
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-4 w-2/3" />
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-4 w-1/2" />
				</CardContent>
			</Card>
		);
	}

	const walletBalance = balance?.balance_credits ?? 0;
	const totalCredits = balance?.total_credits ?? 0;

	if (compact) {
		// Inline compact layout — fits in a sidebar nav item or top bar
		return (
			<div className="flex items-center justify-between px-3 py-2">
				<div className="flex items-center gap-2">
					<Wallet className="text-muted-foreground h-3.5 w-3.5" />
					<span className="text-muted-foreground text-xs">Balance</span>
				</div>
				<span className="font-mono text-sm font-medium">${walletBalance.toFixed(2)}</span>
			</div>
		);
	}

	return (
		<Card>
			<CardContent className={showPackageDetails ? "space-y-4 pt-6" : "space-y-3 pt-6"}>
				{/* Credits summary */}
				<div className="space-y-1">
					<p className="text-muted-foreground text-xs">Total Credits</p>
					<p className="text-3xl font-bold tabular-nums">${totalCredits.toFixed(2)}</p>
				</div>

				{/* Balance breakdown */}
				<div className="grid grid-cols-2 gap-3">
					<div className="flex items-center gap-2">
						<Wallet className="text-muted-foreground h-3.5 w-3.5" />
						<div>
							<p className="text-muted-foreground text-[10px]">Wallet</p>
							<p className="font-mono text-sm font-medium">${walletBalance.toFixed(2)}</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Package className="text-muted-foreground h-3.5 w-3.5" />
						<div>
							<p className="text-muted-foreground text-[10px]">Packages</p>
							<p className="font-mono text-sm font-medium">${remainingPackageCredits.toFixed(2)}</p>
						</div>
					</div>
				</div>

				{/* Package details — only when requested */}
				{showPackageDetails && (
					<div className="border-muted space-y-2 rounded-md border p-3">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-1.5">
								<Zap className="text-primary h-3.5 w-3.5" />
								<span className="text-xs font-medium">
									{activeEps.length} Active {activeEps.length === 1 ? "Package" : "Packages"}
								</span>
							</div>
							<span className="text-muted-foreground text-xs">
								{totalPackageQuota >= 1000 ? `${(totalPackageQuota / 1000).toFixed(0)}K` : totalPackageQuota.toLocaleString()} quota
							</span>
						</div>

						{totalPackageQuota > 0 ? (
							<>
								<Progress value={100 - packageUsagePct} className="h-1.5" />
								<div className="flex justify-between">
									<span className="text-muted-foreground text-[10px]">{packageUsagePct.toFixed(0)}% used</span>
									<span className="text-muted-foreground text-[10px]">
										{remainingPackageCredits >= 1000
											? `${(remainingPackageCredits / 1000).toFixed(1)}K`
											: remainingPackageCredits.toLocaleString()}{" "}
										left
									</span>
								</div>
							</>
						) : (
							<div className="text-muted-foreground flex items-center gap-1.5 text-xs">
								<AlertCircle className="h-3 w-3" />
								No active packages
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}