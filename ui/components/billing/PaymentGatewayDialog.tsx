import { useState } from "react";
import { OrgRoleOwner, type PlatformOrg } from "@/lib/platform/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
// ── Gateway SVGs (Simple Icons — official brand SVGs) ─────────────────────────
// Source: https://simpleicons.org — open-source, uses official brand colors/shapes.

const GATEWAY_SVGS: Record<string, { svg: string; color: string; bg: string }> = {
	stripe: {
		svg: `<svg fill="#635BFF" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Stripe</title><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"/></svg>`,
		color: "#635BFF",
		bg: "bg-[#635BFF]/10",
	},
	alipay: {
		svg: `<svg fill="#1677FF" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Alipay</title><path d="M19.695 15.07c3.426 1.158 4.203 1.22 4.203 1.22V3.846c0-2.124-1.705-3.845-3.81-3.845H3.914C1.808.001.102 1.722.102 3.846v16.31c0 2.123 1.706 3.845 3.813 3.845h16.173c2.105 0 3.81-1.722 3.81-3.845v-.157s-6.19-2.602-9.315-4.119c-2.096 2.602-4.8 4.181-7.607 4.181-4.75 0-6.361-4.19-4.112-6.949.49-.602 1.324-1.175 2.617-1.497 2.025-.502 5.247.313 8.266 1.317a16.796 16.796 0 0 0 1.341-3.302H5.781v-.952h4.799V6.975H4.77v-.953h5.81V3.591s0-.409.411-.409h2.347v2.84h5.744v.951h-5.744v1.704h4.69a19.453 19.453 0 0 1-1.986 5.06c1.424.52 2.702 1.011 3.654 1.333m-13.81-2.032c-.596.06-1.71.325-2.321.869-1.83 1.608-.735 4.55 2.968 4.55 2.151 0 4.301-1.388 5.99-3.61-2.403-1.182-4.438-2.028-6.637-1.809"/></svg>`,
		color: "#1677FF",
		bg: "bg-[#1677FF]/10",
	},
	wechatpay: {
		svg: `<svg fill="#07C160" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>WeChat</title><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/></svg>`,
		color: "#07C160",
		bg: "bg-[#07C160]/10",
	},
	manual: {
		// Generic bank/building icon — no official brand; use a clean inline SVG
		svg: `<svg fill="#6B7280" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Manual</title><path d="M4 10h16v2H4v-2zm0-4h16v2H4V6zm0 8h16v2H4v-2zm17-5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm0 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>`,
		color: "#6B7280",
		bg: "bg-[#6B7280]/10",
	},
};

function getGatewaySvg(gateway: string) {
	return GATEWAY_SVGS[gateway.toLowerCase()] ?? null;
}

// Convert SVG string to React element with controlled size
function SvgIcon({ svg, size = 36 }: { svg: string; size?: number }) {
	return (
		<div
			className="shrink-0"
			style={{ width: size, height: size }}
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
}

// ── Gateway types ─────────────────────────────────────────────────────────────

interface Gateway {
	gateway: string;
	name: string;
	methods: { type: string; name: string }[];
}

interface User {
	id?: string;
	orgs?: Array<{ id: string; role?: string }>;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface PaymentGatewayDialogProps {
	/** Dialog open state */
	open: boolean;
	/** Dialog open state setter */
	onOpenChange: (open: boolean) => void;
	/** Available payment gateways from API */
	gateways: Gateway[];
	/** Current user context (provides org roles for filtering) */
	user: User | null;
	/** Full org info from /api/platform/orgs (optional — provides display names) */
	orgs?: PlatformOrg[];
	/** Called when user confirms the dialog — parent decides the API call based on type */
	onConfirm: (params: {
		tenantType: "personal" | "organization";
		tenantId: string;
		gatewayId: string;
		amount?: number;
		packageId?: string;
	}) => void;
	/** Show spinner on confirm button */
	isProcessing?: boolean;

	// ── Flow-specific context ──────────────────────────────────────────────────

	/** "recharge" or "package" */
	type: "recharge" | "package";
	/** Pre-filled amount for recharge (set by parent) */
	rechargeAmount?: number;
	/** Selected package id for package flow */
	packageId?: string;
	/** Selected package name for display */
	packageName?: string;
	/** Selected package price for display */
	packagePrice?: string;
}
// ── Main component ────────────────────────────────────────────────────────────

export function PaymentGatewayDialog({
	open,
	onOpenChange,
	gateways,
	user,
	orgs,
	onConfirm,
	isProcessing = false,
	type,
	rechargeAmount,
	packageId,
	packageName,
	packagePrice,
}: PaymentGatewayDialogProps) {
	const [tenantType, setTenantType] = useState<"personal" | "organization">("personal");
	const [selectedOrgId, setSelectedOrgId] = useState<string>("");
	const [selectedGatewayId, setSelectedGatewayId] = useState<string>(gateways[0]?.gateway ?? "");
	const [localAmount, setLocalAmount] = useState<string>(rechargeAmount?.toString() ?? "");

	// Reset state when dialog opens
	function handleOpenChange(o: boolean) {
		if (o) {
			setSelectedGatewayId(gateways[0]?.gateway ?? "");
			setTenantType("personal");
			setSelectedOrgId("");
			setLocalAmount(rechargeAmount?.toString() ?? "");
		}
		onOpenChange(o);
	}

	// Build org options: filter user.orgs for owner/admin roles, then enrich with API name
	const eligibleOrgIds = new Set(
		user?.orgs?.filter((o) => o.role === OrgRoleOwner || o.role === "admin").map((o) => o.id) ?? []
	);

	// If orgs API data is available, use it for display names; otherwise fall back to user.orgs
	const orgOptions: { id: string; name?: string }[] =
		orgs && orgs.length > 0
			? orgs
					.filter((o) => eligibleOrgIds.has(o.id))
					.map((o) => ({ id: o.id, name: o.name }))
			: user?.orgs?.filter((o) => o.role === OrgRoleOwner || o.role === "admin").map((o) => ({ id: o.id })) ?? [];

	const hasOrg = orgOptions.length > 0;

	const tenantId =
		tenantType === "organization" && selectedOrgId ? selectedOrgId : user?.id ?? "";

	const canConfirm =
		selectedGatewayId &&
		gateways.length > 0 &&
		(tenantType === "personal" || (tenantType === "organization" && selectedOrgId)) &&
		(type !== "recharge" || (parseFloat(localAmount) > 0));

	function handleConfirm() {
		if (!canConfirm) return;
		onConfirm({
			tenantType,
			tenantId,
			gatewayId: selectedGatewayId,
			...(type === "recharge" && { amount: parseFloat(localAmount) }),
			...(type === "package" && { packageId }),
		});
	}

	const typeLabel = type === "recharge" ? "Recharge" : "Package Purchase";

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent disableOutsideClick={false} className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="text-lg">Select Payment Method</DialogTitle>
					<DialogDescription>
						{type === "recharge"
							? "Choose how you would like to add credits to your balance."
							: `Purchase ${packageName ?? "this package"} — ${packagePrice ?? ""}`}
					</DialogDescription>
				</DialogHeader>

				{gateways.length === 0 ? (
					<div className="text-muted-foreground py-6 text-center text-sm">
						No payment gateways are currently available. Please contact support.
					</div>
				) : (
					<div className="space-y-6">
						{/* ── Gateway cards ─────────────────────────────────────────────── */}
						<div className="space-y-2">
							<p className="text-sm font-medium text-foreground">Payment Gateway</p>
							<div className="grid grid-cols-2 gap-3">
								{gateways.map((gw) => {
									const isSelected = selectedGatewayId === gw.gateway;
									return (
										<button
											key={gw.gateway}
											type="button"
											onClick={() => setSelectedGatewayId(gw.gateway)}
											className={cn(
												"flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all duration-150",
												"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
												isSelected
													? "border-primary bg-primary/5 ring-1 ring-primary/20"
													: "border-border bg-background hover:border-muted-foreground/30 hover:bg-muted/30"
											)}
										>
											{/* SVG Icon */}
											{(() => {
												const svgConfig = getGatewaySvg(gw.gateway);
												if (svgConfig) {
													return (
														<div
															className={cn(
																"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
																isSelected ? svgConfig.bg : "bg-muted"
															)}
														>
															<SvgIcon
																svg={svgConfig.svg}
																size={36}
															/>
														</div>
													);
												}
												// Fallback: unknown gateway
												return (
													<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground">
														{gw.name.slice(0, 2).toUpperCase()}
													</div>
												);
											})()}
											{/* Label */}
											<div className="min-w-0 flex-1">
												<p className={cn("text-sm font-semibold", isSelected ? "text-primary" : "text-foreground")}>
													{gw.name}
												</p>
												{gw.methods.length > 0 && (
													<p className="text-muted-foreground truncate text-xs">
														{gw.methods.map((m) => m.name).join(", ")}
													</p>
												)}
											</div>
											{/* Selected indicator */}
											{isSelected && (
												<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
													<div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
												</div>
											)}
										</button>
									);
								})}
							</div>
						</div>

						{/* ── Tenant type ───────────────────────────────────────────────── */}
						<div className="space-y-2">
							<p className="text-sm font-medium text-foreground">Charge To</p>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => { setTenantType("personal"); setSelectedOrgId(""); }}
									className={cn(
										"flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all",
										tenantType === "personal"
											? "border-primary bg-primary/5 text-primary"
											: "border-border bg-background text-muted-foreground hover:border-muted-foreground/30"
									)}
								>
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
										<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
										<circle cx="12" cy="7" r="4" />
									</svg>
									Personal
								</button>
								{hasOrg && (
									<button
										type="button"
										onClick={() => setTenantType("organization")}
										className={cn(
											"flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all",
											tenantType === "organization"
												? "border-primary bg-primary/5 text-primary"
												: "border-border bg-background text-muted-foreground hover:border-muted-foreground/30"
										)}
									>
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
											<path d="M3 21h18" />
											<path d="M9 8h1" />
											<path d="M9 12h1" />
											<path d="M9 16h1" />
											<path d="M14 8h1" />
											<path d="M14 12h1" />
											<path d="M14 16h1" />
											<path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
										</svg>
										Organization
									</button>
								)}
							</div>
						</div>

						{/* ── Org selector ─────────────────────────────────────────────── */}
						{tenantType === "organization" && (
							<div className="space-y-2">
								<label className="text-sm font-medium text-foreground">Select Organization</label>
								<Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Choose an organization" />
									</SelectTrigger>
									<SelectContent>
								{orgOptions.map((org) => (
										<SelectItem key={org.id} value={org.id}>
											{org.name || `Organization (${org.id.slice(0, 8)}...)`}
										</SelectItem>
									))}
									</SelectContent>
								</Select>
							</div>
						)}

						{/* ── Amount (recharge only) ───────────────────────────────────── */}
						{type === "recharge" && (
							<div className="space-y-2">
								<label className="text-sm font-medium text-foreground" htmlFor="recharge-amount">
									Amount (USD)
								</label>
								<div className="relative">
									<span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium">$</span>
									<Input
										id="recharge-amount"
										type="number"
										min="1"
										step="0.01"
										placeholder="0.00"
										value={localAmount}
										onChange={(e) => setLocalAmount(e.target.value)}
										className="pl-7"
										onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
									/>
								</div>
							</div>
						)}

						{/* ── Package summary (package only) ───────────────────────────── */}
						{type === "package" && (
							<div className="rounded-lg border bg-muted/30 px-4 py-3">
								<div className="flex items-center justify-between">
									<div>
										<p className="text-sm font-medium">{packageName ?? "Selected Package"}</p>
										<p className="text-muted-foreground text-xs">Package purchase</p>
									</div>
									<p className="text-lg font-bold">{packagePrice ?? ""}</p>
								</div>
							</div>
						)}
					</div>
				)}

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isProcessing}
					>
						Cancel
					</Button>
					<Button
						onClick={handleConfirm}
						disabled={!canConfirm || isProcessing}
					>
						{isProcessing ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Processing...
							</>
						) : (
							type === "recharge" ? "Continue to Payment" : "Purchase Package"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
