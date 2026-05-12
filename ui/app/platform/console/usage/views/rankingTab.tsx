/**
 * RankingTab — 3x3 horizontal bar chart matrix.
 * Rows = dimensions (Provider / Model / Virtual Key), Columns = metrics (Requests / Cost / Tokens).
 * Each column is sorted independently by that metric in descending order.
 */
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/app/workspace/dashboard/components/charts/chartCard";
import type { PlatformMeDistribution, PlatformMeRankingEntry } from "@/lib/platform/types";

interface RankingTabProps {
	distProvider?: PlatformMeDistribution;
	distModel?: PlatformMeDistribution;
	distVk?: PlatformMeDistribution;
	isLoading?: boolean;
}

const COLOR_MAP = [
	"#3b82f6", "#374151", "#6b7280", "#9ca3af",
	"#60a5fa", "#93c5fd", "#2563eb", "#1d4ed8",
	"#1e40af", "#1e3a8a",
];

function formatValue(value: number, metric: MetricKey): string {
	if (metric === "total_cost") return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
	if (metric === "total_tokens") return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString();
	return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString();
}

function formatAxisValue(value: number, metric: MetricKey): string {
	if (metric === "total_cost") return value >= 1 ? `$${value}` : `$${value.toFixed(2)}`;
	if (metric === "total_tokens") return value >= 1000 ? `${(value / 1000).toFixed(0)}K` : String(value);
	return value >= 1000 ? `${(value / 1000).toFixed(0)}K` : String(value);
}

type MetricKey = "total_requests" | "total_cost" | "total_tokens";

interface ChartEntry {
	name: string;
	value: number;
	color: string;
}

interface HorizontalBarChartProps {
	title: string;
	data: ChartEntry[];
	metric: MetricKey;
	height?: string;
}

function HorizontalBarChart({ title, data, metric, height = "220px" }: HorizontalBarChartProps) {
	return (
		<ChartCard title={title} height={height}>
			<ResponsiveContainer width="100%" height="100%">
				<BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
					<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
					<XAxis
						type="number"
						tick={{ fontSize: 10 }}
						tickLine={false}
						axisLine={false}
						tickFormatter={(v) => formatAxisValue(v, metric)}
					/>
					<YAxis
						type="category"
						dataKey="name"
						tick={{ fontSize: 10 }}
						tickLine={false}
						axisLine={false}
						width={70}
					/>
					<Tooltip
						content={({ active, payload, label }) => {
							if (!active || !payload?.length) return null;
							return (
								<div className="bg-background rounded-sm border p-2 shadow-sm">
									<p className="text-xs font-medium">{label}</p>
									<p className="text-xs">{formatValue(payload[0].value, metric)}</p>
								</div>
							);
						}}
						cursor={{ fill: "var(--muted)" }}
					/>
					<Bar dataKey="value" radius={[0, 2, 2, 0]}>
						{data.map((entry, index) => (
							<Cell key={`cell-${index}`} fill={entry.color} />
						))}
					</Bar>
				</BarChart>
			</ResponsiveContainer>
		</ChartCard>
	);
}

function buildChartData(
	rankings: PlatformMeRankingEntry[] | undefined,
	metric: MetricKey,
): ChartEntry[] {
	if (!rankings || rankings.length === 0) return [];

	const sorted = [...rankings]
		.sort((a, b) => (b[metric] as number) - (a[metric] as number))
		.slice(0, 10);

	return sorted.map((row, i) => ({
		name: row.dimension_value
			? row.dimension_value.length > 12
				? `${row.dimension_value.slice(0, 12)}…`
				: row.dimension_value
			: row.key.length > 12
				? `${row.key.slice(0, 12)}…`
				: row.key,
		value: row[metric] as number,
		color: COLOR_MAP[i % COLOR_MAP.length],
	}));
}

const METRICS: { key: MetricKey; label: string }[] = [
	{ key: "total_requests", label: "Requests" },
	{ key: "total_tokens", label: "Tokens" },
	{ key: "total_cost", label: "Cost" },
];

const DIMENSIONS: { key: "distProvider" | "distModel" | "distVk"; label: string }[] = [
	{ key: "distProvider", label: "By Provider" },
	{ key: "distModel", label: "By Model" },
	{ key: "distVk", label: "By Virtual Key" },
];

export function RankingTab({ distProvider, distModel, distVk, isLoading }: RankingTabProps) {
	if (isLoading) {
		return <RankingTabSkeleton />;
	}

	const distMap = { distProvider, distModel, distVk } as const;

	return (
		<div className="space-y-6">
			{DIMENSIONS.map((dim) => (
				<div key={dim.key} className="space-y-2">
					<h3 className="text-sm font-medium text-muted-foreground pl-2">{dim.label}</h3>
					<div className="grid grid-cols-3 gap-4">
						{METRICS.map((m) => (
							<HorizontalBarChart
								key={m.key}
								title={m.label}
								data={buildChartData(distMap[dim.key]?.rankings, m.key)}
								metric={m.key}
							/>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

export function RankingTabSkeleton() {
	return (
		<div className="space-y-6">
			{[0, 1, 2].map((row) => (
				<div key={row} className="space-y-2">
					<div className="rounded-sm border h-4 w-20 ml-2" />
					<div className="grid grid-cols-3 gap-4">
						{[0, 1, 2].map((col) => (
							<div key={col} className="rounded-sm border p-2">
								<div className="h-4 w-24 mb-2 rounded-sm bg-muted animate-pulse" />
								<div className="h-48 w-full rounded-sm bg-muted animate-pulse" />
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
