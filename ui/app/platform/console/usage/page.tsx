import { useState } from "react";
import { usePlatformGetUsageStatsQuery, usePlatformGetTokenUsageQuery, useUserRole } from "@/lib/platform";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Activity, BarChart3, Zap, DollarSign, PhoneCall, ChevronLeft, ChevronRight } from "lucide-react";
import { usePlatformAdminGetUsageStatsQuery } from "@/lib/platform/platformApi";

function formatDate(daysAgo: number): string {
	const d = new Date();
	d.setDate(d.getDate() - daysAgo);
	return d.toISOString().split("T")[0];
}

export default function UsagePage() {
	const { isAdmin } = useUserRole();
	const [groupBy, setGroupBy] = useState("day");
	const [dateRange, setDateRange] = useState(30);
	const [page, setPage] = useState(0);
	const pageSize = 20;

	const startDate = formatDate(dateRange);
	const endDate = formatDate(0);

	const commonParams = { start_date: startDate, end_date: endDate, group_by: groupBy };

	const { data: userStats, isLoading: userStatsLoading } = usePlatformGetUsageStatsQuery(commonParams);
	const { data: adminStats, isLoading: adminStatsLoading } = usePlatformAdminGetUsageStatsQuery(isAdmin ? commonParams : skipToken);
	const { data: tokenUsageData, isLoading: tokenUsageLoading } = usePlatformGetTokenUsageQuery({
		offset: page * pageSize,
		limit: pageSize,
	});

	const stats = isAdmin && adminStats ? adminStats : userStats;
	const isLoading = userStatsLoading || (isAdmin && adminStatsLoading) || tokenUsageLoading;

	const summary = stats?.summary ?? { total_calls: 0, total_tokens: 0, total_credits: 0 };
	const details = stats?.details ?? [];

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Usage Analytics</h1>
					<p className="text-muted-foreground">Track your API usage, token consumption, and credit spending.</p>
				</div>
				{isAdmin && <Badge variant="default">Admin View</Badge>}
			</div>

			{/* Filters */}
			<div className="flex items-end gap-4">
				<div className="grid gap-2">
					<Label>Period</Label>
					<Select value={String(dateRange)} onValueChange={(v) => setDateRange(Number(v))}>
						<SelectTrigger className="w-32" data-testid="usage-period-select">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="7">7 days</SelectItem>
							<SelectItem value="30">30 days</SelectItem>
							<SelectItem value="90">90 days</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-2">
					<Label>Group By</Label>
					<Select value={groupBy} onValueChange={setGroupBy}>
						<SelectTrigger className="w-32" data-testid="usage-groupby-select">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="day">Day</SelectItem>
							<SelectItem value="model">Model</SelectItem>
							<SelectItem value="provider">Provider</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			{/* Summary Cards */}
			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Total Calls</CardTitle>
						<PhoneCall className="text-muted-foreground h-4 w-4" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{summary.total_calls.toLocaleString()}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
						<Zap className="text-muted-foreground h-4 w-4" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{summary.total_tokens.toLocaleString()}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Credits Consumed</CardTitle>
						<DollarSign className="text-muted-foreground h-4 w-4" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{summary.total_credits.toFixed(2)}</div>
					</CardContent>
				</Card>
			</div>

			{/* Grouped Usage Breakdown */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<BarChart3 className="h-5 w-5" />
						Usage Breakdown
					</CardTitle>
					<CardDescription>Usage grouped by {groupBy}</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex items-center justify-center py-10">
							<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
						</div>
					) : details.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<Activity className="text-muted-foreground/40 mb-3 h-8 w-8" />
							<p className="text-muted-foreground text-sm">No usage data for the selected period.</p>
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</TableHead>
									<TableHead className="text-right">Calls</TableHead>
									<TableHead className="text-right">Input Tokens</TableHead>
									<TableHead className="text-right">Output Tokens</TableHead>
									<TableHead className="text-right">Total Tokens</TableHead>
									<TableHead className="text-right">Credits</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{details.map((row) => (
									<TableRow key={row.key}>
										<TableCell className="font-medium">{row.key}</TableCell>
										<TableCell className="text-right">{row.call_count.toLocaleString()}</TableCell>
										<TableCell className="text-right">{row.input_tokens.toLocaleString()}</TableCell>
										<TableCell className="text-right">{row.output_tokens.toLocaleString()}</TableCell>
										<TableCell className="text-right">{row.total_tokens.toLocaleString()}</TableCell>
										<TableCell className="text-right">{row.credits_consumed.toFixed(4)}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Recent Token Usage */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Activity className="h-5 w-5" />
						Recent Token Usage
					</CardTitle>
					<CardDescription>Detailed log of recent API calls.</CardDescription>
				</CardHeader>
				<CardContent>
					{tokenUsageLoading ? (
						<div className="flex items-center justify-center py-10">
							<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
						</div>
					) : !tokenUsageData?.list || tokenUsageData.list.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<Activity className="text-muted-foreground/40 mb-3 h-8 w-8" />
							<p className="text-muted-foreground text-sm">No token usage records yet.</p>
						</div>
					) : (
						<>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Time</TableHead>
										<TableHead>Model</TableHead>
										<TableHead>Provider</TableHead>
										<TableHead className="text-right">Input</TableHead>
										<TableHead className="text-right">Output</TableHead>
										<TableHead className="text-right">Cost</TableHead>
										<TableHead>Source</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{tokenUsageData.list.map((usage) => (
										<TableRow key={usage.id}>
											<TableCell className="text-muted-foreground text-sm">{new Date(usage.created_at).toLocaleString()}</TableCell>
											<TableCell className="font-mono text-sm">{usage.model}</TableCell>
											<TableCell className="text-sm">{usage.provider}</TableCell>
											<TableCell className="text-right">{usage.input_tokens.toLocaleString()}</TableCell>
											<TableCell className="text-right">{usage.output_tokens.toLocaleString()}</TableCell>
											<TableCell className="text-right">${usage.cost.toFixed(4)}</TableCell>
											<TableCell>
												<Badge variant="outline" className="text-xs">
													{usage.deduct_source}
												</Badge>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
							{(tokenUsageData.total ?? 0) > pageSize && (
								<div className="flex items-center justify-between pt-4">
									<p className="text-muted-foreground text-sm">
										Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, tokenUsageData.total)} of {tokenUsageData.total}
									</p>
									<div className="flex gap-2">
										<Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
											<ChevronLeft className="h-4 w-4" />
										</Button>
										<Button
											variant="outline"
											size="sm"
											disabled={(page + 1) * pageSize >= tokenUsageData.total}
											onClick={() => setPage(page + 1)}
										>
											<ChevronRight className="h-4 w-4" />
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

/** Sentinel to skip RTK Query when condition is false */
const skipToken = undefined as never;