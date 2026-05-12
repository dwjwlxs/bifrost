/**
 * BreakdownTable — sortable table for usage rankings.
 * Shows entity name + metrics in a compact table, with optional "Other" row.
 * Used by BreakdownTab alongside RankingsChart.
 */
import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlatformUsageRankingEntry } from "@/lib/platform/types";
import type { ReactNode } from "react";
import { useState } from "react";

interface BreakdownTableProps {
	rankings: PlatformUsageRankingEntry[];
	metric?: "requests" | "tokens" | "cost";
	isLoading?: boolean;
	maxRows?: number;
}

type SortKey = "requests" | "tokens" | "cost";
type SortDir = "asc" | "desc";

function formatValue(value: number, metric: string): string {
	if (metric === "cost") return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
	if (metric === "tokens" || metric === "requests") return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString();
	return value.toString();
}

function SortIcon({ column, sortKey, sortDir }: { column: SortKey; sortKey: SortKey; sortDir: SortDir }) {
	if (sortKey !== column) return <ArrowUpDown className="text-content-disabled h-3 w-3" />;
	return sortDir === "desc" ? <ArrowDown className="text-primary h-3 w-3" /> : <ArrowUp className="text-primary h-3 w-3" />;
}

export function BreakdownTableSkeleton() {
	return (
		<div className="space-y-2">
			{[0, 1, 2, 3].map((i) => (
				<div key={i} className="flex items-center gap-4">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-4 w-16" />
					<Skeleton className="h-4 w-16" />
					<Skeleton className="h-4 w-16" />
				</div>
			))}
		</div>
	);
}

export function BreakdownTable({ rankings, metric = "requests", isLoading, maxRows = 10 }: BreakdownTableProps) {
	// Client-side sorting — only sort the visible rows
	const [sortKey, setSortKey] = useState<SortKey>("requests");
	const [sortDir, setSortDir] = useState<SortDir>("desc");

	function handleSort(key: SortKey) {
		if (sortKey === key) {
			setSortDir((d) => (d === "desc" ? "asc" : "desc"));
		} else {
			setSortKey(key);
			setSortDir("desc");
		}
	}

	const sorted = [...rankings].sort((a, b) => {
		const diff = a[sortKey] - b[sortKey];
		return sortDir === "desc" ? -diff : diff;
	});

	const displayed = sorted.slice(0, maxRows);

	if (isLoading) return <BreakdownTableSkeleton />;

	return (
		<div className="overflow-x-auto">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b">
						<th className="text-content-disabled pb-2 text-left font-medium">Entity</th>
						<th className="pb-2 text-right font-medium">
							<button className="hover:text-foreground ml-auto flex items-center gap-1" onClick={() => handleSort("requests")}>
								Requests
								<SortIcon column="requests" sortKey={sortKey} sortDir={sortDir} />
							</button>
						</th>
						<th className="pb-2 text-right font-medium">
							<button className="hover:text-foreground ml-auto flex items-center gap-1" onClick={() => handleSort("tokens")}>
								Tokens
								<SortIcon column="tokens" sortKey={sortKey} sortDir={sortDir} />
							</button>
						</th>
						<th className="pb-2 text-right font-medium">
							<button className="hover:text-foreground ml-auto flex items-center gap-1" onClick={() => handleSort("cost")}>
								Cost
								<SortIcon column="cost" sortKey={sortKey} sortDir={sortDir} />
							</button>
						</th>
					</tr>
				</thead>
				<tbody>
					{displayed.map((row, i) => (
						<tr key={row.key || row.name || i} className="border-b last:border-0">
							<td className="py-2 font-medium">{row.name}</td>
							<td className="text-content-disabled py-2 text-right tabular-nums">{formatValue(row.requests, "requests")}</td>
							<td className="text-content-disabled py-2 text-right tabular-nums">{formatValue(row.tokens, "tokens")}</td>
							<td className="text-content-disabled py-2 text-right tabular-nums">{formatValue(row.cost, "cost")}</td>
						</tr>
					))}
					{rankings.length > maxRows && (
						<tr className="text-content-disabled">
							<td className="py-2 text-xs italic">+ {rankings.length - maxRows} more</td>
							<td />
							<td />
							<td />
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}