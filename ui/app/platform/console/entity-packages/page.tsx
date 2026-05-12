import { useState } from "react";
import { usePlatformListEntityPackagesQuery, usePlatformGetBalanceQuery } from "@/lib/platform/platformApi";
import type { PlatformEntityPackage } from "@/lib/platform/platformApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { format, differenceInDays } from "date-fns";
import { Package, Clock, Zap, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";

const STATUS_TAB_MAP: Record<string, string | undefined> = {
	all: undefined,
	active: "active",
	expired: "expired",
	cancelled: "cancelled",
};

function parseJSONField<T>(raw: string | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

interface PackageFeatures {
	allowed_models?: string[];
	rate_limit?: { requests_per_minute?: number; requests_per_day?: number };
	off_peak_discount?: number;
	[key: string]: unknown;
}

function ExpiryBadge({ expiresAt, status }: { expiresAt: string; status: string }) {
	if (status !== "active") {
		return <Badge variant="secondary">Expired</Badge>;
	}

	const expiryDate = new Date(expiresAt);
	const daysLeft = differenceInDays(expiryDate, new Date());

	if (daysLeft < 0) {
		return <Badge variant="destructive">Expired</Badge>;
	}
	if (daysLeft === 0) {
		return (
			<Badge variant="destructive" className="gap-1">
				<Clock className="h-3 w-3" />
				Expires today
			</Badge>
		);
	}
	if (daysLeft <= 7) {
		return (
			<Badge variant="outline" className="gap-1 border-yellow-400 text-yellow-700 dark:text-yellow-400">
				<Clock className="h-3 w-3" />
				{daysLeft}d left
			</Badge>
		);
	}
	return (
		<Badge variant="outline" className="gap-1">
			<CheckCircle2 className="h-3 w-3 text-green-500" />
			Expires {format(expiryDate, "MMM d, yyyy")}
		</Badge>
	);
}

function EntityPackageCard({ ep }: { ep: PlatformEntityPackage }) {
	const pkg = ep.package;
	if (!pkg) return null;

	const features = parseJSONField<PackageFeatures>(pkg.rate_limit_config, {});
	const offPeakDiscount = features.off_peak_discount;
	const allowedModels = features.allowed_models;
	const rpm = features.rate_limit?.requests_per_minute;
	const rpd = features.rate_limit?.requests_per_day;

	const isActive = ep.status === "active";
	const hasExpiry = ep.expires_at && ep.expires_at !== "0001-01-01T00:00:00Z";

	return (
		<Card className="flex flex-col">
			<CardHeader className="pb-3">
				<div className="flex items-start justify-between gap-2">
					<div className="min-w-0 flex-1">
						<CardTitle className="truncate text-base">{pkg.name}</CardTitle>
						<CardDescription className="mt-0.5 line-clamp-2 text-xs">{pkg.description}</CardDescription>
					</div>
					<div className="shrink-0">
						<ExpiryBadge expiresAt={ep.expires_at} status={ep.status} />
					</div>
				</div>
			</CardHeader>

			<CardContent className="flex-1 space-y-3 pb-4">
				{/* Quota */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-1.5 text-sm">
						<Package className="text-muted-foreground h-4 w-4" />
						<span className="text-muted-foreground">Quota</span>
					</div>
					<span className="font-medium">
						{pkg.quota >= 1000 ? `${(pkg.quota / 1000).toFixed(0)}K` : pkg.quota.toLocaleString()} credits
					</span>
				</div>

				{/* Started / Expires */}
				{hasExpiry && (
					<div className="text-muted-foreground flex items-center justify-between text-xs">
						<span>Started</span>
						<span>{format(new Date(ep.started_at), "MMM d, yyyy")}</span>
					</div>
				)}

				{/* Auto-renew */}
				{ep.auto_renew && (
					<div className="border-primary/20 bg-primary/5 flex items-center gap-1.5 rounded-md border px-3 py-1.5">
						<Zap className="text-primary h-3 w-3" />
						<span className="text-primary text-xs font-medium">Auto-renew enabled</span>
					</div>
				)}

				{/* Off-peak discount */}
				{offPeakDiscount && offPeakDiscount > 0 && (
					<div className="flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-3 py-1.5 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
						<Zap className="h-3 w-3 shrink-0" />
						<span className="text-xs">{offPeakDiscount * 100}% off during off-peak hours</span>
					</div>
				)}

				{/* Rate limits */}
				{(rpm || rpd) && (
					<div className="space-y-1">
						<p className="text-muted-foreground text-xs font-medium">Rate Limits</p>
						<div className="flex flex-wrap gap-1.5">
							{rpm && (
								<Badge variant="secondary" className="text-xs">
									{rpm} req/min
								</Badge>
							)}
							{rpd && (
								<Badge variant="secondary" className="text-xs">
									{rpd} req/day
								</Badge>
							)}
						</div>
					</div>
				)}

				{/* Allowed models */}
				{allowedModels && allowedModels.length > 0 && (
					<div className="space-y-1">
						<p className="text-muted-foreground text-xs font-medium">Allowed Models</p>
						<div className="flex flex-wrap gap-1">
							{allowedModels.slice(0, 4).map((model) => (
								<Badge key={model} variant="outline" className="text-xs">
									{model}
								</Badge>
							))}
							{allowedModels.length > 4 && (
								<Badge variant="outline" className="text-xs">
									+{allowedModels.length - 4} more
								</Badge>
							)}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export default function EntityPackagesPage() {
	const [tab, setTab] = useState<string>("active");

	const statusParam = STATUS_TAB_MAP[tab];
	const {
		data: epsData,
		isLoading: epsLoading,
		refetch,
	} = usePlatformListEntityPackagesQuery({
		status: statusParam,
		limit: 100,
	});
	const { data: balance } = usePlatformGetBalanceQuery();

	const entityPackages = epsData?.items ?? [];
	const totalPackageCredits = balance?.package_credits ?? 0;

	const activeEps = entityPackages.filter((ep) => ep.status === "active");
	const totalQuota = activeEps.reduce((sum, ep) => sum + (ep.package?.quota ?? 0), 0);

	const overallUsagePct = totalQuota > 0 ? Math.min(100, ((totalQuota - totalPackageCredits) / totalQuota) * 100) : 0;

	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h1 className="text-2xl font-bold tracking-tight">My Packages</h1>
				<p className="text-muted-foreground text-sm">View your purchased subscription packages and their status.</p>
			</div>

			{/* Summary Card */}
			{totalPackageCredits > 0 && (
				<Card>
					<CardContent className="pt-6">
						<div className="space-y-3">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-sm font-medium">Package Credits Remaining</p>
									<p className="text-muted-foreground text-xs">
										Across {activeEps.length} active {activeEps.length === 1 ? "package" : "packages"}
									</p>
								</div>
								<div className="text-right">
									<p className="text-2xl font-bold">
										{totalPackageCredits >= 1000 ? `${(totalPackageCredits / 1000).toFixed(1)}K` : totalPackageCredits.toLocaleString()}
									</p>
									<p className="text-muted-foreground text-xs">of {(totalQuota / 1000).toFixed(0)}K credits total</p>
								</div>
							</div>
							<Progress value={100 - overallUsagePct} className="h-2" />
							<p className="text-muted-foreground text-right text-xs">
								{overallUsagePct > 0 ? `${overallUsagePct.toFixed(1)}% of quota used` : "No usage yet"}
							</p>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Tabs */}
			<Tabs value={tab} onValueChange={setTab}>
				<TabsList>
					<TabsTrigger value="all">All</TabsTrigger>
					<TabsTrigger value="active">Active</TabsTrigger>
					<TabsTrigger value="expired">Expired</TabsTrigger>
					<TabsTrigger value="cancelled">Cancelled</TabsTrigger>
				</TabsList>

				{(["all", "active", "expired", "cancelled"] as const).map((tabValue) => (
					<TabsContent key={tabValue} value={tabValue} className="mt-4">
						{epsLoading ? (
							<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
								{Array.from({ length: 3 }).map((_, i) => (
									<Card key={i}>
										<CardHeader>
											<Skeleton className="h-5 w-3/4" />
											<Skeleton className="mt-2 h-4 w-full" />
										</CardHeader>
										<CardContent className="space-y-2">
											<Skeleton className="h-4 w-full" />
											<Skeleton className="h-4 w-2/3" />
										</CardContent>
									</Card>
								))}
							</div>
						) : entityPackages.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-20 text-center">
								<Package className="text-muted-foreground/30 mb-3 h-8 w-8" />
								<p className="text-muted-foreground font-medium">No packages</p>
								<p className="text-muted-foreground/70 mt-1 text-sm">
									{tabValue === "active" ? "You don't have any active packages." : `No ${tabValue} packages found.`}
								</p>
								<Button variant="outline" className="mt-4" asChild>
									<Link to="/platform/console/packages">Browse Packages</Link>
								</Button>
							</div>
						) : (
							<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
								{entityPackages.map((ep) => (
									<EntityPackageCard key={ep.id} ep={ep} />
								))}
							</div>
						)}
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}