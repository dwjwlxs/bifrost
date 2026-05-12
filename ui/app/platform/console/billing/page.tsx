import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
	usePlatformGetBalanceQuery,
	usePlatformListUserPackagesQuery,
	usePlatformListOrdersQuery,
	usePlatformRetryPayMutation,
	usePlatformListGatewaysQuery,
	usePlatformCreateRechargeMutation,
	usePlatformGetProfileQuery,
	usePlatformListOrgsQuery,
} from "@/lib/platform/platformApi";
import { getUser } from "@/lib/platform/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PaymentGatewayDialog } from "@/components/billing";
import {
	Wallet,
	Package,
	Receipt,
	CreditCard,
	ArrowRight,
	AlertCircle,
	ArrowLeft,
	ArrowRight as ArrowRightIcon,
	User,
	Building2,
	Loader2,
} from "lucide-react";
import { format } from "date-fns";

const PAGE_SIZE = 5;

const ORDER_TYPE_OPTIONS = [
	{ value: "all", label: "All Types" },
	{ value: "recharge", label: "Recharge" },
	{ value: "package_purchase", label: "Package Purchase" },
];

const STATUS_OPTIONS = [
	{ value: "all", label: "All Statuses" },
	{ value: "pending", label: "Pending" },
	{ value: "success", label: "Success" },
	{ value: "failed", label: "Failed" },
	{ value: "expired", label: "Expired" },
	{ value: "canceled", label: "Canceled" },
];

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline" | "success"> = {
	pending: "outline",
	success: "success",
	failed: "destructive",
	expired: "secondary",
	canceled: "secondary",
};

function formatDate(dateStr: string | undefined): string {
	if (!dateStr) return "—";
	try {
		return format(new Date(dateStr), "MMM d, yyyy");
	} catch {
		return dateStr;
	}
}

function formatDateTime(dateStr: string | undefined): string {
	if (!dateStr) return "—";
	try {
		return format(new Date(dateStr), "MMM d, yyyy HH:mm");
	} catch {
		return dateStr;
	}
}

// ── Balance Cards ──────────────────────────────────────────────────────────

function BalanceCard({
	label,
	value,
	sub,
	icon: Icon,
	action,
}: {
	label: string;
	value: string;
	sub: string;
	icon: React.ComponentType<{ className?: string }>;
	action?: React.ReactNode;
}) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="text-sm font-medium">{label}</CardTitle>
				<Icon className="text-muted-foreground h-4 w-4" />
			</CardHeader>
			<CardContent className="flex flex-col gap-1">
				<div className="text-3xl font-bold">{value}</div>
				<p className="text-muted-foreground text-xs">{sub}</p>
				{action && <div className="mt-2">{action}</div>}
			</CardContent>
		</Card>
	);
}

function BalanceCardSkeleton() {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<Skeleton className="h-4 w-28" />
				<Skeleton className="h-4 w-4" />
			</CardHeader>
			<CardContent>
				<Skeleton className="mb-1 h-8 w-24" />
				<Skeleton className="h-3 w-36" />
			</CardContent>
		</Card>
	);
}

// ── Packages Table ─────────────────────────────────────────────────────────

function PackagesCard({
	packages,
	isLoading,
	isError,
	onRetry,
}: {
	packages: { id: number; package_name: string; remaining_credits: number; expires_at: string; status: string }[];
	isLoading: boolean;
	isError: boolean;
	onRetry: () => void;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Package className="h-5 w-5" />
					Active Packages
				</CardTitle>
				<CardDescription>
					{isLoading ? "Loading..." : `${packages.length} active package${packages.length !== 1 ? "s" : ""}`}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isError ? (
					<div className="text-destructive flex items-center gap-2 text-sm">
						<AlertCircle className="h-4 w-4" />
						<span>Failed to load packages.</span>
						<Button size="sm" variant="ghost" onClick={onRetry} className="h-auto p-0 text-xs">
							Retry
						</Button>
					</div>
				) : packages.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8 text-center">
						<Package className="text-muted-foreground/40 mb-3 h-8 w-8" />
						<p className="text-muted-foreground text-sm">No active packages</p>
						<p className="text-muted-foreground/70 mt-1 max-w-xs text-xs">Purchase a package to get started.</p>
						<Button asChild size="sm" variant="outline" className="mt-4">
							<Link to="/platform/console/packages">Browse Packages</Link>
						</Button>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Package</TableHead>
								<TableHead>Remaining Credits</TableHead>
								<TableHead>Expires</TableHead>
								<TableHead>Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{packages.map((pkg) => (
								<TableRow key={pkg.id}>
									<TableCell className="font-medium">{pkg.package_name}</TableCell>
									<TableCell>{pkg.remaining_credits.toFixed(2)}</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{pkg.expires_at ? formatDate(pkg.expires_at) : "No expiry"}
									</TableCell>
									<TableCell>
										<Badge variant={pkg.status === "active" ? "default" : "secondary"}>{pkg.status}</Badge>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}

// ── Orders Table ───────────────────────────────────────────────────────────

function OrdersCard({
	orders,
	total,
	page,
	pageSize,
	isLoading,
	isError,
	onRetry,
	onPageChange,
	statusFilter,
	onStatusFilterChange,
	typeFilter,
	onTypeFilterChange,
	onRetryPay,
}: {
	orders: {
		id: number;
		order_no: string;
		type: string;
		amount: number;
		credits: number;
		status: string;
		gateway?: string;
		payment_method?: string;
		checkout_url?: string;
		created_at: string;
		tenant_type: string;
		tenant_id: string;
	}[];
	total: number;
	page: number;
	pageSize: number;
	isLoading: boolean;
	isError: boolean;
	onRetry: () => void;
	onPageChange: (page: number) => void;
	statusFilter: string;
	onStatusFilterChange: (status: string) => void;
	typeFilter: string;
	onTypeFilterChange: (type: string) => void;
	onRetryPay: (orderId: number) => void;
}) {
	const totalPages = Math.ceil(total / pageSize);
	const hasNextPage = (page + 1) * pageSize < total;
	const hasPrevPage = page > 0;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Receipt className="h-5 w-5" />
					Recent Orders
				</CardTitle>
				<CardDescription>
					{isLoading ? "Loading..." : isError ? "Failed to load orders." : `${total.toLocaleString()} ${total === 1 ? "order" : "orders"}`}
				</CardDescription>
			</CardHeader>
			<CardContent className="p-0">
				{/* Filter Bar */}
				<div className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3">
					<div className="flex flex-wrap items-center gap-3">
						{/* Type Filter */}
						<div className="flex items-center gap-2">
							<span className="text-muted-foreground flex items-center gap-1 text-sm">Type:</span>
							<Select
								value={typeFilter}
								onValueChange={(v) => {
									onTypeFilterChange(v);
									onPageChange(0);
								}}
							>
								<SelectTrigger className="h-8 w-44">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{ORDER_TYPE_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{/* Status Filter */}
						<div className="flex items-center gap-2">
							<span className="text-muted-foreground flex items-center gap-1 text-sm">Status:</span>
							<Select
								value={statusFilter}
								onValueChange={(v) => {
									onStatusFilterChange(v);
									onPageChange(0);
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
					</div>
				</div>

				{/* Table */}
				<div className="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Order No</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Amount</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Tenant</TableHead>
								<TableHead>Date</TableHead>
								<TableHead className="text-right">Action</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isError ? (
								<TableRow>
									<TableCell colSpan={7} className="text-center">
										<div className="text-destructive flex items-center justify-center gap-2 py-4 text-sm">
											<AlertCircle className="h-4 w-4" />
											<span>Failed to load orders.</span>
											<Button size="sm" variant="ghost" onClick={onRetry} className="h-auto p-0 text-xs">
												Retry
											</Button>
										</div>
									</TableCell>
								</TableRow>
							) : orders.length === 0 ? (
								<TableRow>
									<TableCell colSpan={7}>
										<div className="flex flex-col items-center justify-center py-8 text-center">
											<Receipt className="text-muted-foreground/40 mb-3 h-8 w-8" />
											<p className="text-muted-foreground text-sm">No orders yet</p>
											<p className="text-muted-foreground/70 mt-1 max-w-xs text-xs">Your order history will appear here.</p>
										</div>
									</TableCell>
								</TableRow>
							) : (
								orders.map((order) => {
									const canRetry = order.status === "pending" && order.gateway !== "manual";
									return (
										<TableRow key={order.id}>
											<TableCell className="text-muted-foreground max-w-[140px] truncate font-mono text-xs" title={order.order_no}>
												{order.order_no}
											</TableCell>
											<TableCell>
												<Badge variant="outline">
													{order.type === "recharge" ? "Recharge" : order.type === "package_purchase" ? "Package" : order.type}
												</Badge>
											</TableCell>
											<TableCell>
												<div className="flex flex-col gap-0.5">
													<span className="font-medium">${order.amount.toFixed(2)}</span>
													<span className="text-muted-foreground text-xs">{order.credits.toLocaleString()} credits</span>
												</div>
											</TableCell>
											<TableCell>
												<Badge variant={STATUS_COLORS[order.status] ?? "secondary"}>{order.status}</Badge>
											</TableCell>
											<TableCell>
												<div className="text-muted-foreground flex items-center gap-1 text-xs">
													{order.tenant_type === "organization" ? (
														<Building2 className="h-3 w-3 shrink-0" />
													) : (
														<User className="h-3 w-3 shrink-0" />
													)}
													<span className="capitalize">{order.tenant_type}</span>
												</div>
											</TableCell>
											<TableCell className="text-muted-foreground text-sm">{formatDateTime(order.created_at)}</TableCell>
											<TableCell className="text-right">
												{canRetry && (
													<Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onRetryPay(order.id)}>
														Pay Now
													</Button>
												)}
											</TableCell>
										</TableRow>
									);
								})
							)}
						</TableBody>
					</Table>
				</div>

				{/* Pagination */}
				{totalPages > 0 && (
					<div className="flex items-center justify-between border-t px-4 py-3">
						<span className="text-muted-foreground text-xs">
							{page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total.toLocaleString()}
						</span>
						<div className="flex items-center gap-2">
							<Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={!hasPrevPage}>
								<ArrowLeft className="h-4 w-4" />
							</Button>
							<span className="text-muted-foreground min-w-[60px] text-center text-xs">
								{page + 1} / {totalPages}
							</span>
							<Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={!hasNextPage}>
								<ArrowRightIcon className="h-4 w-4" />
							</Button>
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function BillingPage() {
	const [ordersPage, setOrdersPage] = useState(0);
	const [ordersStatusFilter, setOrdersStatusFilter] = useState("all");
	const [ordersTypeFilter, setOrdersTypeFilter] = useState("all");

	// Retry pay dialog state
	const [retryPayDialogOpen, setRetryPayDialogOpen] = useState(false);
	const [targetOrderId, setTargetOrderId] = useState<number | null>(null);

	// Recharge dialog state
	const [rechargeDialogOpen, setRechargeDialogOpen] = useState(false);
	const [createRecharge, { isLoading: isRecharging }] = usePlatformCreateRechargeMutation();
	const { data: profile } = usePlatformGetProfileQuery();

	const { data: balance, isLoading: balanceLoading, isError: balanceError } = usePlatformGetBalanceQuery();

	const {
		data: userPackages = [],
		isLoading: packagesLoading,
		isError: packagesError,
		refetch: refetchPackages,
	} = usePlatformListUserPackagesQuery();

	const statusParam = ordersStatusFilter === "all" ? undefined : ordersStatusFilter;
	const typeParam = ordersTypeFilter === "all" ? undefined : ordersTypeFilter;
	const {
		data: ordersData,
		isLoading: ordersLoading,
		isError: ordersError,
		refetch: refetchOrders,
	} = usePlatformListOrdersQuery({
		status: statusParam,
		type: typeParam,
		offset: ordersPage * PAGE_SIZE,
		limit: PAGE_SIZE,
	});

	const [retryPay, { isLoading: isRetrying }] = usePlatformRetryPayMutation();
	const { data: gateways = [] } = usePlatformListGatewaysQuery();
	const { data: orgs = [] } = usePlatformListOrgsQuery();

	const activePackages = userPackages.filter((p) => p.status === "active");

	function openRetryPay(orderId: number) {
		setTargetOrderId(orderId);
		setRetryPayDialogOpen(true);
	}

	function handleOpenRecharge() {
		setRechargeDialogOpen(true);
	}

	async function handleConfirmRecharge({
		tenantType,
		tenantId,
		gatewayId,
		amount,
	}: {
		tenantType: "personal" | "organization";
		tenantId: string;
		gatewayId: string;
		amount?: number;
	}) {
		if (!amount || amount <= 0) {
			toast.error("Please enter a valid amount");
			return;
		}

		setRechargeDialogOpen(false);

		try {
			const returnUrl = `${window.location.origin}/platform/console/billing`;
			const result = await createRecharge({
				amount,
				return_url: returnUrl,
				tenant_type: tenantType,
				tenant_id: tenantId,
				gateway: gatewayId,
			}).unwrap();

			if (result.checkout_url) {
				window.location.href = result.checkout_url;
			} else if (result.status === "success") {
				toast.success("Recharge successful! Credits have been added to your balance.");
				refetchOrders();
			} else {
				toast.info("Order created. You'll be notified once payment is confirmed.");
			}
		} catch (err: any) {
			const message = err?.data?.message || err?.message || "Failed to create recharge order";
			toast.error(message);
		}
	}

	async function handleRetryPay() {
		if (targetOrderId === null) return;
		try {
			const result = await retryPay(targetOrderId).unwrap();
			setRetryPayDialogOpen(false);
			setTargetOrderId(null);
			if (result.data?.checkout_url) {
				window.open(result.data.checkout_url, "_blank", "noopener,noreferrer");
			} else {
				toast.success("Payment page ready");
				refetchOrders();
			}
		} catch (err: unknown) {
			const msg =
				(err as { data?: { message?: string }; message?: string })?.data?.message ||
				(err as { message?: string })?.message ||
				"Failed to open payment page";
			toast.error(msg);
		}
	}

	return (
		<div className="space-y-8">
			{/* Header */}
			<div>
				<h1 className="text-2xl font-bold tracking-tight">My Billing</h1>
				<p className="text-muted-foreground">Your billing overview</p>
			</div>

			{/* Balance Cards */}
			<div className="grid gap-4 md:grid-cols-3">
				{balanceLoading ? (
					<>
						<BalanceCardSkeleton />
						<BalanceCardSkeleton />
						<BalanceCardSkeleton />
					</>
				) : balanceError ? (
					<>
						<BalanceCard label="Wallet Balance" value="—" sub="Failed to load" icon={Wallet} />
						<BalanceCard label="Package Credits" value="—" sub="Failed to load" icon={Package} />
						<BalanceCard label="Total Credits" value="—" sub="Failed to load" icon={CreditCard} />
					</>
				) : (
					<>
						<BalanceCard
							label="Wallet Balance"
							value={`$${(balance?.balance ?? 0).toFixed(2)}`}
							sub="Available wallet credits"
							icon={Wallet}
							action={
							<Button size="sm" variant="outline" className="w-full" onClick={handleOpenRecharge}>
								Top up
							</Button>
							}
						/>
						<BalanceCard
							label="Package Credits"
							value={`${(balance?.package_credits ?? 0).toLocaleString()} credits`}
							sub={`${activePackages.length} active package${activePackages.length !== 1 ? "s" : ""}`}
							icon={Package}
						/>
						<BalanceCard
							label="Total Credits"
							value={`${(balance?.total_credits ?? 0).toLocaleString()} credits`}
							sub="Wallet + Package credits"
							icon={CreditCard}
						/>
					</>
				)}
			</div>

			{/* Active Packages */}
			<PackagesCard packages={activePackages} isLoading={packagesLoading} isError={packagesError} onRetry={refetchPackages} />

			{/* Recent Orders */}
			<OrdersCard
				orders={ordersData?.items ?? []}
				total={ordersData?.total ?? 0}
				page={ordersPage}
				pageSize={PAGE_SIZE}
				isLoading={ordersLoading}
				isError={ordersError}
				onRetry={refetchOrders}
				onPageChange={setOrdersPage}
				statusFilter={ordersStatusFilter}
				onStatusFilterChange={setOrdersStatusFilter}
				typeFilter={ordersTypeFilter}
				onTypeFilterChange={setOrdersTypeFilter}
				onRetryPay={openRetryPay}
			/>

			{/* Retry Pay Dialog */}
			<Dialog open={retryPayDialogOpen} onOpenChange={setRetryPayDialogOpen}>
				<DialogContent disableOutsideClick={false}>
					<DialogHeader>
						<DialogTitle>Retry Payment</DialogTitle>
						<DialogDescription>Click below to open the secure payment page for this order.</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setRetryPayDialogOpen(false)} disabled={isRetrying}>
							Cancel
						</Button>
						<Button onClick={handleRetryPay} disabled={isRetrying}>
							{isRetrying ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" />
									Opening...
								</>
							) : (
								<>
									<ArrowRight className="h-4 w-4" />
									Pay Now
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Recharge Dialog */}
			<PaymentGatewayDialog
				open={rechargeDialogOpen}
				onOpenChange={setRechargeDialogOpen}
				gateways={gateways}
				user={profile ?? getUser()}
				orgs={orgs}
				onConfirm={handleConfirmRecharge}
				isProcessing={isRecharging}
				type="recharge"
			/>
		</div>
	);
}