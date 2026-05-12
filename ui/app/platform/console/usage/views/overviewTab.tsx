/**
 * OverviewTab — Overview of usage: summary cards + 3 trend bar charts.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Zap, DollarSign } from "lucide-react";
import { UsageTrendChart, TrendRow } from "../components/UsageTrendChart";
import type { PlatformMeStats, PlatformMeHistogram } from "@/lib/platform/types";

interface OverviewTabProps {
	stats?: PlatformMeStats;
	trendData?: PlatformMeHistogram;
	startDate: string;
	endDate: string;
	isLoading?: boolean;
}

function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toLocaleString();
}

function formatCost(c: number): string {
	if (c >= 1) return `$${c.toFixed(2)}`;
	return `$${c.toFixed(4)}`;
}

function getPeriodLabel(startDate: string, endDate: string): string {
	const start = new Date(startDate);
	const end = new Date(endDate);
	const diffTime = Math.abs(end.getTime() - start.getTime());
	const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
	return `Last ${diffDays} days`;
}

function buildTrendRows(trendData?: PlatformMeHistogram): TrendRow[] {
	if (!trendData) return [];

	const buckets = trendData.buckets;

	return buckets.map((b, i) => {
		return {
			date: b.timestamp,
			requests: b.count ?? 0,
			tokens: b.total_tokens ?? 0,
			cost: b.total_cost ?? 0,
		};
	});
}

export function OverviewTab({ stats, trendData, startDate, endDate }: OverviewTabProps) {
	if (!stats) {
		return <OverviewTabSkeleton />;
	}

	const periodLabel = getPeriodLabel(startDate, endDate);
	const dailyRows = buildTrendRows(trendData);

	return (
		<div className="space-y-6">
			{/* Summary Cards */}
			<div className="grid grid-cols-3 gap-4">
				<SummaryCard
					label="Total Requests"
					value={formatNumber(stats.total_requests)}
					icon={<Activity className="h-4 w-4" strokeWidth={1.5} />}
					sub={periodLabel}
				/>
				<SummaryCard
					label="Total Cost"
					value={formatCost(stats.total_cost)}
					icon={<DollarSign className="h-4 w-4" strokeWidth={1.5} />}
					sub={periodLabel}
				/>
				<SummaryCard
					label="Total Tokens"
					value={formatNumber(stats.total_tokens)}
					icon={<Zap className="h-4 w-4" strokeWidth={1.5} />}
					sub={periodLabel}
				/>
			</div>

			{/* Trend Charts */}
			<div className="space-y-4">
				<UsageTrendChart
					title="Requests"
					rows={dailyRows}
					dataKey="requests"
					height="200px"
				/>
				<UsageTrendChart
					title="Cost"
					rows={dailyRows}
					dataKey="cost"
					height="200px"
				/>
				<UsageTrendChart
					title="Tokens"
					rows={dailyRows}
					dataKey="tokens"
					height="200px"
				/>
			</div>
		</div>
	);
}

function SummaryCard({
	label,
	value,
	icon,
	sub,
}: {
	label: string;
	value: string | number;
	icon: React.ReactNode;
	sub?: string;
}) {
	return (
		<Card className="flex min-w-0 flex-col gap-1 p-4 shadow-none">
			<div className="flex items-center gap-2">
				<div className="text-muted-foreground">{icon}</div>
				<span className="text-muted-foreground text-sm">{label}</span>
			</div>
			<div className="text-2xl font-semibold tabular-nums">{value}</div>
			{sub && <div className="text-muted-foreground text-xs">{sub}</div>}
		</Card>
	);
}

export function OverviewTabSkeleton() {
	return (
		<div className="space-y-6">
			<div className="grid grid-cols-3 gap-4">
				{[0, 1, 2].map((i) => (
					<Card key={i} className="flex min-w-0 flex-col gap-1 p-4 shadow-none">
						<div className="flex items-center gap-2">
							<Skeleton className="h-4 w-4 rounded" />
							<Skeleton className="h-3 w-16" />
						</div>
						<Skeleton className="h-7 w-24" />
						<Skeleton className="h-3 w-12" />
					</Card>
				))}
			</div>
			<div className="space-y-4">
				{[0, 1, 2].map((i) => (
					<Card key={i} className="p-2 shadow-none">
						<Skeleton className="mb-2 h-4 w-32" />
						<Skeleton className="h-48 w-full" />
					</Card>
				))}
			</div>
		</div>
	);
}