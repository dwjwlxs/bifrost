import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { usePlatformGetProfileQuery } from "@/lib/platform/platformApi";
import { getUser } from "@/lib/platform/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, Zap, Star, Rocket, Building2, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

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

export default function RechargePage() {
	const { data: profile } = usePlatformGetProfileQuery();
	const user = profile ?? getUser();
	const balance = user?.balance ?? 0;

	const [selectedPackageId, setSelectedPackageId] = useState<string | null>("popular");
	const [customAmount, setCustomAmount] = useState("");

	const selectedPackage = PACKAGES.find((p) => p.id === selectedPackageId);
	const customAmountNum = parseFloat(customAmount) || 0;

	// Active amount for display: custom if entered, else selected package
	const activeAmount = customAmount && customAmountNum > 0 ? customAmountNum : (selectedPackage?.amount ?? 0);
	const activeBonus =
		customAmount && customAmountNum > 0 ? (customAmountNum >= 100 ? customAmountNum * 0.1 : 0) : (selectedPackage?.bonus ?? 0);

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

			{/* Current Balance Banner */}
			<Card className="border-primary/20 bg-primary/5">
				<CardContent className="flex items-center justify-between py-4">
					<div>
						<p className="text-muted-foreground text-sm">Current Balance</p>
						<p className="text-2xl font-bold">${balance.toFixed(2)}</p>
					</div>
					{activeAmount > 0 && (
						<div className="text-right">
							<p className="text-muted-foreground text-sm">After recharge</p>
							<p className="text-primary text-2xl font-bold">${(balance + activeAmount + activeBonus).toFixed(2)}</p>
						</div>
					)}
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
							<div className="mb-1 text-3xl font-bold">${pkg.amount.toLocaleString()}</div>
							{pkg.bonus > 0 && <p className="mb-2 text-xs font-medium text-green-600">+${pkg.bonus} bonus credits</p>}
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
							<span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm">$</span>
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
							🎉 You&apos;ll receive <strong>${(customAmountNum + customAmountNum * 0.1).toFixed(2)} credits</strong> ($
							{customAmountNum.toFixed(2)} + ${(customAmountNum * 0.1).toFixed(2)} 10% bonus)
						</div>
					)}
				</CardContent>
			</Card>

			{/* Proceed to Payment */}
			<div className="flex items-center gap-4">
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="inline-flex" data-testid="recharge-payment-button-wrapper">
							<Button size="lg" className="min-w-[200px]" disabled data-testid="recharge-payment-button">
								<CreditCard className="mr-2 h-4 w-4" />
								Proceed to Payment
							</Button>
						</span>
					</TooltipTrigger>
					<TooltipContent>Coming soon — payment integration is not yet available.</TooltipContent>
				</Tooltip>
				<Button variant="outline" size="lg" asChild data-testid="recharge-cancel-button">
					<Link to="/platform/console/wallet">Cancel</Link>
				</Button>
			</div>
		</div>
	);
}