/**
 * SummaryCards — displays usage summary metrics in a card grid.
 * Used by both OverviewTab and BreakdownTab.
 */
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PlatformUsageSummary } from "@/lib/platform/types";
import { PhoneCall, Zap, DollarSign } from "lucide-react";

const DATE_PRESETS = [
	{ label: "7d", value: "7" },
	{ label: "30d", value: "30" },
	{ label: "90d", value: "90" },
] as const;

interface SummaryCardProps {
	label: string;
	value: string | number;
	icon: React.ReactNode;
	sub?: string;
	className?: string;
}

function SummaryCard({ label, value, icon, sub, className }: SummaryCardProps) {
	return (
		<Card className={cn("flex min-w-0 flex-col gap-1 p-4 shadow-none", className)}>
			<div className="flex items-center gap-2">
				<div className="text-content-disabled">{icon}</div>
				<span className="text-content-disabled text-sm">{label}</span>
			</div>
			<div className="text-2xl font-semibold tabular-nums">{value}</div>
			{sub && <div className="text-content-disabled text-xs">{sub}</div>}
		</Card>
	);
}

export function SummaryCardsSkeleton() {
	return (
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
	);
}

interface SummaryCardsProps {
	summary: PlatformUsageSummary;
	periodLabel?: string; // e.g. "Last 30 days"
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

export function SummaryCards({ summary, periodLabel, isLoading }: SummaryCardsProps) {
	if (isLoading) return <SummaryCardsSkeleton />;

	const { requests, tokens, cost } = summary;

	return (
		<div className="grid grid-cols-3 gap-4">
			<SummaryCard
				label="Requests"
				value={formatNumber(requests)}
				icon={<PhoneCall className="h-4 w-4" strokeWidth={1.5} />}
				sub={periodLabel}
			/>
			<SummaryCard label="Tokens" value={formatNumber(tokens)} icon={<Zap className="h-4 w-4" strokeWidth={1.5} />} sub={periodLabel} />
			<SummaryCard label="Cost" value={formatCost(cost)} icon={<DollarSign className="h-4 w-4" strokeWidth={1.5} />} sub={periodLabel} />
		</div>
	);
}

export { DATE_PRESETS };