import { useState } from "react";
import {
	usePlatformListPackagesQuery,
	usePlatformAdminCreatePackageMutation,
	usePlatformAdminUpdatePackageMutation,
	usePlatformAdminDeletePackageMutation,
	type PlatformPackage,
} from "@/lib/platform/platformApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Package } from "lucide-react";
import { toast } from "sonner";

interface PackageFormData {
	name: string;
	description: string;
	quota: number;
	price: number;
	duration: number; // 0 = no expiry
	rate_limit_config: string; // JSON string
	allowed_models: string; // JSON string
	off_peak_discount: string; // JSON string
	auto_renew: boolean;
	target_type: "user" | "customer" | "both";
	max_purchase_per_user: number;
	sort_order: number;
	stripe_price_id?: string; // optional: undefined means omit
	is_active: boolean;
}

const defaultFormData: PackageFormData = {
	name: "",
	description: "",
	quota: 0,
	price: 0,
	duration: 30,
	rate_limit_config: "",
	allowed_models: "",
	off_peak_discount: "",
	auto_renew: false,
	target_type: "both",
	max_purchase_per_user: 0,
	sort_order: 0,
	stripe_price_id: undefined,
	is_active: true,
};

function parseJSONField(raw: string | undefined, fallback: unknown): string {
	if (!raw) return "";
	try {
		JSON.parse(raw); // validate
		return raw;
	} catch {
		return fallback as string;
	}
}

export default function PackagesPage() {
	const { data: packages, isLoading } = usePlatformListPackagesQuery();
	const [createPackage] = usePlatformAdminCreatePackageMutation();
	const [updatePackage] = usePlatformAdminUpdatePackageMutation();
	const [deletePackage] = usePlatformAdminDeletePackageMutation();

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingPkg, setEditingPkg] = useState<PlatformPackage | null>(null);
	const [formData, setFormData] = useState<PackageFormData>(defaultFormData);
	const [rateLimitInput, setRateLimitInput] = useState("");
	const [modelsInput, setModelsInput] = useState("");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [deletingPkg, setDeletingPkg] = useState<PlatformPackage | null>(null);

	const openCreateDialog = () => {
		setEditingPkg(null);
		setFormData(defaultFormData);
		setRateLimitInput("");
		setModelsInput("");
		setDialogOpen(true);
	};

	const openEditDialog = (pkg: PlatformPackage) => {
		setEditingPkg(pkg);
		setFormData({
			name: pkg.name,
			description: pkg.description,
			quota: pkg.quota,
			price: pkg.price,
			duration: pkg.duration,
			rate_limit_config: pkg.rate_limit_config ?? "",
			allowed_models: pkg.allowed_models ?? "",
			off_peak_discount: pkg.off_peak_discount ?? "",
			auto_renew: pkg.auto_renew,
			target_type: pkg.target_type ?? "both",
			max_purchase_per_user: pkg.max_purchase_per_user,
			sort_order: pkg.sort_order,
			stripe_price_id: pkg.stripe_price_id,
			is_active: pkg.is_active,
		});
		// Parse JSON fields for editing convenience
		try {
			const rlc = pkg.rate_limit_config ? JSON.parse(pkg.rate_limit_config) : {};
			setRateLimitInput(
				Object.entries(rlc)
					.map(([k, v]) => `${k}=${v}`)
					.join(", ") || "",
			);
		} catch {
			setRateLimitInput("");
		}
		try {
			const am = pkg.allowed_models ? JSON.parse(pkg.allowed_models) : [];
			setModelsInput(Array.isArray(am) ? am.join(", ") : "");
		} catch {
			setModelsInput("");
		}
		setDialogOpen(true);
	};

	const handleSubmit = async () => {
		// Build JSON strings from comma-separated inputs
		const rateLimitConfig = rateLimitInput
			? (() => {
					const obj: Record<string, number> = {};
					rateLimitInput.split(",").forEach((pair) => {
						const [k, v] = pair.split("=").map((s) => s.trim());
						if (k && v) obj[k] = Number(v);
					});
					return Object.keys(obj).length > 0 ? JSON.stringify(obj) : "";
				})()
			: "";

		const allowedModels = modelsInput
			? JSON.stringify(
					modelsInput
						.split(",")
						.map((m) => m.trim())
						.filter(Boolean),
				)
			: "";

		const offPeakDiscountRaw = formData.off_peak_discount;
		const offPeakDiscount = offPeakDiscountRaw ? JSON.stringify(Number(offPeakDiscountRaw)) : "";

		const payload = {
			...formData,
			rate_limit_config: rateLimitConfig,
			allowed_models: allowedModels,
			off_peak_discount: offPeakDiscount,
			stripe_price_id: formData.stripe_price_id || undefined,
		};

		try {
			if (editingPkg) {
				await updatePackage({ id: editingPkg.id, ...payload }).unwrap();
				toast.success("Package updated successfully");
			} else {
				await createPackage(payload).unwrap();
				toast.success("Package created successfully");
			}
			setDialogOpen(false);
		} catch (err: unknown) {
			const msg =
				(err as { data?: { message?: string }; message?: string })?.data?.message ||
				(err as { message?: string })?.message ||
				"Failed to save package";
			toast.error(msg);
		}
	};

	const handleDelete = async () => {
		if (!deletingPkg) return;
		try {
			await deletePackage(deletingPkg.id).unwrap();
			toast.success("Package deleted successfully");
			setDeleteDialogOpen(false);
			setDeletingPkg(null);
		} catch (err: unknown) {
			toast.error("Failed to delete package");
		}
	};

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Packages</h1>
					<p className="text-muted-foreground text-sm">Manage subscription packages available for purchase.</p>
				</div>
				<Button onClick={openCreateDialog}>
					<Plus className="mr-2 h-4 w-4" />
					New Package
				</Button>
			</div>

			<Card>
				<CardContent className="p-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Target</TableHead>
								<TableHead>Quota (credits)</TableHead>
								<TableHead>Price</TableHead>
								<TableHead>Duration</TableHead>
								<TableHead>Auto-Renew</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading && (
								<TableRow>
									<TableCell colSpan={8} className="text-muted-foreground py-8 text-center">
										Loading...
									</TableCell>
								</TableRow>
							)}
							{!isLoading && (!packages || packages.length === 0) && (
								<TableRow>
									<TableCell colSpan={8} className="text-muted-foreground py-8 text-center">
										No packages found. Create your first package.
									</TableCell>
								</TableRow>
							)}
							{packages?.map((pkg) => (
								<TableRow key={pkg.id}>
									<TableCell className="font-medium">{pkg.name}</TableCell>
									<TableCell>
										<Badge variant="outline">{pkg.target_type ?? "both"}</Badge>
									</TableCell>
									<TableCell>{pkg.quota.toLocaleString()}</TableCell>
									<TableCell>${pkg.price.toFixed(2)}</TableCell>
									<TableCell>{pkg.duration === 0 ? "No expiry" : `${pkg.duration}d`}</TableCell>
									<TableCell>{pkg.auto_renew ? <Badge variant="secondary">Yes</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
									<TableCell>
										<Badge variant={pkg.is_active ? "default" : "secondary"}>{pkg.is_active ? "Active" : "Inactive"}</Badge>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex items-center justify-end gap-1">
											<Button variant="ghost" size="sm" onClick={() => openEditDialog(pkg)}>
												<Pencil className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => {
													setDeletingPkg(pkg);
													setDeleteDialogOpen(true);
												}}
											>
												<Trash2 className="text-destructive h-4 w-4" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			{/* Create / Edit Dialog */}
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" disableOutsideClick={false}>
					<DialogHeader>
						<DialogTitle>{editingPkg ? "Edit Package" : "Create Package"}</DialogTitle>
						<DialogDescription>{editingPkg ? "Update package details." : "Configure a new subscription package."}</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="pkg-name">Name</Label>
							<Input id="pkg-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
						</div>
						<div className="grid gap-2">
							<Label htmlFor="pkg-description">Description</Label>
							<Textarea
								id="pkg-description"
								value={formData.description}
								onChange={(e) => setFormData({ ...formData, description: e.target.value })}
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="pkg-quota">Quota (credits)</Label>
								<Input
									id="pkg-quota"
									type="number"
									value={formData.quota}
									onChange={(e) => setFormData({ ...formData, quota: Number(e.target.value) })}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="pkg-price">Price (USD)</Label>
								<Input
									id="pkg-price"
									type="number"
									step="0.01"
									value={formData.price}
									onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
								/>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="pkg-duration">Duration (days, 0=no expiry)</Label>
								<Input
									id="pkg-duration"
									type="number"
									value={formData.duration}
									onChange={(e) => setFormData({ ...formData, duration: Number(e.target.value) })}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="pkg-target">Target Type</Label>
								<Select
									value={formData.target_type}
									onValueChange={(v) => setFormData({ ...formData, target_type: v as "user" | "customer" | "both" })}
								>
									<SelectTrigger id="pkg-target">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="both">Both (User & Org)</SelectItem>
										<SelectItem value="user">User only</SelectItem>
										<SelectItem value="customer">Org only</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="pkg-sort">Sort Order</Label>
								<Input
									id="pkg-sort"
									type="number"
									value={formData.sort_order}
									onChange={(e) => setFormData({ ...formData, sort_order: Number(e.target.value) })}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="pkg-max-purchase">Max Purchase Per User</Label>
								<Input
									id="pkg-max-purchase"
									type="number"
									value={formData.max_purchase_per_user}
									onChange={(e) => setFormData({ ...formData, max_purchase_per_user: Number(e.target.value) })}
								/>
							</div>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="pkg-models">Allowed Models (comma-separated)</Label>
							<Input
								id="pkg-models"
								placeholder="gpt-4o, claude-3-5-sonnet, gemini-2.0-flash"
								value={modelsInput}
								onChange={(e) => setModelsInput(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="pkg-rate-limit">Rate Limit (comma-separated, e.g. requests_per_minute=60)</Label>
							<Input
								id="pkg-rate-limit"
								placeholder="requests_per_minute=60, requests_per_day=1000"
								value={rateLimitInput}
								onChange={(e) => setRateLimitInput(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="pkg-offpeak">Off-Peak Discount (e.g. 0.2 for 20% off)</Label>
							<Input
								id="pkg-offpeak"
								type="number"
								step="0.01"
								placeholder="0.2"
								value={formData.off_peak_discount}
								onChange={(e) => setFormData({ ...formData, off_peak_discount: e.target.value })}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="pkg-stripe-price">Stripe Price ID (optional)</Label>
							<Input
								id="pkg-stripe-price"
								placeholder="price_xxx..."
								value={formData.stripe_price_id}
								onChange={(e) => setFormData({ ...formData, stripe_price_id: e.target.value })}
							/>
						</div>
						<div className="flex items-center gap-2">
							<Switch checked={formData.auto_renew} onCheckedChange={(checked) => setFormData({ ...formData, auto_renew: checked })} />
							<Label>Auto-Renew</Label>
						</div>
						<div className="flex items-center gap-2">
							<Switch checked={formData.is_active} onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })} />
							<Label>Active</Label>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDialogOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleSubmit}>{editingPkg ? "Update" : "Create"}</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent disableOutsideClick={false}>
					<DialogHeader>
						<DialogTitle>Delete Package</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete &quot;{deletingPkg?.name}&quot;? This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleDelete}>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}