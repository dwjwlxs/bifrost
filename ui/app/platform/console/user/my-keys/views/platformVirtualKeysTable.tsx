import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { resetDurationLabels } from "@/lib/constants/governance";
import { getErrorMessage, useDeleteVirtualKeyMutation } from "@/lib/store";
import { Customer, Team, VirtualKey } from "@/lib/types/governance";
import { cn } from "@/lib/utils";
import { RateLimitDisplay } from "@/components/rateLimitDisplay";
import { formatCurrency } from "@/lib/utils/governance";
import { ChevronLeft, ChevronRight, Copy, Eye, EyeOff, Loader2, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const formatResetDuration = (duration: string) => resetDurationLabels[duration] || duration;

function VKBudgetCell({ vk }: { vk: VirtualKey }) {
	if (!vk.budgets || vk.budgets.length === 0) {
		return <span className="text-muted-foreground text-sm">-</span>;
	}

	return (
		<div className="flex flex-col gap-0.5">
			{vk.budgets.map((b: any, idx: number) => (
				<div key={idx} className="flex flex-col">
					<span className={cn("font-mono text-sm", b.current_usage >= b.max_limit && "text-red-400")}>
						{formatCurrency(b.current_usage)} / {formatCurrency(b.max_limit)}
					</span>
					<span className="text-muted-foreground text-xs">
						Resets {formatResetDuration(b.reset_duration)}
						{vk.calendar_aligned && " (calendar)"}
					</span>
				</div>
			))}
		</div>
	);
}

function VKRateLimitCell({ vk }: { vk: VirtualKey }) {
	if (!vk.rate_limit) {
		return <span className="text-muted-foreground text-sm">-</span>;
	}

	return <RateLimitDisplay rateLimits={vk.rate_limit} />;
}

function VKStatusBadge({ vk }: { vk: VirtualKey }) {
	const isExhausted =
		vk.budgets?.some((b: any) => b.current_usage >= b.max_limit) ||
		(vk.rate_limit?.token_current_usage &&
			vk.rate_limit?.token_max_limit &&
			vk.rate_limit.token_current_usage >= vk.rate_limit.token_max_limit) ||
		(vk.rate_limit?.request_current_usage &&
			vk.rate_limit?.request_max_limit &&
			vk.rate_limit.request_current_usage >= vk.rate_limit.request_max_limit);

	return (
		<Badge variant={vk.is_active ? (isExhausted ? "destructive" : "default") : "secondary"}>
			{vk.is_active ? (isExhausted ? "Exhausted" : "Active") : "Inactive"}
		</Badge>
	);
}

function VKDeleteButton({ vk, isDeleting, onDelete }: { vk: VirtualKey; isDeleting: boolean; onDelete: (vkId: string) => void }) {
	const handleDelete = () => {
		if (confirm(`Are you sure you want to delete "${vk.name}"? This action cannot be undone.`)) {
			onDelete(vk.id);
		}
	};

	return (
		<Button
			variant="ghost"
			size="sm"
			className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
			onClick={handleDelete}
			disabled={isDeleting}
		>
			{isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
		</Button>
	);
}

interface PlatformVirtualKeysTableProps {
	virtualKeys: VirtualKey[];
	totalCount: number;
	teams: Team[];
	customers: Customer[];
	search: string;
	debouncedSearch: string;
	onSearchChange: (value: string) => void;
	offset: number;
	limit: number;
	onOffsetChange: (offset: number) => void;
	sortBy?: string;
	order?: string;
	onSortChange: (sortBy: string, order: string) => void;
}

export default function PlatformVirtualKeysTable({
	virtualKeys,
	totalCount,
	teams,
	customers,
	search,
	debouncedSearch,
	onSearchChange,
	offset,
	limit,
	onOffsetChange,
	sortBy,
	order,
	onSortChange,
}: PlatformVirtualKeysTableProps) {
	const [deleteVirtualKey, { isLoading: isDeleting }] = useDeleteVirtualKeyMutation();
	const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
	const { copy, copied } = useCopyToClipboard();

	const handleDeleteKey = async (vkId: string) => {
		try {
			await deleteVirtualKey(vkId).unwrap();
			toast.success("Virtual key deleted successfully");
		} catch (error) {
			toast.error(`Failed to delete virtual key: ${getErrorMessage(error)}`);
		}
	};

	const toggleKeyVisibility = (vkId: string) => {
		setRevealedKeys((prev) => {
			const next = new Set(prev);
			if (next.has(vkId)) {
				next.delete(vkId);
			} else {
				next.add(vkId);
			}
			return next;
		});
	};

	const handleSortChange = (column: string) => {
		const newOrder = sortBy === column && order === "asc" ? "desc" : "asc";
		onSortChange(column, newOrder);
	};

	const pageCount = Math.ceil(totalCount / limit);
	const currentPage = Math.floor(offset / limit) + 1;

	return (
		<div className="space-y-4">
			{/* Search bar */}
			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
					<Input placeholder="Search keys by name..." value={search} onChange={(e) => onSearchChange(e.target.value)} className="pl-10" />
				</div>
			</div>

			{/* Table */}
			{virtualKeys.length === 0 ? (
				<div className="text-muted-foreground py-12 text-center">
					{search ? "No keys found matching your search." : "You don't have any virtual keys yet."}
				</div>
			) : (
				<>
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-[200px]">
										<button
											type="button"
											onClick={() => handleSortChange("name")}
											className="hover:text-foreground flex items-center gap-2"
										>
											Name
											{sortBy === "name" && <span className="text-xs">{order === "asc" ? "↑" : "↓"}</span>}
										</button>
									</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Assigned To</TableHead>
									<TableHead>Budget</TableHead>
									<TableHead>Rate Limit</TableHead>
									<TableHead className="w-[100px]">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{virtualKeys.map((vk) => {
									const isRevealed = revealedKeys.has(vk.id);
									return (
										<TableRow key={vk.id}>
											<TableCell className="font-medium">
												<div className="flex flex-col gap-1">
													<span className="font-medium">{vk.name}</span>
													<div className="flex items-center gap-2">
														<span className="text-muted-foreground max-w-[150px] truncate font-mono text-xs">
															{isRevealed ? vk.value : "••••••••••••••••"}
														</span>
														<TooltipProvider>
															<Tooltip>
																<TooltipTrigger asChild>
																	<Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => toggleKeyVisibility(vk.id)}>
																		{isRevealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
																	</Button>
																</TooltipTrigger>
																<TooltipContent>
																	<p>{isRevealed ? "Hide key" : "Show key"}</p>
																</TooltipContent>
															</Tooltip>
														</TooltipProvider>
														<TooltipProvider>
															<Tooltip>
																<TooltipTrigger asChild>
																	<Button
																		variant="ghost"
																		size="sm"
																		className="h-6 w-6 p-0"
																		onClick={() => {
																			copy(vk.value);
																			toast.success("Key copied to clipboard");
																		}}
																	>
																		<Copy className="h-3 w-3" />
																	</Button>
																</TooltipTrigger>
																<TooltipContent>
																	<p>Copy key</p>
																</TooltipContent>
															</Tooltip>
														</TooltipProvider>
													</div>
													{vk.description && <span className="text-muted-foreground text-xs">{vk.description}</span>}
												</div>
											</TableCell>
											<TableCell>
												<VKStatusBadge vk={vk} />
											</TableCell>
											<TableCell>{vk.team ? `Team: ${vk.team.name}` : vk.customer ? `Customer: ${vk.customer.name}` : "-"}</TableCell>
											<TableCell>
												<VKBudgetCell vk={vk} />
											</TableCell>
											<TableCell>
												<VKRateLimitCell vk={vk} />
											</TableCell>
											<TableCell>
												<div className="flex items-center gap-1">
													<VKDeleteButton vk={vk} isDeleting={isDeleting} onDelete={handleDeleteKey} />
												</div>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>

					{/* Pagination */}
					{pageCount > 1 && (
						<div className="flex items-center justify-between">
							<div className="text-muted-foreground text-sm">
								Showing {offset + 1} to {Math.min(offset + limit, totalCount)} of {totalCount} keys
							</div>
							<div className="flex items-center gap-2">
								<Button variant="outline" size="sm" onClick={() => onOffsetChange(offset - limit)} disabled={currentPage === 1}>
									<ChevronLeft className="h-4 w-4" />
									Previous
								</Button>
								<span className="text-sm">
									Page {currentPage} of {pageCount}
								</span>
								<Button variant="outline" size="sm" onClick={() => onOffsetChange(offset + limit)} disabled={currentPage === pageCount}>
									Next
									<ChevronRight className="h-4 w-4" />
								</Button>
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}