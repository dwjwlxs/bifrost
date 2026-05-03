import { useState } from "react";
import {
	usePlatformListVKsQuery,
	usePlatformCreateVKMutation,
	usePlatformUpdateVKMutation,
	usePlatformDeleteVKMutation,
	usePlatformListTeamsQuery,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Copy, Trash2, Eye, EyeOff, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { PlatformVirtualKey } from "@/lib/platform/platformApi";

export default function VirtualKeysPage() {
	const { data: virtualKeys, isLoading } = usePlatformListVKsQuery();
	const { data: teams } = usePlatformListTeamsQuery();
	const [createVK, { isLoading: isCreating }] = usePlatformCreateVKMutation();
	const [updateVK, { isLoading: isUpdating }] = usePlatformUpdateVKMutation();
	const [deleteVK, { isLoading: isDeleting }] = usePlatformDeleteVKMutation();

	const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
	const [createOpen, setCreateOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);

	// Create form state
	const [newName, setNewName] = useState("");
	const [newDesc, setNewDesc] = useState("");
	const [newTeamId, setNewTeamId] = useState<string>("");
	const [newBudgetLimit, setNewBudgetLimit] = useState<string>("0");
	const [newBudgetResetDuration, setNewBudgetResetDuration] = useState<string>("1h");

	// Edit form state
	const [editingVK, setEditingVK] = useState<PlatformVirtualKey | null>(null);
	const [editName, setEditName] = useState("");
	const [editDesc, setEditDesc] = useState("");
	const [editActive, setEditActive] = useState(true);
	const [editBudgetLimit, setEditBudgetLimit] = useState<string>("");
	const [editBudgetResetDuration, setEditBudgetResetDuration] = useState<string>("");

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
		setEditBudgetLimit(vk.budget_limit?.toString() || "");
		setEditBudgetResetDuration(vk.budget_reset_duration || "1h");
		setEditOpen(true);
	};

	const handleCreate = async () => {
		if (!newName.trim()) {
			toast.error("Name is required");
			return;
		}
		try {
			const payload: any = {
				name: newName.trim(),
				description: newDesc.trim() || undefined,
				team_id: newTeamId || undefined,
			};

			// Add budget limit if provided (0 means unlimited, skip it)
			if (newBudgetLimit.trim() && newBudgetLimit !== "0") {
				const budgetValue = parseFloat(newBudgetLimit);
				if (!isNaN(budgetValue) && budgetValue >= 0) {
					payload.budget_limit = budgetValue;
				}
			}

			// Add budget reset duration if provided and not "1h"
			if (newBudgetResetDuration.trim() && newBudgetResetDuration !== "1h") {
				payload.budget_reset_duration = newBudgetResetDuration;
			}

			await createVK(payload).unwrap();
			toast.success("Virtual key created successfully");
			setCreateOpen(false);
			setNewName("");
			setNewDesc("");
			setNewTeamId("");
			setNewBudgetLimit("0");
			setNewBudgetResetDuration("1h");
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
			const data: any = {
				name: editName.trim(),
				description: editDesc.trim() || undefined,
				is_active: editActive,
			};

			// Add budget limit if provided (0 means unlimited, skip it)
			if (editBudgetLimit.trim() && editBudgetLimit !== "0") {
				const budgetValue = parseFloat(editBudgetLimit);
				if (!isNaN(budgetValue) && budgetValue >= 0) {
					data.budget_limit = budgetValue;
				}
			} else if (editBudgetLimit === "" || editBudgetLimit === "0") {
				data.budget_limit = undefined;
			}

			// Add budget reset duration if provided and not "1h"
			if (editBudgetResetDuration.trim() && editBudgetResetDuration !== "1h") {
				data.budget_reset_duration = editBudgetResetDuration;
			} else if (editBudgetResetDuration === "" || editBudgetResetDuration === "1h") {
				data.budget_reset_duration = undefined;
			}

			await updateVK({
				id: editingVK.id,
				data,
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
							{teams && teams.length > 0 && (
								<div className="space-y-2">
									<Label htmlFor="vk-team">
										Team <span className="text-muted-foreground font-normal">(optional)</span>
									</Label>
									<select
										id="vk-team"
										className="border-input placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
										value={newTeamId}
										onChange={(e) => setNewTeamId(e.target.value)}
										disabled={isCreating}
									>
										<option value="">Personal (no team)</option>
										{teams.map((team) => (
											<option key={team.id} value={team.id}>
												{team.name}
											</option>
										))}
						</select>
					</div>
				)}

				{/* Budget limit */}
				<div className="space-y-2">
					<Label htmlFor="vk-budget">
						Budget Limit (USD) <span className="text-muted-foreground font-normal">(optional)</span>
					</Label>
					<Input
						id="vk-budget"
						type="number"
						min="0"
						step="0.01"
						placeholder="100.00 (0 or empty = no limit)"
						value={newBudgetLimit}
						onChange={(e) => setNewBudgetLimit(e.target.value)}
						disabled={isCreating}
					/>
					<p className="text-muted-foreground text-xs">
						Set to a positive number for a budget limit.
					</p>
				</div>

				{/* Budget reset duration */}
				<div className="space-y-2">
					<Label htmlFor="vk-reset-duration">
						Budget Reset Duration <span className="text-muted-foreground font-normal">(optional)</span>
					</Label>
					<Select
						value={newBudgetResetDuration}
						onValueChange={setNewBudgetResetDuration}
						disabled={isCreating}
					>
						<SelectTrigger id="vk-reset-duration">
							<SelectValue placeholder="Select reset period (e.g., '1M' for monthly)" />
						</SelectTrigger>
						<SelectContent>
						<SelectItem value="none">No reset (one-time budget)</SelectItem>
								<SelectItem value="1h">Hourly</SelectItem>
								<SelectItem value="1D">Daily</SelectItem>
							<SelectItem value="1W">Weekly</SelectItem>
							<SelectItem value="2W">Bi-weekly</SelectItem>
							<SelectItem value="1M">Monthly</SelectItem>
							<SelectItem value="3M">Quarterly</SelectItem>
							<SelectItem value="1Y">Yearly</SelectItem>
						</SelectContent>
					</Select>
					<p className="text-muted-foreground text-xs">
						Examples: "1D" (daily), "1W" (weekly), "1M" (monthly)
					</p>
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
								<TableHead>Team</TableHead>
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
											<Badge variant={vk.team_id ? "outline" : "secondary"}>
												{vk.team_id ? (teams?.find((t) => t.id === vk.team_id)?.name ?? vk.team_id) : "Personal"}
											</Badge>
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

				{/* Budget limit */}
				<div className="space-y-2">
					<Label htmlFor="edit-vk-budget">
						Budget Limit (USD) <span className="text-muted-foreground font-normal">(optional)</span>
					</Label>
					<Input
						id="edit-vk-budget"
						type="number"
						min="0"
						step="0.01"
						placeholder="100.00 (0 or empty = no limit)"
						value={editBudgetLimit}
						onChange={(e) => setEditBudgetLimit(e.target.value)}
						disabled={isUpdating}
					/>
					<p className="text-muted-foreground text-xs">
						Set to a positive number for a budget limit.
					</p>
				</div>

				{/* Budget reset duration */}
				<div className="space-y-2">
					<Label htmlFor="edit-vk-reset-duration">
						Budget Reset Duration <span className="text-muted-foreground font-normal">(optional)</span>
					</Label>
					<Select
						value={editBudgetResetDuration}
						onValueChange={setEditBudgetResetDuration}
						disabled={isUpdating}
					>
						<SelectTrigger id="edit-vk-reset-duration">
							<SelectValue placeholder="Select reset period (e.g., '1M' for monthly)" />
						</SelectTrigger>
						<SelectContent>
						<SelectItem value="none">No reset (one-time budget)</SelectItem>
								<SelectItem value="1h">Hourly</SelectItem>
								<SelectItem value="1D">Daily</SelectItem>
							<SelectItem value="1W">Weekly</SelectItem>
							<SelectItem value="2W">Bi-weekly</SelectItem>
							<SelectItem value="1M">Monthly</SelectItem>
							<SelectItem value="3M">Quarterly</SelectItem>
							<SelectItem value="1Y">Yearly</SelectItem>
						</SelectContent>
					</Select>
					<p className="text-muted-foreground text-xs">
						Examples: "1D" (daily), "1W" (weekly), "1M" (monthly)
					</p>
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