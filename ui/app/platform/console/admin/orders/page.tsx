import { useState } from "react";
import { usePlatformListOrdersQuery, usePlatformCancelOrderMutation, usePlatformConfirmOrderMutation } from "@/lib/platform/platformApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { format } from "date-fns";
import {
	ArrowLeft,
	ArrowRight,
	XCircle,
	CheckCircle2,
	Loader2,
	ShoppingCart,
	Wallet,
	Clock,
	AlertCircle,
	Filter,
	RefreshCw,
	Package,
	Building2,
	User,
} from "lucide-react";

const PAGE_SIZE = 15;

const STATUS_OPTIONS = [
	{ value: "all", label: "All Statuses" },
	{ value: "pending", label: "Pending" },
	{ value: "success", label: "Success" },
	{ value: "failed", label: "Failed" },
	{ value: "expired", label: "Expired" },
	{ value: "canceled", label: "Canceled" },
];

const TYPE_OPTIONS = [
	{ value: "all", label: "All Types" },
	{ value: "recharge", label: "Recharge" },
	{ value: "purchase", label: "Purchase" },
];

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline" | "success"> = {
	pending: "outline",
	success: "success",
	failed: "destructive",
	expired: "secondary",
	canceled: "secondary",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
	recharge: <Wallet className="h-3.5 w-3.5" />,
	purchase: <ShoppingCart className="h-3.5 w-3.5" />,
};

function formatDateTime(dateStr: string | undefined): string {
	if (!dateStr) return "—";
	try {
		return format(new Date(dateStr), "MMM d, yyyy HH:mm");
	} catch {
		return dateStr;
	}
}

type OrderItem = ReturnType<typeof usePlatformListOrdersQuery>["data"]["items"][number];

function OrderRow({
	order,
	onCancel,
	onConfirm,
	cancelingId,
	confirmingId,
}: {
	order: OrderItem;
	onCancel: (orderId: number) => void;
	onConfirm: (orderId: number) => void;
	cancelingId: number | null;
	confirmingId: number | null;
}) {
	const canCancel = order.status === "pending";
	const canConfirm = order.status === "pending";

	return (
		<TableRow>
			<TableCell className="max-w-[140px] truncate font-mono text-xs" title={order.order_no}>
				{order.order_no}
			</TableCell>
			<TableCell>
				<div className="flex items-center gap-1.5">
					{TYPE_ICONS[order.type] ?? <Clock className="h-3.5 w-3.5" />}
					<span className="capitalize">{order.type}</span>
				</div>
			</TableCell>
			<TableCell>
				<div className="flex flex-col gap-0.5">
					<span className="font-medium">${order.amount.toFixed(2)}</span>
					<span className="text-muted-foreground text-xs">{order.credits.toLocaleString()} credits</span>
				</div>
			</TableCell>
			<TableCell>
				<Badge variant={STATUS_COLORS[order.status] ?? "outline"} className="capitalize">
					{order.status}
				</Badge>
			</TableCell>
			<TableCell className="text-sm capitalize">{order.payment_method}</TableCell>
			<TableCell>
				<div className="text-muted-foreground flex flex-col gap-0.5 text-xs">
					<div className="flex items-center gap-1">
						<User className="h-3 w-3" />
						<span className="max-w-[100px] truncate" title={order.user_id ?? "—"}>
							{order.user_id ?? "—"}
						</span>
					</div>
					<div className="flex items-center gap-1">
						{order.tenant_type === "organization" ? <Building2 className="h-3 w-3" /> : <User className="h-3 w-3" />}
						<span className="max-w-[100px] truncate" title={order.tenant_id}>
							{order.tenant_id}
						</span>
					</div>
				</div>
			</TableCell>
			<TableCell className="text-muted-foreground text-xs">{formatDateTime(order.created_at)}</TableCell>
			<TableCell className="text-muted-foreground text-xs">{formatDateTime(order.paid_at)}</TableCell>
			<TableCell className="text-right">
				<div className="flex items-center justify-end gap-1">
					{canConfirm && (
						<Button
							variant="ghost"
							size="sm"
							className="h-7 px-2 text-green-600 hover:bg-green-50 hover:text-green-700"
							onClick={() => onConfirm(order.id)}
							disabled={confirmingId !== null || cancelingId !== null}
							title="Confirm order"
						>
							{confirmingId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
						</Button>
					)}
					{canCancel && (
						<Button
							variant="ghost"
							size="sm"
							className="text-muted-foreground hover:text-destructive h-7 px-2"
							onClick={() => onCancel(order.id)}
							disabled={confirmingId !== null || cancelingId !== null}
							title="Cancel order"
						>
							{cancelingId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
						</Button>
					)}
				</div>
			</TableCell>
		</TableRow>
	);
}

type ActionType = "cancel" | "confirm" | null;

export default function AdminOrdersPage() {
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [typeFilter, setTypeFilter] = useState<string>("all");
	const [page, setPage] = useState(0);

	const statusParam = statusFilter === "all" ? undefined : statusFilter;
	const typeParam = typeFilter === "all" ? undefined : typeFilter;
	const { data, isLoading, refetch, isFetching } = usePlatformListOrdersQuery({
		status: statusParam,
		type: typeParam,
		offset: page * PAGE_SIZE,
		limit: PAGE_SIZE,
	});

	const [cancelOrder, { isLoading: isCanceling }] = usePlatformCancelOrderMutation();
	const [confirmOrder, { isLoading: isConfirming }] = usePlatformConfirmOrderMutation();

	const [actionDialogOpen, setActionDialogOpen] = useState(false);
	const [actionType, setActionType] = useState<ActionType>(null);
	const [targetOrderId, setTargetOrderId] = useState<number | null>(null);

	const orders = data?.items ?? [];
	const total = data?.total ?? 0;
	const totalPages = Math.ceil(total / PAGE_SIZE);
	const hasNextPage = (page + 1) * PAGE_SIZE < total;
	const hasPrevPage = page > 0;

	async function handleConfirmAction() {
		if (targetOrderId === null || actionType === null) return;
		try {
			if (actionType === "confirm") {
				await confirmOrder(targetOrderId).unwrap();
				toast.success("Order confirmed successfully");
			} else {
				await cancelOrder(targetOrderId).unwrap();
				toast.success("Order canceled");
			}
			setActionDialogOpen(false);
			setTargetOrderId(null);
			setActionType(null);
			refetch();
		} catch (err: unknown) {
			const msg =
				(err as { data?: { message?: string }; message?: string })?.data?.message ||
				(err as { message?: string })?.message ||
				"Operation failed";
			toast.error(msg);
		}
	}

	function openActionDialog(orderId: number, type: ActionType) {
		setTargetOrderId(orderId);
		setActionType(type);
		setActionDialogOpen(true);
	}

	const targetOrder = orders.find((o) => o.id === targetOrderId);
	const isProcessing = isCanceling || isConfirming;

	const dialogTitle = actionType === "confirm" ? "Confirm Order" : "Cancel Order";
	const dialogDescription =
		actionType === "confirm"
			? "This will mark the order as paid and trigger credit/package fulfillment. This action cannot be undone."
			: "This will cancel the order and release any held credits. This action cannot be undone.";

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">System Orders</h1>
					<p className="text-muted-foreground text-sm">View, confirm, or cancel all billing orders across the platform.</p>
				</div>
				<Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
					<RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
					Refresh
				</Button>
			</div>

			{/* Filters + Table */}
			<Card>
				<CardContent className="p-0">
					{/* Filter Bar */}
					<div className="flex items-center justify-between gap-4 border-b px-4 py-3">
						<div className="flex flex-wrap items-center gap-3">
							{/* Status Filter */}
							<div className="flex items-center gap-2">
								<span className="text-muted-foreground flex items-center gap-1 text-sm">
									<Filter className="h-3 w-3" />
									Status:
								</span>
								<Select
									value={statusFilter}
									onValueChange={(v) => {
										setStatusFilter(v);
										setPage(0);
									}}
								>
									<SelectTrigger className="h-8 w-36">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{STATUS_OPTIONS.map((opt) => (
											<SelectItem key={opt.value} value={opt.value}>
												{opt.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							{/* Type Filter */}
							<div className="flex items-center gap-2">
								<span className="text-muted-foreground text-sm">Type:</span>
								<Select
									value={typeFilter}
									onValueChange={(v) => {
										setTypeFilter(v);
										setPage(0);
									}}
								>
									<SelectTrigger className="h-8 w-32">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{TYPE_OPTIONS.map((opt) => (
											<SelectItem key={opt.value} value={opt.value}>
												{opt.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							{/* Legend */}
							{(statusFilter === "all" || statusFilter === "pending") && (
								<div className="text-muted-foreground ml-2 hidden items-center gap-3 text-xs md:flex">
									<span className="flex items-center gap-1">
										<CheckCircle2 className="h-3 w-3 text-green-600" />
										Confirm
									</span>
									<span className="flex items-center gap-1">
										<XCircle className="h-3 w-3" />
										Cancel
									</span>
								</div>
							)}
						</div>

						<span className="text-muted-foreground shrink-0 text-sm">
							{total.toLocaleString()} {total === 1 ? "order" : "orders"}
						</span>
					</div>

					{/* Table */}
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Order No.</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Amount / Credits</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Payment</TableHead>
									<TableHead>Tenant</TableHead>
									<TableHead>Created</TableHead>
									<TableHead>Paid At</TableHead>
									<TableHead className="w-24">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{isLoading &&
									Array.from({ length: 6 }).map((_, i) => (
										<TableRow key={i}>
											<TableCell>
												<Skeleton className="h-4 w-28" />
											</TableCell>
											<TableCell>
												<Skeleton className="h-4 w-16" />
											</TableCell>
											<TableCell>
												<Skeleton className="h-4 w-20" />
											</TableCell>
											<TableCell>
												<Skeleton className="h-4 w-16" />
											</TableCell>
											<TableCell>
												<Skeleton className="h-4 w-12" />
											</TableCell>
											<TableCell>
												<Skeleton className="h-4 w-24" />
											</TableCell>
											<TableCell>
												<Skeleton className="h-4 w-28" />
											</TableCell>
											<TableCell>
												<Skeleton className="h-4 w-28" />
											</TableCell>
											<TableCell />
										</TableRow>
									))}

								{!isLoading && orders.length === 0 && (
									<TableRow>
										<TableCell colSpan={9} className="text-muted-foreground py-16 text-center">
											<div className="flex flex-col items-center gap-3">
												<div className="bg-muted rounded-full p-3">
													<AlertCircle className="h-6 w-6 opacity-40" />
												</div>
												<div>
													<p className="font-medium">No orders found</p>
													<p className="text-muted-foreground mt-1 text-sm">Try adjusting the filters or check back later.</p>
												</div>
											</div>
										</TableCell>
									</TableRow>
								)}

								{!isLoading &&
									orders.map((order) => (
										<OrderRow
											key={order.id}
											order={order}
											onCancel={(id) => openActionDialog(id, "cancel")}
											onConfirm={(id) => openActionDialog(id, "confirm")}
											cancelingId={actionType === "cancel" ? targetOrderId : null}
											confirmingId={actionType === "confirm" ? targetOrderId : null}
										/>
									))}
							</TableBody>
						</Table>
					</div>

					{/* Pagination */}
					{totalPages > 0 && (
						<div className="flex items-center justify-between border-t px-4 py-3">
							<span className="text-muted-foreground text-xs">
								{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
							</span>
							<div className="flex items-center gap-2">
								<Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={!hasPrevPage}>
									<ArrowLeft className="h-4 w-4" />
								</Button>
								<span className="text-muted-foreground min-w-[60px] text-center text-xs">
									{page + 1} / {totalPages}
								</span>
								<Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={!hasNextPage}>
									<ArrowRight className="h-4 w-4" />
								</Button>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Confirm / Cancel Action Dialog */}
			<Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							{actionType === "confirm" ? (
								<>
									<CheckCircle2 className="h-5 w-5 text-green-600" />
									Confirm Order
								</>
							) : (
								<>
									<XCircle className="text-destructive h-5 w-5" />
									Cancel Order
								</>
							)}
						</DialogTitle>
						<DialogDescription>{dialogDescription}</DialogDescription>
					</DialogHeader>

					{targetOrder && (
						<div className="bg-muted/50 space-y-2 rounded-lg p-4 text-sm">
							<div className="flex justify-between">
								<span className="text-muted-foreground">Order No.</span>
								<span className="font-mono font-medium">{targetOrder.order_no}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">Type</span>
								<span className="capitalize">{targetOrder.type}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">Amount</span>
								<span className="font-medium">${targetOrder.amount.toFixed(2)}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">Credits</span>
								<span>{targetOrder.credits.toLocaleString()}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">Payment</span>
								<span className="capitalize">{targetOrder.payment_method}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">Tenant</span>
								<span className="capitalize">
									{targetOrder.tenant_type} · {targetOrder.tenant_id}
								</span>
							</div>
							{targetOrder.package && (
								<div className="flex justify-between">
									<span className="text-muted-foreground">Package</span>
									<span className="flex items-center gap-1">
										<Package className="h-3 w-3" />
										{targetOrder.package.name}
									</span>
								</div>
							)}
						</div>
					)}

					<DialogFooter className="gap-2 sm:gap-0">
						<Button variant="outline" onClick={() => setActionDialogOpen(false)}>
							Abort
						</Button>
						<Button
							variant={actionType === "confirm" ? "default" : "destructive"}
							onClick={handleConfirmAction}
							disabled={isProcessing}
							className={actionType === "confirm" ? "bg-green-600 hover:bg-green-700" : ""}
						>
							{isProcessing ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : actionType === "confirm" ? (
								<CheckCircle2 className="mr-2 h-4 w-4" />
							) : (
								<XCircle className="mr-2 h-4 w-4" />
							)}
							{actionType === "confirm" ? "Confirm Order" : "Cancel Order"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}