import { useState, useEffect } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
	usePlatformListPackagesQuery,
	usePlatformCreatePurchaseMutation,
	usePlatformGetBalanceQuery,
	usePlatformListGatewaysQuery,
	usePlatformListOrgsQuery,
} from "@/lib/platform/platformApi";
import { getUser } from "@/lib/platform/auth";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PaymentGatewayDialog } from "@/components/billing";
import { CheckCircle2, XCircle, Loader2, Package, Clock, Zap, AlertCircle } from "lucide-react";
import { toast } from "sonner";

type PaymentResult = "success" | "canceled" | null;

// Parse optional JSON string field safely
function tryParseJSON<T>(raw: string | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

interface PackageFeatures {
	allowed_models?: string[];
	rate_limit?: { requests_per_minute?: number; requests_per_day?: number };
	off_peak_discount?: number;
	[key: string]: unknown;
}

function PackageCard({
	pkg,
	onPurchase,
	isPurchasing,
}: {
	pkg: ReturnType<typeof usePlatformListPackagesQuery>["data"][number];
	onPurchase: (pkgId: string) => void;
	isPurchasing: boolean;
}) {
	const features = tryParseJSON<PackageFeatures>(pkg.rate_limit_config, {});

	const allowedModels = features.allowed_models;
	const rpm = features.rate_limit?.requests_per_minute;
	const rpd = features.rate_limit?.requests_per_day;
	const offPeakDiscount = features.off_peak_discount;

	const isUnlimitedDuration = pkg.duration === 0;
	const durationLabel = isUnlimitedDuration ? "No expiry" : `${pkg.duration} days`;

	const priceFormatted = `$${pkg.price.toFixed(2)}`;
	const quotaFormatted = pkg.quota >= 1000 ? `${(pkg.quota / 1000).toFixed(0)}K credits` : `${pkg.quota.toLocaleString()} credits`;

	return (
		<Card className="flex flex-col">
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="flex-1">
						<CardTitle className="text-lg">{pkg.name}</CardTitle>
						<CardDescription className="mt-1 line-clamp-2">{pkg.description}</CardDescription>
					</div>
					<div className="ml-4 shrink-0 text-right">
						<div className="text-2xl font-bold">{priceFormatted}</div>
						<p className="text-muted-foreground text-xs">{quotaFormatted}</p>
					</div>
				</div>
			</CardHeader>

			<CardContent className="flex-1 space-y-3">
				{/* Key details */}
				<div className="flex flex-wrap gap-2">
					<Badge variant="outline" className="gap-1 text-xs">
						<Clock className="h-3 w-3" />
						{durationLabel}
					</Badge>
					<Badge variant="outline" className="gap-1 text-xs">
						<Package className="h-3 w-3" />
						{pkg.target_type === "both" ? "User & Org" : pkg.target_type === "customer" ? "Organization" : "User"}
					</Badge>
					{pkg.auto_renew && (
						<Badge variant="secondary" className="gap-1 text-xs">
							<Zap className="h-3 w-3" />
							Auto-Renew
						</Badge>
					)}
				</div>

				<Separator />

				{/* Rate limits */}
				{(rpm || rpd) && (
					<div className="space-y-1">
						<p className="text-muted-foreground text-xs font-medium">Rate Limits</p>
						<div className="flex flex-wrap gap-2">
							{rpm && (
								<Badge variant="secondary" className="text-xs">
									{rpm} req/min
								</Badge>
							)}
							{rpd && (
								<Badge variant="secondary" className="text-xs">
									{rpd} req/day
								</Badge>
							)}
						</div>
					</div>
				)}

				{/* Allowed models */}
				{allowedModels && allowedModels.length > 0 && (
					<div className="space-y-1">
						<p className="text-muted-foreground text-xs font-medium">Allowed Models</p>
						<div className="flex flex-wrap gap-1">
							{allowedModels.slice(0, 5).map((model) => (
								<Badge key={model} variant="outline" className="text-xs">
									{model}
								</Badge>
							))}
							{allowedModels.length > 5 && (
								<Badge variant="outline" className="text-xs">
									+{allowedModels.length - 5} more
								</Badge>
							)}
						</div>
					</div>
				)}

				{/* Off-peak discount */}
				{offPeakDiscount && offPeakDiscount > 0 && (
					<div className="flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
						<Zap className="h-3 w-3 shrink-0" />
						{offPeakDiscount * 100}% off during off-peak hours
					</div>
				)}
			</CardContent>

			<CardFooter>
				<Button className="w-full" onClick={() => onPurchase(pkg.id)} disabled={isPurchasing}>
					{isPurchasing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
					{isPurchasing ? "Processing..." : "Purchase"}
				</Button>
			</CardFooter>
		</Card>
	);
}

export default function PackagesPage() {
	const navigate = useNavigate();
	const search = useSearch({ strict: false }) as Record<string, string>;
	const { data: packages, isLoading, refetch } = usePlatformListPackagesQuery({ is_active: true });
	const { refetch: refetchBalance } = usePlatformGetBalanceQuery();
	const [createPurchase, { isLoading: isPurchasing }] = usePlatformCreatePurchaseMutation();
	const { data: gateways = [] } = usePlatformListGatewaysQuery();
	const { data: orgs = [] } = usePlatformListOrgsQuery();

	const [purchasingPkgId, setPurchasingPkgId] = useState<string | null>(null);
	const [paymentResult, setPaymentResult] = useState<PaymentResult>(null);

	// Gateway selection dialog state
	const [gatewayDialogOpen, setGatewayDialogOpen] = useState(false);
	const [pendingPkg, setPendingPkg] = useState<{ id: string; name: string; price: string } | null>(null);

	// User context
	const user = getUser();

	useEffect(() => {
		if (search.payment === "success") {
			setPaymentResult("success");
			refetchBalance();
			toast.success("Purchase successful! Your package is now active.");
		} else if (search.payment === "canceled") {
			setPaymentResult("canceled");
			toast.info("Payment was canceled. No charges were made.");
		}
		if (search.payment) {
			navigate({ to: "/platform/console/packages", replace: true });
		}
	}, [search.payment, refetchBalance, navigate]);

	// Called when user clicks Purchase button — opens gateway selection dialog
	function openGatewayDialog(pkgId: string) {
		const pkg = packages?.find((p) => p.id === pkgId);
		setPendingPkg(
			pkg
				? { id: pkg.id, name: pkg.name, price: `$${pkg.price.toFixed(2)}` }
				: { id: pkgId, name: "Selected Package", price: "" }
		);
		setGatewayDialogOpen(true);
	}

	async function handleConfirmPurchase({ tenantType, tenantId, gatewayId }: { tenantType: "personal" | "organization"; tenantId: string; gatewayId: string }) {
		if (!pendingPkg) return;

		setPurchasingPkgId(pendingPkg.id);

		try {
			const returnUrl = `${window.location.origin}/platform/console/packages`;
			const result = await createPurchase({
				package_id: pendingPkg.id,
				return_url: returnUrl,
				tenant_type: tenantType,
				tenant_id: tenantId,
				gateway: gatewayId,
			}).unwrap();

			if (result.checkout_url) {
				window.location.href = result.checkout_url;
			} else if (result.status === "success") {
				toast.success("Purchase successful!");
				refetchBalance();
				refetch();
			} else {
				toast.info("Order created. You'll be notified once payment is confirmed.");
			}
		} catch (err: unknown) {
			const message =
				(err as { data?: { message?: string }; message?: string })?.data?.message ||
				(err as { message?: string })?.message ||
				"Failed to create purchase";
			toast.error(message);
		} finally {
			setPurchasingPkgId(null);
			setPendingPkg(null);
		}
	}

	return (
		<div className="space-y-8">
			{/* Header */}
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Package Marketplace</h1>
				<p className="text-muted-foreground">Browse available packages and upgrade your plan.</p>
			</div>

			{/* Payment Result Banners */}
			{paymentResult === "success" && (
				<div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-950/30">
					<CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
					<div>
						<p className="font-medium text-green-700 dark:text-green-300">Purchase Successful</p>
						<p className="text-sm text-green-600 dark:text-green-400">Your package is now active. Check your wallet for details.</p>
					</div>
				</div>
			)}
			{paymentResult === "canceled" && (
				<div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 dark:border-yellow-800 dark:bg-yellow-950/30">
					<XCircle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
					<div>
						<p className="font-medium text-yellow-700 dark:text-yellow-300">Payment Canceled</p>
						<p className="text-sm text-yellow-600 dark:text-yellow-400">No charges were made. You can try again below.</p>
					</div>
				</div>
			)}

			{/* Package Grid */}
			{isLoading ? (
				<div className="flex items-center justify-center py-20">
					<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
				</div>
			) : !packages || packages.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-20 text-center">
					<AlertCircle className="text-muted-foreground/40 mb-3 h-8 w-8" />
					<p className="text-muted-foreground text-sm">No packages available at the moment.</p>
					<p className="text-muted-foreground/70 mt-1 text-xs">Check back soon for new offerings.</p>
				</div>
			) : (
				<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
					{packages.map((pkg) => (
						<PackageCard key={pkg.id} pkg={pkg} onPurchase={openGatewayDialog} isPurchasing={isPurchasing && purchasingPkgId === pkg.id} />
					))}
				</div>
			)}

			{/* Footer hint */}
			<p className="text-muted-foreground text-center text-xs">
				Purchases are processed securely via Stripe. You can manage your packages in the{" "}
				<Link to="/platform/console/wallet" className="hover:text-foreground underline">
					Wallet
				</Link>{" "}
				section.
			</p>

			{/* Gateway Selection Dialog */}
			<PaymentGatewayDialog
				open={gatewayDialogOpen}
				onOpenChange={setGatewayDialogOpen}
				gateways={gateways}
				user={user}
				orgs={orgs}
				onConfirm={handleConfirmPurchase}
				isProcessing={isPurchasing}
				type="package"
				packageId={pendingPkg?.id}
				packageName={pendingPkg?.name}
				packagePrice={pendingPkg?.price}
			/>
		</div>
	);
}