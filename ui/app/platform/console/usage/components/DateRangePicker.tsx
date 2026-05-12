/**
 * UsageDateRangePicker — simple preset-based date range selector for usage pages.
 * Wraps DateTimePickerWithRange but exposes a simpler API.
 * Falls back to preset buttons if dateTime is not used.
 */
import { useState } from "react";
import { DateTimePickerWithRange } from "@/components/ui/datePickerWithRange";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format, subDays } from "date-fns";

export interface DateRange {
	start_date: string; // YYYY-MM-DD
	end_date: string; // YYYY-MM-DD
}

interface UsageDateRangePickerProps {
	value: DateRange;
	onChange: (range: DateRange) => void;
	className?: string;
	disabled?: boolean;
}

const PRESETS = [
	{ label: "7d", days: 7 },
	{ label: "30d", days: 30 },
	{ label: "90d", days: 90 },
] as const;

function toDateRange(days: number): DateRange {
	const end = new Date();
	end.setHours(23, 59, 59, 999);
	const start = subDays(end, days - 1);
	start.setHours(0, 0, 0, 0);
	return {
		start_date: format(start, "yyyy-MM-dd"),
		end_date: format(end, "yyyy-MM-dd"),
	};
}

function getPeriodLabel(start_date: string, end_date: string): string {
	const start = new Date(start_date);
	const end = new Date(end_date);
	const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
	if (diffDays === 7) return "Last 7 days";
	if (diffDays === 30) return "Last 30 days";
	if (diffDays === 90) return "Last 90 days";
	return `${format(start, "MMM dd")} – ${format(end, "MMM dd, yyyy")}`;
}

export function UsageDateRangePicker({ value, onChange, className, disabled }: UsageDateRangePickerProps) {
	const [showCalendar, setShowCalendar] = useState(false);

	const periodLabel = getPeriodLabel(value.start_date, value.end_date);

	return (
		<div className={cn("flex items-center gap-2", className)}>
			<div className="flex items-center gap-1 rounded-md border p-0.5">
				{PRESETS.map((preset) => {
					const isActive = value.start_date === toDateRange(preset.days).start_date && value.end_date === toDateRange(preset.days).end_date;
					return (
						<Button
							key={preset.days}
							variant="ghost"
							size="sm"
							disabled={disabled}
							onClick={() => onChange(toDateRange(preset.days))}
							className={cn(
								"h-7 px-3 text-xs",
								value.start_date === toDateRange(preset.days).start_date && "bg-primary text-primary-foreground hover:bg-primary/80",
							)}
						>
							{preset.label}
						</Button>
					);
				})}
			</div>
			<Button variant="outline" size="sm" disabled={disabled} onClick={() => setShowCalendar((v) => !v)} className="h-7 px-3 text-xs">
				{periodLabel}
			</Button>
		</div>
	);
}

export { getPeriodLabel, toDateRange, getPeriodLabel as usePeriodLabel };