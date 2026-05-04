import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Copy, Eye, EyeOff, Settings } from "lucide-react";
import { toast } from "sonner";
import { PlatformVirtualKey, usePlatformListTeamVKsQuery } from "@/lib/platform/platformApi";
import { EditVKDialog } from "./EditVKDialog";

interface TeamVKsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	teamId: string;
	teamName: string;
	isTeamAdmin: boolean;
}

function VKRow({
	vk,
	isTeamAdmin,
	onEdit,
}: {
	vk: PlatformVirtualKey;
	isTeamAdmin: boolean;
	onEdit: (vk: PlatformVirtualKey) => void;
}) {
	const [revealed, setRevealed] = useState(false);

	const maskKey = (value: string) => {
		if (revealed) return value;
		if (value.length <= 8) return "\u2022".repeat(value.length);
		return value.substring(0, 8) + "\u2022".repeat(Math.max(0, value.length - 8));
	};

	const copyKey = (text: string) => {
		navigator.clipboard.writeText(text).then(
			() => toast.success("Key copied to clipboard"),
			() => toast.error("Failed to copy key"),
		);
	};

	const budgetPercent = vk.budget_limit && vk.budget_limit > 0 ? Math.min(((vk.current_usage ?? 0) / vk.budget_limit) * 100, 100) : null;

	return (
		<TableRow>
			<TableCell className="font-mono text-xs">{vk.id.slice(0, 8)}...</TableCell>
			<TableCell className="font-medium">{vk.name}</TableCell>
			<TableCell>
				<div className="flex items-center gap-1.5">
					<code className="bg-muted inline-block max-w-[200px] truncate rounded px-1.5 py-0.5 font-mono text-xs">{maskKey(vk.value)}</code>
					<button
						type="button"
						className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
						onClick={() => setRevealed(!revealed)}
						title={revealed ? "Hide key" : "Reveal key"}
					>
						{revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
					</button>
					<button
						type="button"
						className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
						onClick={() => copyKey(vk.value)}
						title="Copy key"
					>
						<Copy className="h-3.5 w-3.5" />
					</button>
				</div>
			</TableCell>
			<TableCell>
				{budgetPercent !== null ? (
					<div className="flex items-center gap-2">
						<div className="bg-muted h-2 w-20 overflow-hidden rounded-full">
							<div
								className={`h-full rounded-full transition-all ${budgetPercent > 90 ? "bg-destructive" : budgetPercent > 70 ? "bg-yellow-500" : "bg-primary"}`}
								style={{ width: `${budgetPercent}%` }}
							/>
						</div>
						<span className="text-muted-foreground text-xs">
							${(vk.current_usage ?? 0).toFixed(2)} / ${vk.budget_limit!.toFixed(2)}
						</span>
					</div>
				) : (
					<span className="text-muted-foreground text-xs">No budget</span>
				)}
			</TableCell>
			{isTeamAdmin && (
				<TableCell>
					<Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => onEdit(vk)}>
						<Settings className="h-3.5 w-3.5" />
						Edit
					</Button>
				</TableCell>
			)}
		</TableRow>
	);
}

export function TeamVKsDialog({ open, onOpenChange, teamId, teamName, isTeamAdmin }: TeamVKsDialogProps) {
	const { data: vks, isLoading, refetch } = usePlatformListTeamVKsQuery(teamId, { skip: !open });
	const [editingVK, setEditingVK] = useState<PlatformVirtualKey | null>(null);

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="sm:max-w-2xl" disableOutsideClick={false}>
					<DialogHeader>
						<DialogTitle>All Virtual Keys — {teamName}</DialogTitle>
						<DialogDescription>All virtual keys in this team. Only team admins can edit.</DialogDescription>
					</DialogHeader>

					{isLoading ? (
						<div className="text-muted-foreground py-8 text-center text-sm">Loading virtual keys...</div>
					) : vks && vks.length > 0 ? (
						<div className="overflow-hidden rounded-md border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="text-xs">ID</TableHead>
										<TableHead className="text-xs">Name</TableHead>
										<TableHead className="text-xs">Key</TableHead>
										<TableHead className="text-xs">Budget</TableHead>
										{isTeamAdmin && <TableHead className="text-xs">Actions</TableHead>}
									</TableRow>
								</TableHeader>
								<TableBody>
									{vks.map((vk) => (
										<VKRow key={vk.id} vk={vk} isTeamAdmin={isTeamAdmin} onEdit={setEditingVK} />
									))}
								</TableBody>
							</Table>
						</div>
					) : (
						<div className="text-muted-foreground py-8 text-center text-sm">No virtual keys in this team.</div>
					)}
				</DialogContent>
			</Dialog>

			<EditVKDialog
				open={editingVK !== null}
				onOpenChange={(open) => {
					if (!open) setEditingVK(null);
				}}
				vk={editingVK}
				teamId={teamId}
				onUpdated={refetch}
			/>
		</>
	);
}
