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
import { Plus, Pencil, Trash2, Package } from "lucide-react";
import { toast } from "sonner";

interface PackageFormData {
	name: string;
	description: string;
	token_amount: number;
	credits: number;
	price: number;
	currency: string;
	package_type: string;
	duration_days: number | null;
	features: string[];
	is_active: boolean;
	sort_order: number;
}

const defaultFormData: PackageFormData = {
	name: "",
	description: "",
	token_amount: 0,
	credits: 0,
	price: 0,
	currency: "USD",
	package_type: "token",
	duration_days: null,
	features: [],
	is_active: true,
	sort_order: 0,
};

export default function PackagesPage() {
	const { data: packages, isLoading } = usePlatformListPackagesQuery();
	const [createPackage] = usePlatformAdminCreatePackageMutation();
	const [updatePackage] = usePlatformAdminUpdatePackageMutation();
	const [deletePackage] = usePlatformAdminDeletePackageMutation();

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingPkg, setEditingPkg] = useState<PlatformPackage | null>(null);
	const [formData, setFormData] = useState<PackageFormData>(defaultFormData);
	const [featuresInput, setFeaturesInput] = useState("");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [deletingPkg, setDeletingPkg] = useState<PlatformPackage | null>(null);

	const openCreateDialog = () => {
		setEditingPkg(null);
		setFormData(defaultFormData);
		setFeaturesInput("");
		setDialogOpen(true);
	};

	const openEditDialog = (pkg: PlatformPackage) => {
		setEditingPkg(pkg);
		setFormData({
			name: pkg.name,
			description: pkg.description,
			token_amount: pkg.token_amount,
			credits: pkg.credits,
			price: pkg.price,
			currency: pkg.currency,
			package_type: pkg.package_type,
			duration_days: pkg.duration_days,
			features: pkg.features ?? [],
			is_active: pkg.is_active,
			sort_order: pkg.sort_order,
		});
		setFeaturesInput((pkg.features ?? []).join(", "));
		setDialogOpen(true);
	};

	const handleSubmit = async () => {
		const features = featuresInput
			.split(",")
			.map((f) => f.trim())
			.filter(Boolean);
		const payload = { ...formData, features };

		try {
			if (editingPkg) {
				await updatePackage({ id: editingPkg.id, ...payload }).unwrap();
				toast.success("Package updated successfully");
			} else {
				await createPackage(payload).unwrap();
				toast.success("Package created successfully");
			}
			setDialogOpen(false);
		} catch (err) {
			toast.error("Failed to save package");
		}
	};

	const handleDelete = async () => {
		if (!deletingPkg) return;
		try {
			await deletePackage(deletingPkg.id).unwrap();
			toast.success("Package deleted successfully");
			setDeleteDialogOpen(false);
			setDeletingPkg(null);
		} catch (err) {
			toast.error("Failed to delete package");
		}
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Package Management</h1>
					<p className="text-muted-foreground">Create and manage subscription packages for users.</p>
				</div>
				<Button onClick={openCreateDialog} data-testid="admin-packages-create-btn">
					<Plus className="mr-2 h-4 w-4" />
					Create Package
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Package className="h-5 w-5" />
						Packages
					</CardTitle>
					<CardDescription>{packages?.length ?? 0} packages configured</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Tokens</TableHead>
								<TableHead>Credits</TableHead>
								<TableHead>Price</TableHead>
								<TableHead>Duration</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Sort</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(!packages || packages.length === 0) && (
								<TableRow>
									<TableCell colSpan={9} className="text-muted-foreground text-center">
										No packages found. Create your first package.
									</TableCell>
								</TableRow>
							)}
							{packages?.map((pkg) => (
								<TableRow key={pkg.id}>
									<TableCell className="font-medium">{pkg.name}</TableCell>
									<TableCell>
										<Badge variant="outline">{pkg.package_type}</Badge>
									</TableCell>
									<TableCell>{pkg.token_amount.toLocaleString()}</TableCell>
									<TableCell>{pkg.credits.toLocaleString()}</TableCell>
									<TableCell>
										{pkg.currency} {pkg.price.toFixed(2)}
									</TableCell>
									<TableCell>{pkg.duration_days ? `${pkg.duration_days}d` : "—"}</TableCell>
									<TableCell>
										<Badge variant={pkg.is_active ? "default" : "secondary"}>{pkg.is_active ? "Active" : "Inactive"}</Badge>
									</TableCell>
									<TableCell>{pkg.sort_order}</TableCell>
									<TableCell className="text-right">
										<div className="flex items-center justify-end gap-1">
											<Button variant="ghost" size="sm" onClick={() => openEditDialog(pkg)} data-testid={`admin-packages-edit-${pkg.id}`}>
												<Pencil className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => {
													setDeletingPkg(pkg);
													setDeleteDialogOpen(true);
												}}
												data-testid={`admin-packages-delete-${pkg.id}`}
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
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>{editingPkg ? "Edit Package" : "Create Package"}</DialogTitle>
						<DialogDescription>{editingPkg ? "Update package details." : "Configure a new subscription package."}</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="pkg-name">Name</Label>
							<Input
								id="pkg-name"
								value={formData.name}
								onChange={(e) => setFormData({ ...formData, name: e.target.value })}
								data-testid="admin-packages-form-name"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="pkg-description">Description</Label>
							<Textarea
								id="pkg-description"
								value={formData.description}
								onChange={(e) => setFormData({ ...formData, description: e.target.value })}
								data-testid="admin-packages-form-description"
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="pkg-tokens">Token Amount</Label>
								<Input
									id="pkg-tokens"
									type="number"
									value={formData.token_amount}
									onChange={(e) => setFormData({ ...formData, token_amount: Number(e.target.value) })}
									data-testid="admin-packages-form-tokens"
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="pkg-credits">Credits</Label>
								<Input
									id="pkg-credits"
									type="number"
									value={formData.credits}
									onChange={(e) => setFormData({ ...formData, credits: Number(e.target.value) })}
									data-testid="admin-packages-form-credits"
								/>
							</div>
						</div>
						<div className="grid grid-cols-3 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="pkg-price">Price</Label>
								<Input
									id="pkg-price"
									type="number"
									step="0.01"
									value={formData.price}
									onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
									data-testid="admin-packages-form-price"
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="pkg-currency">Currency</Label>
								<Input
									id="pkg-currency"
									value={formData.currency}
									onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
									data-testid="admin-packages-form-currency"
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="pkg-type">Type</Label>
								<Input
									id="pkg-type"
									value={formData.package_type}
									onChange={(e) => setFormData({ ...formData, package_type: e.target.value })}
									data-testid="admin-packages-form-type"
								/>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="pkg-duration">Duration (days)</Label>
								<Input
									id="pkg-duration"
									type="number"
									value={formData.duration_days ?? ""}
									onChange={(e) => setFormData({ ...formData, duration_days: e.target.value ? Number(e.target.value) : null })}
									data-testid="admin-packages-form-duration"
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="pkg-sort">Sort Order</Label>
								<Input
									id="pkg-sort"
									type="number"
									value={formData.sort_order}
									onChange={(e) => setFormData({ ...formData, sort_order: Number(e.target.value) })}
									data-testid="admin-packages-form-sort"
								/>
							</div>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="pkg-features">Features (comma-separated)</Label>
							<Input
								id="pkg-features"
								value={featuresInput}
								onChange={(e) => setFeaturesInput(e.target.value)}
								data-testid="admin-packages-form-features"
							/>
						</div>
						<div className="flex items-center gap-2">
							<Switch
								checked={formData.is_active}
								onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
								data-testid="admin-packages-form-active"
							/>
							<Label>Active</Label>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDialogOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleSubmit} data-testid="admin-packages-form-submit">
							{editingPkg ? "Update" : "Create"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
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
						<Button variant="destructive" onClick={handleDelete} data-testid="admin-packages-delete-confirm">
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}