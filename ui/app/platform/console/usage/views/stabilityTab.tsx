/**
 * StabilityTab — stability metrics: latency (avg/p90/p95/p99) and success rate.
 * Shows summary cards + 2 line charts (Latency Trend + Success Rate Trend).
 */
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { ChartCard } from "@/app/workspace/dashboard/components/charts/chartCard";
import type { PlatformMeStabilityResponse, PlatformMeLatencyBucket } from "@/lib/platform/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Timer, AlertCircle, CheckCircle } from "lucide-react";

interface StabilityTabProps {
	data?: PlatformMeStabilityResponse;
	isLoading?: boolean;
	startDate: string;
	endDate: string;
	dimensionSelector?: React.ReactNode;
}

function formatLatency(ms: number): string {
	if (ms === 0) return "0ms";
	if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
	return `${ms.toFixed(0)}ms`;
}

function formatSuccessRate(rate: number): string {
	return `${(rate * 100).toFixed(1)}%`;
}

function getPeriodLabel(startDate: string, endDate: string): string {
	const start = new Date(startDate);
	const end = new Date(endDate);
	const diffTime = Math.abs(end.getTime() - start.getTime());
	const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
	return `Last ${diffDays} days`;
}

const LINE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#1e3a8a"];

function LatencyTrendChart({ buckets, height = "200px" }: { buckets: PlatformMeLatencyBucket[]; height?: string }) {
	// buckets are LatencyHistogramBucket[] with avg_latency, p90, p95, p99
	const data = buckets.map((b) => ({
		date: b.timestamp,
		avg: b.avg_latency,
		p90: b.p90_latency,
		p95: b.p95_latency,
		p99: b.p99_latency,
	}));

	return (
		<ChartCard title="Latency Trend" height={height}>
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
					<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
					<XAxis
						dataKey="date"
						tick={{ fontSize: 11 }}
						tickLine={false}
						axisLine={false}
						interval="preserveStartEnd"
					/>
					<YAxis
						tick={{ fontSize: 11 }}
						tickLine={false}
						axisLine={false}
						tickFormatter={(v) => formatLatency(v)}
					/>
					<Tooltip
						content={({ active, payload, label }) => {
							if (!active || !payload?.length) return null;
							return (
								<div className="bg-background rounded-sm border p-2 shadow-sm">
									<p className="text-xs font-medium mb-1">{label}</p>
									{payload.map((entry) => (
										<p key={entry.name} className="text-xs" style={{ color: entry.color }}>
											{entry.name}: {formatLatency(entry.value as number)}
										</p>
									))}
								</div>
							);
						}}
					/>
					<Legend wrapperStyle={{ fontSize: 11 }} />
					<Line type="monotone" dataKey="avg" name="Avg" stroke={LINE_COLORS[0]} strokeWidth={1.5} dot={false} />
					<Line type="monotone" dataKey="p90" name="P90" stroke={LINE_COLORS[1]} strokeWidth={1} dot={false} />
					<Line type="monotone" dataKey="p95" name="P95" stroke={LINE_COLORS[2]} strokeWidth={1} dot={false} />
					<Line type="monotone" dataKey="p99" name="P99" stroke={LINE_COLORS[3]} strokeWidth={1} dot={false} />
				</LineChart>
			</ResponsiveContainer>
		</ChartCard>
	);
}

function SuccessRateTrendChart({ buckets, height = "200px" }: { buckets: PlatformMeLatencyBucket[]; height?: string }) {
	const data = buckets.map((b) => ({
		date: b.timestamp,
		rate: b.total_requests > 0 ? (b.success / b.total_requests) * 100 : 0,
	}));

	return (
		<ChartCard title="Success Rate Trend" height={height}>
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
					<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
					<XAxis
						dataKey="date"
						tick={{ fontSize: 11 }}
						tickLine={false}
						axisLine={false}
						interval="preserveStartEnd"
					/>
					<YAxis
						domain={[0, 100]}
						tick={{ fontSize: 11 }}
						tickLine={false}
						axisLine={false}
						tickFormatter={(v) => `${v}%`}
					/>
					<Tooltip
						content={({ active, payload, label }) => {
							if (!active || !payload?.length) return null;
							return (
								<div className="bg-background rounded-sm border p-2 shadow-sm">
									<p className="text-xs font-medium mb-1">{label}</p>
									<p className="text-xs" style={{ color: LINE_COLORS[0] }}>
										Success Rate: {(payload[0].value as number).toFixed(1)}%
									</p>
								</div>
							);
						}}
					/>
					<Line type="monotone" dataKey="rate" name="Success Rate" stroke={LINE_COLORS[0]} strokeWidth={1.5} dot={false} />
				</LineChart>
			</ResponsiveContainer>
		</ChartCard>
	);
}

function SummaryCards({ summary, periodLabel }: { summary: PlatformMeStabilityResponse["summary"]; periodLabel: string }) {
	return (
		<div className="grid grid-cols-3 gap-4">
			<Card className="flex min-w-0 flex-col gap-1 p-4 shadow-none">
				<div className="flex items-center gap-2">
					<Timer className="text-muted-foreground h-4 w-4" strokeWidth={1.5} />
					<span className="text-muted-foreground text-sm">Avg Latency</span>
				</div>
				<div className="text-2xl font-semibold tabular-nums">{formatLatency(summary.avg_latency)}</div>
				<div className="text-muted-foreground text-xs">{periodLabel}</div>
			</Card>

			<Card className="flex min-w-0 flex-col gap-1 p-4 shadow-none">
				<div className="flex items-center gap-2">
					<AlertCircle className="text-muted-foreground h-4 w-4" strokeWidth={1.5} />
					<span className="text-muted-foreground text-sm">P95 Latency</span>
				</div>
				<div className="text-2xl font-semibold tabular-nums">{formatLatency(summary.p95_latency)}</div>
				<div className="text-muted-foreground text-xs">{periodLabel}</div>
			</Card>

			<Card className="flex min-w-0 flex-col gap-1 p-4 shadow-none">
				<div className="flex items-center gap-2">
					<CheckCircle className="text-muted-foreground h-4 w-4" strokeWidth={1.5} />
					<span className="text-muted-foreground text-sm">Success Rate</span>
				</div>
				<div className="text-2xl font-semibold tabular-nums">{formatSuccessRate(summary.success_rate)}</div>
				<div className="text-muted-foreground text-xs">{periodLabel}</div>
			</Card>
		</div>
	);
}

export function StabilityTab({ data, isLoading, startDate, endDate, dimensionSelector }: StabilityTabProps) {
	if (isLoading || !data) {
		return <StabilityTabSkeleton />;
	}

	const periodLabel = getPeriodLabel(startDate, endDate);
	const { summary, buckets } = data;

	return (
		<div className="space-y-6">
			{/* Summary Cards */}
			<SummaryCards summary={summary} periodLabel={periodLabel} />

			{/* Charts */}
			<div className="grid grid-cols-2 gap-4">
				{buckets.length > 0 ? (
					<>
						<LatencyTrendChart buckets={buckets} />
						<SuccessRateTrendChart buckets={buckets} />
					</>
				) : (
					<>
						<ChartCard title="Latency Trend" height="200px">
							<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
								No data available
							</div>
						</ChartCard>
						<ChartCard title="Success Rate Trend" height="200px">
							<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
								No data available
							</div>
						</ChartCard>
					</>
				)}
			</div>

			{dimensionSelector && (
				<div className="flex items-center gap-4">
					<span className="text-sm text-muted-foreground">Dimension:</span>
					{dimensionSelector}
				</div>
			)}
		</div>
	);
}

export function StabilityTabSkeleton() {
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
			<div className="grid grid-cols-2 gap-4">
				{[0, 1].map((i) => (
					<Card key={i} className="p-2 shadow-none">
						<Skeleton className="mb-2 h-4 w-32" />
						<Skeleton className="h-48 w-full" />
					</Card>
				))}
			</div>
		</div>
	);
}