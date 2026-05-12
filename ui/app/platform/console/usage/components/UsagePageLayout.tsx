/**
 * UsagePageLayout — shared page layout shell for Usage pages.
 * Provides page header, date range picker, and content area for tabs.
 */
import type { ReactNode } from "react";
import { UsageDateRangePicker, type DateRange } from "./DateRangePicker";

interface UsagePageLayoutProps {
	title: string;
	subtitle?: string;
	children: ReactNode;
	dateRange: DateRange;
	onDateRangeChange: (range: DateRange) => void;
	isLoading?: boolean;
	actions?: ReactNode; // extra buttons in the header
	tabs?: ReactNode; // tab navigation
	disabled?: boolean;
}

export function UsagePageLayout({
	title,
	subtitle,
	children,
	dateRange,
	onDateRangeChange,
	isLoading,
	actions,
	tabs,
	disabled,
}: UsagePageLayoutProps) {
	return (
		<div className="flex flex-col gap-4">
			{/* Page header */}
			<div className="flex items-start justify-between gap-4">
				<div className="flex flex-col gap-1">
					<h1 className="text-xl font-semibold">{title}</h1>
					{subtitle && <p className="text-content-disabled text-sm">{subtitle}</p>}
				</div>
				<div className="flex items-center gap-2">
					<UsageDateRangePicker value={dateRange} onChange={onDateRangeChange} disabled={disabled} />
					{actions && <div className="flex items-center gap-2">{actions}</div>}
				</div>
			</div>

			{/* Tab navigation */}
			{tabs && tabs}
			<div>{children}</div>
		</div>
	);
}