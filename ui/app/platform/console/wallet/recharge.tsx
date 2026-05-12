import { useState, useEffect } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { usePlatformGetProfileQuery, usePlatformCreateRechargeMutation, usePlatformGetBalanceQuery, usePlatformListGatewaysQuery, usePlatformListOrgsQuery } from "@/lib/platform/platformApi";
import { getUser } from "@/lib/platform/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PaymentGatewayDialog } from "@/components/billing";
import { ArrowLeft, Zap, Star, Rocket, Building2, CheckCircle2, XCircle, Loader2, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─── Currency options ──────────────────────────────────────────
const CURRENCIES = [
	{ value: "usd", label: "USD ($)", symbol: "$" },
	{ value: "eur", label: "EUR (€)", symbol: "€" },
	{ value: "gbp", label: "GBP (£)", symbol: "£" },
	{ value: "jpy", label: "JPY (¥)", symbol: "¥" },
	{ value: "cny", label: "CNY (¥)", symbol: "¥" },
] as const;

type CurrencyCode = (typeof CURRENCIES)[number]["value"];

function getCurrencySymbol(code: CurrencyCode): string {
	return CURRENCIES.find((c) => c.value === code)?.symbol ?? "$";
}

// ─── Preset packages ───────────────────────────────────────────
interface RechargePackage {
	id: string;
	label: string;
	amount: number;
	bonus: number;
	description: string;
	icon: React.ReactNode;
	highlighted?: boolean;
}

const PACKAGES: RechargePackage[] = [
	{
		id: "starter",
		label: "Starter",
		amount: 10,
		bonus: 0,
		description: "Perfect for getting started with the platform.",
		icon: <Zap className="h-5 w-5" />,
	},
	{
		id: "popular",
		label: "Popular",
		amount: 50,
		bonus: 0,
		description: "Our most popular option for regular users.",
		icon: <Star className="h-5 w-5" />,
		highlighted: true,
	},
	{
		id: "pro",
		label: "Pro",
		amount: 100,
		bonus: 10,
		description: "Great for power users. Includes 10% bonus credits.",
		icon: <Rocket className="h-5 w-5" />,
	},
	{
		id: "enterprise",
		label: "Enterprise",
		amount: 500,
		bonus: 50,
		description: "Maximum value for teams and enterprises.",
		icon: <Building2 className="h-5 w-5" />,
	},
];

// ─── Payment result states ─────────────────────────────────────
type PaymentResult = "success" | "canceled" | null;

export default function RechargePage() {
	const navigate = useNavigate();
	const search = useSearch({ strict: false }) as Record<string, string>;
	const { data: profile, refetch: refetchProfile } = usePlatformGetProfileQuery();
	const { data: balance, refetch: refetchBalance } = usePlatformGetBalanceQuery();
	const [createRecharge, { isLoading: isCreating }] = usePlatformCreateRechargeMutation();
	const { data: gateways = [] } = usePlatformListGatewaysQuery();
	const { data: orgs = [] } = usePlatformListOrgsQuery();

	const user = profile ?? getUser();
	const currentBalance = balance?.balance ?? user?.balance ?? 0;

	// Form state
	const [selectedPackageId, setSelectedPackageId] = useState<string | null>("popular");
	const [customAmount, setCustomAmount] = useState("");
	const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>("usd");

	// Payment result from URL params (Stripe redirect back)
	const [paymentResult, setPaymentResult] = useState<PaymentResult>(null);

	// Gateway selection dialog state
	const [gatewayDialogOpen, setGatewayDialogOpen] = useState(false);

	useEffect(() => {
		// Check URL params for payment result after Stripe redirect
		if (search.payment === "success") {
			setPaymentResult("success");
			refetchBalance();
			refetchProfile();
			toast.success("Payment successful! Your balance has been updated.");
		} else if (search.payment === "canceled") {
			setPaymentResult("canceled");
			toast.info("Payment was canceled.");
		}
		// Clear the params so refresh doesn't re-trigger
		if (search.payment) {
			navigate({ to: "/platform/console/wallet/recharge", replace: true });
		}
	}, [search.payment, refetchBalance, refetchProfile, navigate]);

	const selectedPackage = PACKAGES.find((p) => p.id === selectedPackageId);
	const customAmountNum = parseFloat(customAmount) || 0;

	// Active amount: custom overrides preset
	const activeAmount = customAmount && customAmountNum > 0 ? customAmountNum : (selectedPackage?.amount ?? 0);
	const activeBonus =
		customAmount && customAmountNum > 0 ? (customAmountNum >= 100 ? customAmountNum * 0.1 : 0) : (selectedPackage?.bonus ?? 0);

	const currencySymbol = getCurrencySymbol(selectedCurrency);

	const canProceed = activeAmount > 0 && !isCreating;

	async function handleProceedToPayment() {
		if (!canProceed) return;

		// Open gateway selection dialog
		setGatewayDialogOpen(true);
	}

	async function handleConfirmPayment({ tenantType, tenantId, gatewayId }: { tenantType: "personal" | "organization"; tenantId: string; gatewayId: string }) {
		setGatewayDialogOpen(false);

		try {
			const returnUrl = `${window.location.origin}/platform/console/wallet/recharge`;
			const result = await createRecharge({
				amount: activeAmount,
				preferred_currency: selectedCurrency,
				return_url: returnUrl,
				tenant_type: tenantType,
				tenant_id: tenantId,
				gateway: gatewayId,
			}).unwrap();

			if (result.checkout_url) {
				// Gateway Checkout — redirect
				const separator = result.checkout_url.includes("?") ? "&" : "?";
				window.location.href = `${result.checkout_url}${separator}return_url=${encodeURIComponent(returnUrl)}`;
			} else if (result.status === "success") {
				// Manual Gateway — instant success
				toast.success("Recharge successful! Credits have been added to your balance.");
				refetchBalance();
				refetchProfile();
				navigate({ to: "/platform/console/wallet" });
			} else {
				// Order created but payment pending
				toast.info("Order created. You'll be notified once payment is confirmed.");
				navigate({ to: "/platform/console/wallet" });
			}
		} catch (err: any) {
			const message = err?.data?.message || err?.message || "Failed to create recharge order";
			toast.error(message);
		}
	}

	return (
		<div className="space-y-8">
			{/* Header */}
			<div className="flex items-center gap-4">
				<Button variant="ghost" size="sm" asChild className="h-8 w-8 p-0" data-testid="recharge-back-button">
					<Link to="/platform/console/wallet">
						<ArrowLeft className="h-4 w-4" />
					</Link>
				</Button>
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Recharge Balance</h1>
					<p className="text-muted-foreground">Choose a package or enter a custom amount.</p>
				</div>
			</div>

			{/* Payment Result Banner */}
			{paymentResult === "success" && (
				<Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
					<CardContent className="flex items-center gap-3 py-4">
						<CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
						<div>
							<p className="font-medium text-green-700 dark:text-green-300">Payment Successful</p>
							<p className="text-sm text-green-600 dark:text-green-400">Your balance has been updated.</p>
						</div>
					</CardContent>
				</Card>
			)}
			{paymentResult === "canceled" && (
				<Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30">
					<CardContent className="flex items-center gap-3 py-4">
						<XCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
						<div>
							<p className="font-medium text-yellow-700 dark:text-yellow-300">Payment Canceled</p>
							<p className="text-sm text-yellow-600 dark:text-yellow-400">Your payment was not completed. You can try again.</p>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Current Balance Banner */}
			<Card className="border-primary/20 bg-primary/5">
				<CardContent className="flex items-center justify-between py-4">
					<div>
						<p className="text-muted-foreground text-sm">Current Balance</p>
						<p className="text-2xl font-bold">
							{currencySymbol}
							{currentBalance.toFixed(2)}
						</p>
					</div>
					{activeAmount > 0 && (
						<div className="text-right">
							<p className="text-muted-foreground text-sm">After recharge</p>
							<p className="text-primary text-2xl font-bold">
								{currencySymbol}
								{(currentBalance + activeAmount + activeBonus).toFixed(2)}
							</p>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Currency Selector */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Currency</CardTitle>
					<CardDescription>Select your preferred currency for payment.</CardDescription>
				</CardHeader>
				<CardContent>
					<Select value={selectedCurrency} onValueChange={(v) => setSelectedCurrency(v as CurrencyCode)}>
						<SelectTrigger className="w-[200px]">
							<SelectValue placeholder="Select currency" />
						</SelectTrigger>
						<SelectContent>
							{CURRENCIES.map((c) => (
								<SelectItem key={c.value} value={c.value}>
									{c.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</CardContent>
			</Card>

			{/* Package Cards Grid */}
			<div>
				<p className="mb-3 text-sm font-medium">Select a Package</p>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="recharge-packages-grid">
					{PACKAGES.map((pkg) => (
						<button
							key={pkg.id}
							type="button"
							data-testid={`recharge-package-${pkg.id}`}
							onClick={() => {
								setSelectedPackageId(pkg.id);
								setCustomAmount("");
							}}
							className={cn(
								"relative text-left rounded-xl border-2 p-5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
								selectedPackageId === pkg.id && !customAmount
									? "border-primary bg-primary/5 shadow-sm"
									: "border-border bg-card hover:border-primary/40 hover:bg-accent/30",
								pkg.highlighted && "ring-1 ring-primary/30",
							)}
						>
							{pkg.highlighted && (
								<Badge
									className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap"
									data-testid="recharge-package-popular-badge"
								>
									Most Popular
								</Badge>
							)}
							<div className="mb-3 flex items-center gap-2">
								<span
									className={cn(
										"rounded-lg p-1.5",
										selectedPackageId === pkg.id && !customAmount ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
									)}
								>
									{pkg.icon}
								</span>
								<span className="text-sm font-semibold">{pkg.label}</span>
							</div>
							<div className="mb-1 text-3xl font-bold">
								{currencySymbol}
								{pkg.amount.toLocaleString()}
							</div>
							{pkg.bonus > 0 && (
								<p className="mb-2 text-xs font-medium text-green-600">
									+{currencySymbol}
									{pkg.bonus} bonus credits
								</p>
							)}
							<p className="text-muted-foreground text-xs leading-relaxed">{pkg.description}</p>
						</button>
					))}
				</div>
			</div>

			{/* Custom Amount */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Custom Amount</CardTitle>
					<CardDescription>Enter any amount you'd like to add. Amounts ≥ $100 receive a 10% bonus.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="flex gap-3">
						<div className="relative flex-1">
							<span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm">{currencySymbol}</span>
							<Input
								type="number"
								min="1"
								step="0.01"
								placeholder="0.00"
								value={customAmount}
								onChange={(e) => {
									setCustomAmount(e.target.value);
									if (e.target.value) setSelectedPackageId(null);
								}}
								className="pl-7"
								data-testid="recharge-custom-amount-input"
							/>
						</div>
					</div>
					{customAmountNum >= 100 && customAmount && (
						<div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
							You'll receive{" "}
							<strong>
								{currencySymbol}
								{(customAmountNum + customAmountNum * 0.1).toFixed(2)} credits
							</strong>{" "}
							({currencySymbol}
							{customAmountNum.toFixed(2)} + {currencySymbol}
							{(customAmountNum * 0.1).toFixed(2)} 10% bonus)
						</div>
					)}
				</CardContent>
			</Card>

			{/* Proceed to Payment */}
			<div className="flex items-center gap-4">
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="inline-flex" data-testid="recharge-payment-button-wrapper">
								<Button
									size="lg"
									className="min-w-[200px]"
									disabled={!canProceed}
									onClick={handleProceedToPayment}
									data-testid="recharge-payment-button"
								>
									{isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
									{isCreating ? "Processing..." : "Proceed to Payment"}
								</Button>
							</span>
						</TooltipTrigger>
						{!canProceed && activeAmount <= 0 && <TooltipContent>Select an amount to continue</TooltipContent>}
					</Tooltip>
				</TooltipProvider>
			<Button variant="outline" size="lg" asChild data-testid="recharge-cancel-button">
				<Link to="/platform/console/wallet">Cancel</Link>
			</Button>
		</div>

		{/* Gateway Selection Dialog */}
		<PaymentGatewayDialog
			open={gatewayDialogOpen}
			onOpenChange={setGatewayDialogOpen}
			gateways={gateways}
			user={user}
			orgs={orgs}
			onConfirm={handleConfirmPayment}
			isProcessing={isCreating}
			type="recharge"
			rechargeAmount={activeAmount}
		/>
	</div>
	);
}