import { useState } from "react";
import type { ProviderKeyItem } from "@/lib/platform/platformApi";
import { usePlatformAdminDeleteProviderKeyMutation, usePlatformAdminUpdateProviderKeyMutation } from "@/lib/platform/platformApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, KeyRound, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

interface ProviderKeysSectionProps {
	keys: ProviderKeyItem[];
	isLoading: boolean;
	providerName: string;
	onCreateKey: () => void;
	onEditKey: (key: ProviderKeyItem) => void;
}

function StatusBadge({ status }: { status: string }) {
	if (status === "active") {
		return (
			<Badge variant="default" className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10">
				<CheckCircle className="mr-1 h-3 w-3" />
				Active
			</Badge>
		);
	}
	if (status === "error" || status === "failed") {
		return (
			<Badge variant="destructive" className="bg-red-500/10 hover:bg-red-500/10">
				<XCircle className="mr-1 h-3 w-3" />
				Error
			</Badge>
		);
	}
	return <Badge variant="secondary">{status || "Unknown"}</Badge>;
}

export function ProviderKeysSection({ keys, isLoading, providerName, onCreateKey, onEditKey }: ProviderKeysSectionProps) {
	const [deleteKey] = usePlatformAdminDeleteProviderKeyMutation();
	const [updateKey] = usePlatformAdminUpdateProviderKeyMutation();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [deletingKey, setDeletingKey] = useState<ProviderKeyItem | null>(null);
	const [togglingKeyId, setTogglingKeyId] = useState<string | null>(null);

	const handleToggleEnabled = async (key: ProviderKeyItem) => {
		setTogglingKeyId(key.id);
		try {
			await updateKey({
				provider: providerName,
				id: key.id,
				enabled: !key.enabled,
			}).unwrap();
		} catch (err: any) {
			toast.error("Failed to toggle key", {
				description: err?.data?.message || err?.message || "Unknown error",
			});
		} finally {
			setTogglingKeyId(null);
		}
	};

	const handleDelete = async () => {
		if (!deletingKey) return;
		try {
			await deleteKey({ provider: providerName, id: deletingKey.id }).unwrap();
			toast.success("Key deleted");
			setDeleteDialogOpen(false);
			setDeletingKey(null);
		} catch {
			toast.error("Failed to delete key");
		}
	};

	const confirmDelete = (key: ProviderKeyItem) => {
		setDeletingKey(key);
		setDeleteDialogOpen(true);
	};

	if (isLoading) {
		return (
			<div className="space-y-3 px-6">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div className="bg-muted h-4 w-20 animate-pulse rounded" />
						<div className="bg-muted h-4 w-8 animate-pulse rounded" />
					</div>
					<div className="bg-muted h-8 w-24 animate-pulse rounded" />
				</div>
				{[...Array(3)].map((_, i) => (
					<div key={i} className="flex items-center gap-4">
						<div className="bg-muted h-4 w-32 animate-pulse rounded" />
						<div className="bg-muted h-4 w-24 animate-pulse rounded" />
						<div className="bg-muted h-4 w-16 animate-pulse rounded" />
						<div className="bg-muted h-4 w-16 animate-pulse rounded" />
					</div>
				))}
			</div>
		);
	}

	return (
		<div>
			<div className="flex items-center justify-between px-6 py-3">
				<div className="flex items-center gap-2 text-sm font-medium">
					<KeyRound className="h-4 w-4" />
					API Keys
					<Badge variant="secondary" className="text-xs">
						{keys.length}
					</Badge>
				</div>
				<Button size="sm" onClick={onCreateKey}>
					<Plus className="mr-1.5 h-3.5 w-3.5" />
					Add Key
				</Button>
			</div>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="text-xs">Name</TableHead>
						<TableHead className="text-xs">Description</TableHead>
						<TableHead className="text-xs">Status</TableHead>
						<TableHead className="text-xs">Weight</TableHead>
						<TableHead className="text-xs">Enabled</TableHead>
						<TableHead className="text-xs">Batch API</TableHead>
						<TableHead className="text-right text-xs">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{keys.length === 0 && (
						<TableRow>
							<TableCell colSpan={7} className="text-muted-foreground py-8 text-center text-sm">
								No keys configured. Add a key to start using this provider.
							</TableCell>
						</TableRow>
					)}
					{keys.map((key) => (
						<TableRow key={key.id}>
							<TableCell className="text-sm font-medium">{key.name}</TableCell>
							<TableCell className="text-muted-foreground max-w-[200px] truncate text-xs">{key.description || "—"}</TableCell>
							<TableCell>{key.status && <StatusBadge status={key.status} />}</TableCell>
							<TableCell className="text-xs">{key.weight ?? "—"}</TableCell>
							<TableCell>
								<Switch
									checked={key.enabled ?? true}
									onCheckedChange={() => handleToggleEnabled(key)}
									disabled={togglingKeyId === key.id}
								/>
							</TableCell>
							<TableCell>
								{key.use_for_batch_api ? (
									<Badge variant="outline" className="text-xs">
										Yes
									</Badge>
								) : (
									<span className="text-muted-foreground text-xs">No</span>
								)}
							</TableCell>
							<TableCell className="text-right">
								<div className="flex items-center justify-end gap-1">
									<Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => onEditKey(key)}>
										<Pencil className="h-3.5 w-3.5" />
										Edit
									</Button>
									<Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => confirmDelete(key)}>
										<Trash2 className="text-destructive h-3.5 w-3.5" />
										Delete
									</Button>
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>

			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent disableOutsideClick={false}>
					<DialogHeader>
						<DialogTitle>Delete Key</DialogTitle>
						<DialogDescription>Delete key &quot;{deletingKey?.name || deletingKey?.id}&quot;? This cannot be undone.</DialogDescription>
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