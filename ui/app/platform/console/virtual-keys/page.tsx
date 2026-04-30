import { useState } from "react";
import {
	usePlatformListVKsQuery,
	usePlatformCreateVKMutation,
	usePlatformUpdateVKMutation,
	usePlatformDeleteVKMutation,
} from "@/lib/platform/platformApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alertDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Copy, Trash2, Eye, EyeOff, Pencil, Power } from "lucide-react";
import { toast } from "sonner";
import type { PlatformVirtualKey } from "@/lib/platform/platformApi";

export default function VirtualKeysPage() {
	const { data: virtualKeys, isLoading } = usePlatformListVKsQuery();
	const [createVK, { isLoading: isCreating }] = usePlatformCreateVKMutation();
	const [updateVK, { isLoading: isUpdating }] = usePlatformUpdateVKMutation();
	const [deleteVK, { isLoading: isDeleting }] = usePlatformDeleteVKMutation();

	const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
	const [createOpen, setCreateOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);

	// Create form state
	const [newName, setNewName] = useState("");
	const [newDesc, setNewDesc] = useState("");

	// Edit form state
	const [editingVK, setEditingVK] = useState<PlatformVirtualKey | null>(null);
	const [editName, setEditName] = useState("");
	const [editDesc, setEditDesc] = useState("");
	const [editActive, setEditActive] = useState(true);

	const toggleKeyVisibility = (keyId: string) => {
		setShowKeys((prev) => ({
			...prev,
			[keyId]: !prev[keyId],
		}));
	};

	const maskKey = (value: string, revealed: boolean) => {
		if (revealed) return value;
		if (value.length <= 8) return "•".repeat(value.length);
		return value.substring(0, 8) + "•".repeat(Math.max(0, value.length - 8));
	};

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text).then(
			() => toast.success("Key copied to clipboard"),
			() => toast.error("Failed to copy key"),
		);
	};

	const openEditDialog = (vk: PlatformVirtualKey) => {
		setEditingVK(vk);
		setEditName(vk.name);
		setEditDesc(vk.description || "");
		setEditActive(vk.is_active);
		setEditOpen(true);
	};

	const handleCreate = async () => {
		if (!newName.trim()) {
			toast.error("Name is required");
			return;
		}
		try {
			await createVK({
				name: newName.trim(),
				description: newDesc.trim() || undefined,
			}).unwrap();
			toast.success("Virtual key created successfully");
			setCreateOpen(false);
			setNewName("");
			setNewDesc("");
		} catch (error: unknown) {
			const message =
				error instanceof Error
					? error.message
					: ((error as { data?: { message?: string } })?.data?.message ?? "Failed to create virtual key");
			toast.error(message);
		}
	};

	const handleUpdate = async () => {
		if (!editingVK || !editName.trim()) {
			toast.error("Name is required");
			return;
		}
		try {
			await updateVK({
				id: editingVK.id,
				data: {
					name: editName.trim(),
					description: editDesc.trim() || undefined,
					is_active: editActive,
				},
			}).unwrap();
			toast.success("Virtual key updated successfully");
			setEditOpen(false);
			setEditingVK(null);
		} catch (error: unknown) {
			const message =
				error instanceof Error
					? error.message
					: ((error as { data?: { message?: string } })?.data?.message ?? "Failed to update virtual key");
			toast.error(message);
		}
	};

	const handleDelete = async (id: string) => {
		try {
			await deleteVK(id).unwrap();
			toast.success("Virtual key deleted successfully");
		} catch (error: unknown) {
			const message =
				error instanceof Error
					? error.message
					: ((error as { data?: { message?: string } })?.data?.message ?? "Failed to delete virtual key");
			toast.error(message);
		}
	};

	const formatDate = (dateStr: string) => {
		try {
			return new Date(dateStr).toLocaleDateString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
			});
		} catch {
			return dateStr;
		}
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="text-muted-foreground">Loading virtual keys...</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Virtual Keys</h1>
					<p className="text-muted-foreground">Manage your API virtual keys for accessing the gateway.</p>
				</div>
				<Dialog open={createOpen} onOpenChange={setCreateOpen}>
					<DialogTrigger asChild>
						<Button>
							<Plus className="mr-2 h-4 w-4" />
							Create Virtual Key
						</Button>
					</DialogTrigger>
					<DialogContent className="sm:max-w-[425px]">
						<DialogHeader>
							<DialogTitle>Create Virtual Key</DialogTitle>
						</DialogHeader>
						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="vk-name">Name</Label>
								<Input
									id="vk-name"
									placeholder="My API Key"
									value={newName}
									onChange={(e) => setNewName(e.target.value)}
									disabled={isCreating}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="vk-description">
									Description <span className="text-muted-foreground font-normal">(optional)</span>
								</Label>
								<Input
									id="vk-description"
									placeholder="What this key is used for"
									value={newDesc}
									onChange={(e) => setNewDesc(e.target.value)}
									disabled={isCreating}
								/>
							</div>
						</div>
						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={() => setCreateOpen(false)} disabled={isCreating}>
								Cancel
							</Button>
							<Button onClick={handleCreate} disabled={isCreating}>
								{isCreating ? "Creating..." : "Create"}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</div>

			{/* Table */}
			{virtualKeys && virtualKeys.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
					<p className="text-muted-foreground mb-4">No virtual keys yet.</p>
					<Button variant="outline" onClick={() => setCreateOpen(true)}>
						<Plus className="mr-2 h-4 w-4" />
						Create your first key
					</Button>
				</div>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Key Value</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Created</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{virtualKeys?.map((vk) => {
								const isRevealed = showKeys[vk.id] ?? false;
								return (
									<TableRow key={vk.id}>
										<TableCell className="font-medium">{vk.name}</TableCell>
										<TableCell>
											<div className="flex items-center gap-1.5">
												<code className="bg-muted inline-block max-w-[240px] truncate rounded px-1.5 py-0.5 font-mono text-xs">
													{maskKey(vk.value, isRevealed)}
												</code>
												<Button
													variant="ghost"
													size="sm"
													className="h-7 w-7 p-0"
													onClick={() => toggleKeyVisibility(vk.id)}
													title={isRevealed ? "Hide key" : "Reveal key"}
												>
													{isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
												</Button>
												<Button
													variant="ghost"
													size="sm"
													className="h-7 w-7 p-0"
													onClick={() => copyToClipboard(vk.value)}
													title="Copy key"
												>
													<Copy className="h-3.5 w-3.5" />
												</Button>
											</div>
										</TableCell>
										<TableCell>
											<Badge variant={vk.is_active ? "default" : "secondary"}>{vk.is_active ? "Active" : "Inactive"}</Badge>
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">{formatDate(vk.created_at)}</TableCell>
										<TableCell className="text-right">
											<div className="flex items-center justify-end gap-1">
												<Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditDialog(vk)} title="Edit key">
													<Pencil className="h-4 w-4" />
												</Button>
												<AlertDialog>
													<AlertDialogTrigger asChild>
														<Button
															variant="ghost"
															size="sm"
															className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 w-8 p-0"
															disabled={isDeleting}
															title="Delete key"
														>
															<Trash2 className="h-4 w-4" />
														</Button>
													</AlertDialogTrigger>
													<AlertDialogContent>
														<AlertDialogHeader>
															<AlertDialogTitle>Delete Virtual Key</AlertDialogTitle>
															<AlertDialogDescription>
																Are you sure you want to delete &quot;
																{vk.name}
																&quot;? This action cannot be undone.
															</AlertDialogDescription>
														</AlertDialogHeader>
														<AlertDialogFooter>
															<AlertDialogCancel>Cancel</AlertDialogCancel>
															<AlertDialogAction onClick={() => handleDelete(vk.id)} className="bg-destructive hover:bg-destructive/90">
																Delete
															</AlertDialogAction>
														</AlertDialogFooter>
													</AlertDialogContent>
												</AlertDialog>
											</div>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</div>
			)}

			{/* Edit Dialog */}
			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent className="sm:max-w-[425px]">
					<DialogHeader>
						<DialogTitle>Edit Virtual Key</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="edit-vk-name">Name</Label>
							<Input
								id="edit-vk-name"
								placeholder="My API Key"
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
								disabled={isUpdating}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-vk-description">
								Description <span className="text-muted-foreground font-normal">(optional)</span>
							</Label>
							<Input
								id="edit-vk-description"
								placeholder="What this key is used for"
								value={editDesc}
								onChange={(e) => setEditDesc(e.target.value)}
								disabled={isUpdating}
							/>
						</div>
						<div className="flex items-center justify-between rounded-lg border p-3">
							<div className="space-y-0.5">
								<Label htmlFor="edit-vk-active" className="cursor-pointer">
									Active Status
								</Label>
								<p id="edit-vk-active-desc" className="text-muted-foreground text-xs">
									{editActive ? "Key is enabled and can be used" : "Key is disabled and cannot be used"}
								</p>
							</div>
							<Switch
								id="edit-vk-active"
								aria-describedby="edit-vk-active-desc"
								checked={editActive}
								onCheckedChange={setEditActive}
								disabled={isUpdating}
							/>
						</div>
					</div>
					<DialogFooter>
						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={() => setEditOpen(false)} disabled={isUpdating}>
								Cancel
							</Button>
							<Button onClick={handleUpdate} disabled={isUpdating}>
								{isUpdating ? "Saving..." : "Save Changes"}
							</Button>
						</div>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}