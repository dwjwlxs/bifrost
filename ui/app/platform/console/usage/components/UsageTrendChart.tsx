/**
 * UsageTrendChart — bar chart for usage trends over time.
 * Each chart shows one data type (requests / tokens / cost).
 * X-axis auto-detects granularity: HH:mm for intra-day data (< 6h gaps), MM-dd otherwise.
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/app/workspace/dashboard/components/charts/chartCard";
import { format } from "date-fns";

/** Minimal row shape that UsageTrendChart needs — only requires date + one data field. */
export interface TrendRow {
	date: string;
	requests?: number;
	tokens?: number;
	cost?: number;
	input_tokens?: number;
	output_tokens?: number;
	[key: string]: string | number | undefined;
}

interface UsageTrendChartProps {
	title?: string;
	rows: TrendRow[];
	dataKey: "requests" | "tokens" | "cost";
	height?: string;
	isLoading?: boolean;
	headerActions?: React.ReactNode;
	testId?: string;
}

interface FlatRow {
	/** Pre-formatted label for the X-axis tick. */
	date: string;
	/** Full ISO string — used for tooltip only. */
	isoDate: string;
	requests: number;
	tokens: number;
	cost: number;
}

/** Compute median gap (ms) between adjacent timestamps; returns 0 if < 2 points. */
function medianGapMs(dates: string[]): number {
	if (dates.length < 2) return 0;
	const sorted = [...dates].map((d) => new Date(d).getTime()).sort((a, b) => a - b);
	const gaps: number[] = [];
	for (let i = 1; i < sorted.length; i++) {
		gaps.push(sorted[i] - sorted[i - 1]);
	}
	gaps.sort((a, b) => a - b);
	const mid = Math.floor(gaps.length / 2);
	return gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
}

/**
 * Determine X-axis label format based on the typical gap between data points.
 * - < 6 hours → "HH:mm" (intra-day / sub-daily granularity)
 * - ≥ 6 hours → "MM-dd" (daily+ granularity)
 */
function axisFormat(gapMs: number): "time" | "date" {
	return gapMs > 0 && gapMs < 24 * 60 * 60 * 1000 ? "time" : "date";
}

function formatAxisLabel(isoDate: string, mode: "time" | "date"): string {
	try {
		if (mode === "time") return format(new Date(isoDate), "MM-dd HH:mm");
		return format(new Date(isoDate), "MM-dd");
	} catch {
		return isoDate;
	}
}

function formatTooltipDate(isoDate: string): string {
	try {
		return format(new Date(isoDate), "MMM dd, yyyy HH:mm");
	} catch {
		return isoDate;
	}
}

function buildChartData(rows: TrendRow[]): { rows: FlatRow[]; mode: "time" | "date" } {
	const sorted = [...rows].sort(
		(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
	);

	const isoDates = sorted.map((r) => r.date);
	const gap = medianGapMs(isoDates);
	const mode = axisFormat(gap);

	const flatRows: FlatRow[] = sorted.map((r) => ({
		date: formatAxisLabel(r.date, mode),
		isoDate: r.date,
		requests: r.requests ?? 0,
		tokens: r.tokens ?? 0,
		cost: r.cost ?? 0,
	}));

	return { rows: flatRows, mode };
}

const COLOR_MAP: Record<"requests" | "tokens" | "cost", string> = {
	requests: "#3b82f6",
	tokens: "#8b5cf6",
	cost: "#10b981",
};

const LABEL_MAP: Record<"requests" | "tokens" | "cost", string> = {
	requests: "Requests",
	tokens: "Tokens",
	cost: "Cost",
};

function formatYAxis(v: number): string {
	if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
	if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
	return String(v);
}

function CustomTooltip({
	active,
	payload,
	dataKey,
}: {
	active?: boolean;
	payload?: { value: number; color: string; payload?: FlatRow }[];
	dataKey: "requests" | "tokens" | "cost";
}) {
	if (!active || !payload?.length) return null;
	const value = payload[0]?.value ?? 0;
	const isoDate = payload[0]?.payload?.isoDate;
	return (
		<div className="bg-background rounded-sm border p-2 shadow-sm">
			<p className="text-content-disabled mb-1 text-xs font-medium">
				{isoDate ? formatTooltipDate(isoDate) : ""}
			</p>
			<p className="text-xs">
				{dataKey === "cost" ? `$${value.toFixed(value < 0.01 ? 4 : 2)}` : value.toLocaleString()}
			</p>
		</div>
	);
}

export function UsageTrendChart({
	title = "Trend",
	rows,
	dataKey,
	height = "200px",
	isLoading,
	headerActions,
	testId,
}: UsageTrendChartProps) {
	const { rows: chartRows } = buildChartData(rows);
	const color = COLOR_MAP[dataKey];
	const label = LABEL_MAP[dataKey];

	return (
		<ChartCard title={title} height={height} loading={isLoading} headerActions={headerActions} testId={testId}>
			<ResponsiveContainer width="100%" height="100%">
				<BarChart data={chartRows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
						tickFormatter={formatYAxis}
					/>
					<Tooltip content={<CustomTooltip dataKey={dataKey} />} />
					<Bar dataKey={dataKey} name={label} fill={color} radius={[2, 2, 0, 0]} />
				</BarChart>
			</ResponsiveContainer>
		</ChartCard>
	);
}
