import {
	usePlatformGetBalanceQuery,
	usePlatformListUserPackagesQuery,
	usePlatformGetBalanceHistoryQuery,
	usePlatformListPackagesQuery,
} from "@/lib/platform/platformApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, Package, Receipt, CreditCard } from "lucide-react";

export default function WalletPage() {
	const { data: balance, isLoading: balanceLoading } = usePlatformGetBalanceQuery();
	const { data: userPackages, isLoading: packagesLoading } = usePlatformListUserPackagesQuery();
	const { data: historyData, isLoading: historyLoading } = usePlatformGetBalanceHistoryQuery({ limit: 50 });
	const { data: availablePackages } = usePlatformListPackagesQuery({ is_active: true });

	const isLoading = balanceLoading && packagesLoading && historyLoading;

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
			</div>
		);
	}

	return (
		<div className="space-y-8">
			{/* Header */}
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Wallet</h1>
				<p className="text-muted-foreground">View your balance, active packages, and transaction history.</p>
			</div>

			{/* Balance Cards */}
			<div className="grid gap-4 md:grid-cols-3">
				<Card data-testid="wallet-balance-card">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Wallet Balance</CardTitle>
						<Wallet className="text-muted-foreground h-4 w-4" />
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold" data-testid="wallet-balance-amount">
							${(balance?.balance ?? 0).toFixed(2)}
						</div>
						<p className="text-muted-foreground mt-1 text-xs">Available wallet credits</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Package Credits</CardTitle>
						<Package className="text-muted-foreground h-4 w-4" />
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold">{(balance?.package_credits ?? 0).toFixed(2)}</div>
						<p className="text-muted-foreground mt-1 text-xs">Credits from active packages</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Total Credits</CardTitle>
						<CreditCard className="text-muted-foreground h-4 w-4" />
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold">{(balance?.total_credits ?? 0).toFixed(2)}</div>
						<p className="text-muted-foreground mt-1 text-xs">Wallet + Package credits</p>
					</CardContent>
				</Card>
			</div>

			{/* Active Packages */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Package className="h-5 w-5" />
						Active Packages
					</CardTitle>
					<CardDescription>
						{userPackages?.length ?? 0} active package{userPackages?.length !== 1 ? "s" : ""}{" "}
						{availablePackages && `· ${availablePackages.length} packages available`}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{!userPackages || userPackages.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<Package className="text-muted-foreground/40 mb-3 h-8 w-8" />
							<p className="text-muted-foreground text-sm">No active packages</p>
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Package</TableHead>
									<TableHead>Remaining Credits</TableHead>
									<TableHead>Remaining Tokens</TableHead>
									<TableHead>Expires</TableHead>
									<TableHead>Status</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{userPackages.map((pkg) => (
									<TableRow key={pkg.id}>
										<TableCell className="font-medium">{pkg.package_name}</TableCell>
										<TableCell>{pkg.remaining_credits.toFixed(2)}</TableCell>
										<TableCell>{pkg.remaining_tokens.toLocaleString()}</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											{pkg.expires_at ? new Date(pkg.expires_at).toLocaleDateString() : "No expiry"}
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

			{/* Transaction History */}
			<Card data-testid="wallet-transactions-card">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Receipt className="h-5 w-5" />
						Transaction History
					</CardTitle>
					<CardDescription>A record of all your balance changes.</CardDescription>
				</CardHeader>
				<CardContent>
					{!historyData?.list || historyData.list.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 text-center" data-testid="wallet-transactions-empty">
							<Receipt className="text-muted-foreground/40 mb-3 h-8 w-8" />
							<p className="text-muted-foreground text-sm">No transactions yet</p>
							<p className="text-muted-foreground/70 mt-1 max-w-xs text-xs">
								Your transaction history will appear here once you use your credits.
							</p>
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Date</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Amount</TableHead>
									<TableHead>Description</TableHead>
									<TableHead>Status</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{historyData.list.map((item) => (
									<TableRow key={`${item.type}-${item.id}`}>
										<TableCell className="text-muted-foreground text-sm">{new Date(item.created_at).toLocaleDateString()}</TableCell>
										<TableCell>
											<Badge variant="outline">{item.type}</Badge>
										</TableCell>
										<TableCell className={item.amount >= 0 ? "text-green-600" : "text-red-600"}>
											{item.amount >= 0 ? "+" : ""}
											{item.amount.toFixed(2)}
										</TableCell>
										<TableCell className="text-sm">{item.note}</TableCell>
										<TableCell>
											<Badge variant={item.status === "completed" ? "default" : "secondary"}>{item.status}</Badge>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}