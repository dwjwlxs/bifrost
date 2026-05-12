/**
 * UsagePage — 个人 User 视角的用量分析页面 (3 Tabs: Overview / Ranking / Stability)
 * 各 Tab 的数据仅在该 Tab 激活时才请求。
 */
import { useState } from "react";
import {
	usePlatformGetMeStatsQuery,
	usePlatformGetMeStatsTrendQuery,
	usePlatformGetMeDistributionQuery,
	usePlatformGetMeStabilityQuery,
} from "@/lib/platform/platformApi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OverviewTab } from "./views/overviewTab";
import { RankingTab } from "./views/rankingTab";
import { StabilityTab } from "./views/stabilityTab";
import { UsageDateRangePicker, type DateRange, toDateRange } from "./components/DateRangePicker";

export default function UsagePage() {
	const [dateRange, setDateRange] = useState<DateRange>(toDateRange(30));
	const [activeTab, setActiveTab] = useState<"overview" | "ranking" | "stability">("overview");

	const { start_date, end_date } = dateRange;
	const commonParams = { start_date, end_date };

	// Overview: 只在 overview tab 时请求
	const { data: meStats, isLoading: statsLoading } = usePlatformGetMeStatsQuery(commonParams, {
		skip: activeTab !== "overview",
	});
	const { data: trendData, isLoading: trendLoading } = usePlatformGetMeStatsTrendQuery(commonParams, {
		skip: activeTab !== "overview",
	});

	// Ranking: 只在 ranking tab 时请求
	const { data: distProvider, isLoading: providerLoading } = usePlatformGetMeDistributionQuery(
		{ ...commonParams, dimension: "provider" },
		{ skip: activeTab !== "ranking" },
	);
	const { data: distModel, isLoading: modelLoading } = usePlatformGetMeDistributionQuery(
		{ ...commonParams, dimension: "model" },
		{ skip: activeTab !== "ranking" },
	);
	const { data: distVk, isLoading: vkLoading } = usePlatformGetMeDistributionQuery(
		{ ...commonParams, dimension: "virtual_key_name" },
		{ skip: activeTab !== "ranking" },
	);

	// Stability: 只在 stability tab 时请求
	const { data: stabilityData, isLoading: stabilityLoading } = usePlatformGetMeStabilityQuery(commonParams, {
		skip: activeTab !== "stability",
	});

	const rankingLoading = providerLoading || modelLoading || vkLoading;
	const overviewLoading = statsLoading || trendLoading;

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Usage Analytics</h1>
					<p className="text-muted-foreground text-sm">Track your API usage, token consumption, and credit spending.</p>
				</div>
				<UsageDateRangePicker value={dateRange} onChange={setDateRange} />
			</div>

			<Tabs
				value={activeTab}
				onValueChange={(v) => setActiveTab(v as typeof activeTab)}
				className="space-y-6"
			>
				<TabsList>
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="ranking">Ranking</TabsTrigger>
					<TabsTrigger value="stability">Stability</TabsTrigger>
				</TabsList>

				<TabsContent value="overview" className="space-y-6">
					{overviewLoading ? (
						<OverviewTabSkeleton />
					) : (
						<OverviewTab
							stats={meStats}
							trendData={trendData}
							startDate={start_date}
							endDate={end_date}
						/>
					)}
				</TabsContent>

				<TabsContent value="ranking" className="space-y-6">
					<RankingTab
						distProvider={distProvider}
						distModel={distModel}
						distVk={distVk}
						isLoading={rankingLoading}
					/>
				</TabsContent>

				<TabsContent value="stability" className="space-y-6">
					<StabilityTab
						data={stabilityData}
						isLoading={stabilityLoading}
						startDate={start_date}
						endDate={end_date}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}

function OverviewTabSkeleton() {
	return (
		<div className="space-y-6">
			<div className="grid grid-cols-3 gap-4">
				{[0, 1, 2].map((i) => (
					<div key={i} className="rounded-sm border p-4">
						<div className="h-4 w-20 mb-2 rounded-sm bg-muted animate-pulse" />
						<div className="h-8 w-24 rounded-sm bg-muted animate-pulse" />
					</div>
				))}
			</div>
			<div className="grid grid-cols-1 gap-4">
				{[0, 1, 2].map((i) => (
					<div key={i} className="rounded-sm border p-2">
						<div className="h-4 w-32 mb-2 rounded-sm bg-muted animate-pulse" />
						<div className="h-48 w-full rounded-sm bg-muted animate-pulse" />
					</div>
				))}
			</div>
		</div>
	);
}
