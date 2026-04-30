import { useState } from "react";
import {
	usePlatformAdminListModelPricesQuery,
	usePlatformAdminUpsertModelPriceMutation,
	usePlatformAdminDeleteModelPriceMutation,
	type PlatformModelPrice,
} from "@/lib/platform/platformApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DollarSign, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface ModelPriceFormData {
	model: string;
	provider: string;
	input_token_price: number;
	output_token_price: number;
}

const defaultFormData: ModelPriceFormData = {
	model: "",
	provider: "",
	input_token_price: 0,
	output_token_price: 0,
};

export default function ModelPricesPage() {
	const { data: prices, isLoading } = usePlatformAdminListModelPricesQuery();
	const [upsertPrice] = usePlatformAdminUpsertModelPriceMutation();
	const [deletePrice] = usePlatformAdminDeleteModelPriceMutation();

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingPrice, setEditingPrice] = useState<PlatformModelPrice | null>(null);
	const [formData, setFormData] = useState<ModelPriceFormData>(defaultFormData);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [deletingPrice, setDeletingPrice] = useState<PlatformModelPrice | null>(null);

	const openCreateDialog = () => {
		setEditingPrice(null);
		setFormData(defaultFormData);
		setDialogOpen(true);
	};

	const openEditDialog = (price: PlatformModelPrice) => {
		setEditingPrice(price);
		setFormData({
			model: price.model,
			provider: price.provider,
			input_token_price: price.input_token_price,
			output_token_price: price.output_token_price,
		});
		setDialogOpen(true);
	};

	const handleSubmit = async () => {
		try {
			await upsertPrice(formData).unwrap();
			toast.success(editingPrice ? "Model price updated" : "Model price created");
			setDialogOpen(false);
		} catch (err) {
			toast.error("Failed to save model price");
		}
	};

	const handleDelete = async () => {
		if (!deletingPrice) return;
		try {
			await deletePrice(deletingPrice.id).unwrap();
			toast.success("Model price deleted");
			setDeleteDialogOpen(false);
			setDeletingPrice(null);
		} catch (err) {
			toast.error("Failed to delete model price");
		}
	};

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Model Price Management</h1>
					<p className="text-muted-foreground">Configure per-model token pricing for cost calculation.</p>
				</div>
				<Button onClick={openCreateDialog} data-testid="admin-model-prices-create-btn">
					<Plus className="mr-2 h-4 w-4" />
					Add Price
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<DollarSign className="h-5 w-5" />
						Model Prices
					</CardTitle>
					<CardDescription>{prices?.length ?? 0} model pricing entries</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex items-center justify-center py-10">
							<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Model</TableHead>
									<TableHead>Provider</TableHead>
									<TableHead>Input Price (per 1K tokens)</TableHead>
									<TableHead>Output Price (per 1K tokens)</TableHead>
									<TableHead>Updated</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{(!prices || prices.length === 0) && (
									<TableRow>
										<TableCell colSpan={6} className="text-muted-foreground text-center">
											No model prices configured. Add your first pricing entry.
										</TableCell>
									</TableRow>
								)}
								{prices?.map((price) => (
									<TableRow key={price.id}>
										<TableCell className="font-mono text-sm font-medium">{price.model}</TableCell>
										<TableCell className="text-sm">{price.provider}</TableCell>
										<TableCell>${price.input_token_price.toFixed(6)}</TableCell>
										<TableCell>${price.output_token_price.toFixed(6)}</TableCell>
										<TableCell className="text-muted-foreground text-sm">{new Date(price.updated_at).toLocaleDateString()}</TableCell>
										<TableCell className="text-right">
											<div className="flex items-center justify-end gap-1">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => openEditDialog(price)}
													data-testid={`admin-model-prices-edit-${price.id}`}
												>
													<Pencil className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														setDeletingPrice(price);
														setDeleteDialogOpen(true);
													}}
													data-testid={`admin-model-prices-delete-${price.id}`}
												>
													<Trash2 className="text-destructive h-4 w-4" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Create / Edit Dialog */}
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editingPrice ? "Edit Model Price" : "Add Model Price"}</DialogTitle>
						<DialogDescription>
							{editingPrice ? "Update token pricing for this model." : "Set token pricing for a model/provider combination."}
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="mp-model">Model</Label>
							<Input
								id="mp-model"
								value={formData.model}
								onChange={(e) => setFormData({ ...formData, model: e.target.value })}
								placeholder="gpt-4"
								data-testid="admin-model-prices-form-model"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="mp-provider">Provider</Label>
							<Input
								id="mp-provider"
								value={formData.provider}
								onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
								placeholder="openai"
								data-testid="admin-model-prices-form-provider"
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="mp-input-price">Input Price (per 1K tokens)</Label>
								<Input
									id="mp-input-price"
									type="number"
									step="0.000001"
									value={formData.input_token_price}
									onChange={(e) => setFormData({ ...formData, input_token_price: Number(e.target.value) })}
									data-testid="admin-model-prices-form-input-price"
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="mp-output-price">Output Price (per 1K tokens)</Label>
								<Input
									id="mp-output-price"
									type="number"
									step="0.000001"
									value={formData.output_token_price}
									onChange={(e) => setFormData({ ...formData, output_token_price: Number(e.target.value) })}
									data-testid="admin-model-prices-form-output-price"
								/>
							</div>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDialogOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleSubmit} data-testid="admin-model-prices-form-submit">
							{editingPrice ? "Update" : "Create"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Model Price</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete the pricing for &quot;{deletingPrice?.model}&quot; ({deletingPrice?.provider})? This action
							cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleDelete} data-testid="admin-model-prices-delete-confirm">
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}