/**
 * RankingsChart — bar chart for usage rankings.
 * Shows top N entities as bars, with an "Other" bar for the rest.
 * Used by BreakdownTab for comparing team/user/member rankings.
 */
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/app/workspace/dashboard/components/charts/chartCard";
import type { PlatformUsageRankingEntry } from "@/lib/platform/types";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface RankingsChartProps {
	title?: string;
	rankings: PlatformUsageRankingEntry[];
	metric?: "requests" | "tokens" | "cost";
	height?: string;
	isLoading?: boolean;
	headerActions?: ReactNode;
	testId?: string;
}

const COLOR_MAP: Record<string, string> = {
	Other: "#d1d5db",
};

function getColor(name: string, index: number): string {
	if (COLOR_MAP[name]) return COLOR_MAP[name];
	const colors = ["#000000", "#374151", "#6b7280", "#9ca3af", "#3b82f6", "#60a5fa", "#93c5fd", "#2563eb"];
	return colors[index % colors.length];
}

function formatValue(value: number, metric: string): string {
	if (metric === "cost") return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
	if (metric === "tokens") return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString();
	return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString();
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; color: string }[]; label?: string }) {
	if (!active || !payload?.length) return null;
	return (
		<div className="bg-background rounded-sm border p-2 shadow-sm">
			<p className="mb-1 text-xs font-medium">{label}</p>
			<p className="text-xs">{formatValue(payload[0].value, "requests")}</p>
		</div>
	);
}

type MetricKey = "requests" | "tokens" | "cost";

const METRIC_LABELS: Record<MetricKey, string> = {
	requests: "Requests",
	tokens: "Tokens",
	cost: "Cost",
};

const METRIC_COLORS: Record<MetricKey, string> = {
	requests: "#000000",
	tokens: "#3b82f6",
	cost: "#22c55e",
};

export function RankingsChart({
	title = "Rankings",
	rankings,
	metric = "requests",
	height = "250px",
	isLoading,
	headerActions,
	testId,
}: RankingsChartProps) {
	const data = rankings.map((r) => ({
		name: r.name.length > 12 ? `${r.name.slice(0, 12)}…` : r.name,
		fullName: r.name,
		value: r[metric],
		color: getColor(r.name, rankings.indexOf(r)),
	}));

	return (
		<ChartCard title={title} height={height} loading={isLoading} headerActions={headerActions} testId={testId}>
			<div className="mb-2 flex items-center gap-2">
				{(["requests", "tokens", "cost"] as MetricKey[]).map((m) => (
					<button
						key={m}
						onClick={() => {}}
						className={cn(
							"rounded px-2 py-0.5 text-xs transition-colors",
							metric === m ? "bg-black text-white" : "bg-muted text-muted-foreground hover:bg-muted/80",
						)}
					>
						{METRIC_LABELS[m]}
					</button>
				))}
			</div>
			<ResponsiveContainer width="100%" height="calc(100% - 36px)">
				<BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
					<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
					<XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatValue(v, metric)} />
					<YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={80} />
					<Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--muted)" }} />
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