import { useState } from "react";
import {
	usePlatformAdminListProviderKeysQuery,
	usePlatformAdminCreateProviderKeyMutation,
	usePlatformAdminUpdateProviderKeyMutation,
	usePlatformAdminDeleteProviderKeyMutation,
} from "@/lib/platform/platformApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Server, Plus, Pencil, Trash2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { KnownProvidersNames } from "@/lib/constants/logs";

interface ProviderKeyRow {
	id: number;
	key_id: string;
	key_name: string;
	base_url?: string;
	weight?: number;
	models?: string[];
}

export default function ProvidersPage() {
	const [selectedProvider, setSelectedProvider] = useState<string>(KnownProvidersNames[0]);
	const { data: keysData, isLoading } = usePlatformAdminListProviderKeysQuery(selectedProvider);
	const [createKey] = usePlatformAdminCreateProviderKeyMutation();
	const [updateKey] = usePlatformAdminUpdateProviderKeyMutation();
	const [deleteKey] = usePlatformAdminDeleteProviderKeyMutation();

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingKey, setEditingKey] = useState<ProviderKeyRow | null>(null);
	const [formData, setFormData] = useState({ key_id: "", key_value: "", base_url: "", weight: 100, models: "" });
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [deletingKey, setDeletingKey] = useState<ProviderKeyRow | null>(null);

	const keys = keysData?.keys ?? [];

	const openCreateDialog = () => {
		setEditingKey(null);
		setFormData({ key_id: "", key_value: "", base_url: "", weight: 100, models: "" });
		setDialogOpen(true);
	};

	const openEditDialog = (key: ProviderKeyRow) => {
		setEditingKey(key);
		setFormData({
			key_id: key.key_id,
			key_value: "",
			base_url: key.base_url ?? "",
			weight: key.weight ?? 100,
			models: (key.models ?? []).join(", "),
		});
		setDialogOpen(true);
	};

	const handleSubmit = async () => {
		const models = formData.models
			.split(",")
			.map((m) => m.trim())
			.filter(Boolean);

		try {
			if (editingKey) {
				await updateKey({
					provider: selectedProvider,
					key_id: editingKey.key_id,
					key_value: formData.key_value || undefined,
					base_url: formData.base_url || undefined,
					weight: formData.weight,
					models: models.length > 0 ? models : undefined,
				}).unwrap();
				toast.success("Provider key updated successfully");
			} else {
				await createKey({
					provider: selectedProvider,
					key_id: formData.key_id,
					key_value: formData.key_value,
					base_url: formData.base_url || undefined,
					weight: formData.weight,
					models: models.length > 0 ? models : undefined,
				}).unwrap();
				toast.success("Provider key created successfully");
			}
			setDialogOpen(false);
		} catch (err) {
			toast.error("Failed to save provider key");
		}
	};

	const handleDelete = async () => {
		if (!deletingKey) return;
		try {
			await deleteKey({ provider: selectedProvider, key_id: deletingKey.key_id }).unwrap();
			toast.success("Provider key deleted successfully");
			setDeleteDialogOpen(false);
			setDeletingKey(null);
		} catch (err) {
			toast.error("Failed to delete provider key");
		}
	};

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Provider Key Management</h1>
					<p className="text-muted-foreground">Manage API keys for each LLM provider.</p>
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Server className="h-5 w-5" />
						Provider Keys
					</CardTitle>
					<CardDescription>Select a provider to view and manage its API keys.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex items-center gap-4">
						<div className="grid gap-2">
							<Label>Provider</Label>
							<Select value={selectedProvider} onValueChange={setSelectedProvider}>
								<SelectTrigger className="w-48" data-testid="admin-providers-select">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{KnownProvidersNames.map((p) => (
										<SelectItem key={p} value={p}>
											{p.charAt(0).toUpperCase() + p.slice(1)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex-1" />
						<Button onClick={openCreateDialog} className="self-end" data-testid="admin-providers-create-btn">
							<Plus className="mr-2 h-4 w-4" />
							Add Key
						</Button>
					</div>

					{isLoading ? (
						<div className="flex items-center justify-center py-10">
							<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Key ID</TableHead>
									<TableHead>Name</TableHead>
									<TableHead>Base URL</TableHead>
									<TableHead>Weight</TableHead>
									<TableHead>Models</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{keys.length === 0 && (
									<TableRow>
										<TableCell colSpan={6} className="text-muted-foreground text-center">
											No keys configured for {selectedProvider}.
										</TableCell>
									</TableRow>
								)}
								{keys.map((key) => (
									<TableRow key={key.id}>
										<TableCell className="font-mono text-sm">{key.key_id}</TableCell>
										<TableCell className="font-medium">{key.key_name}</TableCell>
										<TableCell className="text-muted-foreground text-sm">{key.base_url || "—"}</TableCell>
										<TableCell>{key.weight ?? "—"}</TableCell>
										<TableCell>
											<div className="flex flex-wrap gap-1">
												{key.models?.slice(0, 3).map((m) => (
													<Badge key={m} variant="outline" className="text-xs">
														{m}
													</Badge>
												))}
												{(key.models?.length ?? 0) > 3 && (
													<Badge variant="secondary" className="text-xs">
														+{(key.models?.length ?? 0) - 3}
													</Badge>
												)}
											</div>
										</TableCell>
										<TableCell className="text-right">
											<div className="flex items-center justify-end gap-1">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => openEditDialog(key)}
													data-testid={`admin-providers-edit-${key.id}`}
												>
													<Pencil className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														setDeletingKey(key);
														setDeleteDialogOpen(true);
													}}
													data-testid={`admin-providers-delete-${key.id}`}
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
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<KeyRound className="h-5 w-5" />
							{editingKey ? "Edit Provider Key" : "Add Provider Key"}
						</DialogTitle>
						<DialogDescription>
							{editingKey ? `Update key for ${selectedProvider}.` : `Add a new API key for ${selectedProvider}.`}
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="key-id">Key ID</Label>
							<Input
								id="key-id"
								value={formData.key_id}
								onChange={(e) => setFormData({ ...formData, key_id: e.target.value })}
								disabled={!!editingKey}
								data-testid="admin-providers-form-key-id"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="key-value">Key Value {editingKey && "(leave empty to keep current)"}</Label>
							<Input
								id="key-value"
								type="password"
								value={formData.key_value}
								onChange={(e) => setFormData({ ...formData, key_value: e.target.value })}
								data-testid="admin-providers-form-key-value"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="key-base-url">Base URL (optional)</Label>
							<Input
								id="key-base-url"
								value={formData.base_url}
								onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
								placeholder="https://api.example.com"
								data-testid="admin-providers-form-base-url"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="key-weight">Weight</Label>
							<Input
								id="key-weight"
								type="number"
								value={formData.weight}
								onChange={(e) => setFormData({ ...formData, weight: Number(e.target.value) })}
								data-testid="admin-providers-form-weight"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="key-models">Models (comma-separated, optional)</Label>
							<Input
								id="key-models"
								value={formData.models}
								onChange={(e) => setFormData({ ...formData, models: e.target.value })}
								placeholder="gpt-4, gpt-3.5-turbo"
								data-testid="admin-providers-form-models"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDialogOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleSubmit} data-testid="admin-providers-form-submit">
							{editingKey ? "Update" : "Create"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Provider Key</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete key &quot;{deletingKey?.key_id}&quot; from {selectedProvider}? This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleDelete} data-testid="admin-providers-delete-confirm">
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}