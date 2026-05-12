"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alertDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { ModelPriceSheet } from "./views/ModelPriceSheet";
import {
	usePlatformAdminListModelPricesQuery,
	usePlatformAdminDeleteModelPriceMutation,
} from "@//lib/platform/endpoints/billing";
import type { PricingOverride } from "@//lib/types/governance";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Edit, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useState } from "react";

const PAGE_SIZE = 20;

/** 人类可读的 scope_kind 标签 */
const SCOPE_LABELS: Record<string, string> = {
	global: "Global",
	provider: "Provider",
	provider_key: "Provider Key",
	virtual_key: "Virtual Key",
	virtual_key_provider: "VK + Provider",
	virtual_key_provider_key: "VK + Key",
};

export default function ModelPricesPage() {
	const [page, setPage] = useState(0);
	const [searchFilter, setSearchFilter] = useState("");
	const [scopeFilter, setScopeFilter] = useState<string>("");
	const [sheetOpen, setSheetOpen] = useState(false);
	const [editingOverride, setEditingOverride] = useState<PricingOverride | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<PricingOverride | null>(null);

	// ---- Delete mutation ----
	const [deleteMutation, { isLoading: isDeleting }] =
		usePlatformAdminDeleteModelPriceMutation();

	const handleDeleteConfirm = async () => {
		if (!deleteTarget) return;
		try {
			await deleteMutation(deleteTarget.id).unwrap();
			toast.success("Pricing override deleted");
			setDeleteTarget(null);
			refetch();
		} catch (err: unknown) {
			const msg = (err as { data?: { message?: string } })?.data?.message ?? "Delete failed";
			toast.error(msg);
		}
	};

	const offset = page * PAGE_SIZE;

	const { data, isLoading, isFetching, refetch } =
		usePlatformAdminListModelPricesQuery({
			offset,
			limit: PAGE_SIZE,
			search: searchFilter || undefined,
			scope_kind: scopeFilter || undefined,
		});

	const items = data?.items ?? [];
	const total = data?.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	const handleAdd = () => {
		setEditingOverride(null);
		setSheetOpen(true);
	};

	const handleEdit = (override: PricingOverride) => {
		setEditingOverride(override);
		setSheetOpen(true);
	};

	const handleSheetClose = (open: boolean) => {
		setSheetOpen(open);
		if (!open) setEditingOverride(null);
	};

	const handleSearchChange = (val: string) => {
		setSearchFilter(val);
		setPage(0);
	};

	const handleScopeChange = (val: string) => {
		setScopeFilter(val);
		setPage(0);
	};

	const clearFilters = () => {
		setSearchFilter("");
		setScopeFilter("");
		setPage(0);
	};

	const hasFilters = searchFilter || scopeFilter;

	return (
		<div className="flex flex-col gap-4">
			{/* Header */}
			<div>
				<h1 className="text-2xl font-semibold">Model Price Management</h1>
				<p className="text-muted-foreground text-sm">
					Configure pricing overrides for model cost calculation.
				</p>
			</div>

			{/* Toolbar */}
			<div className="flex items-center justify-between gap-3">
				<Button
					data-testid="admin-model-prices-create-btn"
					onClick={handleAdd}
					className="gap-2"
				>
					<Plus className="h-4 w-4" />
					Add Override
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={() => refetch()}
					disabled={isFetching}
				>
					<RefreshCw className="h-4 w-4" />
					Refresh
				</Button>
			</div>

			{/* Filters */}
			<div className="flex items-center gap-3">
				<div className="relative flex-1">
					<Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
					<Input
						placeholder="Search by name or pattern..."
						value={searchFilter}
						onChange={(e) => handleSearchChange(e.target.value)}
						className="pl-9"
					/>
				</div>
				<select
					value={scopeFilter}
					onChange={(e) => handleScopeChange(e.target.value)}
					className="border rounded-md px-3 py-2 text-sm bg-background"
				>
					<option value="">All Scopes</option>
					<option value="global">Global</option>
					<option value="provider">Provider</option>
					<option value="provider_key">Provider Key</option>
					<option value="virtual_key">Virtual Key</option>
					<option value="virtual_key_provider">VK + Provider</option>
					<option value="virtual_key_provider_key">VK + Key</option>
				</select>
				{hasFilters && (
					<Button
						variant="ghost"
						size="sm"
						onClick={clearFilters}
					>
						<X className="h-4 w-4" />
						Clear
					</Button>
				)}
			</div>

			{/* Table */}
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow className="bg-muted/50">
							<TableHead className="font-semibold">Name</TableHead>
							<TableHead className="font-semibold">Scope</TableHead>
							<TableHead className="font-semibold">Model Pattern</TableHead>
							<TableHead className="font-semibold">Match</TableHead>
							<TableHead className="font-semibold">Request Types</TableHead>
							<TableHead className="w-[100px] text-right font-semibold">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							Array.from({ length: PAGE_SIZE }).map((_, i) => (
								<TableRow key={i}>
									<TableCell><Skeleton className="h-4 w-full" /></TableCell>
									<TableCell><Skeleton className="h-4 w-16" /></TableCell>
									<TableCell><Skeleton className="h-4 w-32" /></TableCell>
									<TableCell><Skeleton className="h-4 w-16" /></TableCell>
									<TableCell><Skeleton className="h-4 w-20" /></TableCell>
									<TableCell><Skeleton className="h-4 w-16" /></TableCell>
								</TableRow>
							))
						) : items.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
									{hasFilters ? "No pricing overrides match the current filters." : "No pricing overrides yet. Click \"Add Override\" to create one."}
								</TableCell>
							</TableRow>
						) : (
							items.map((item) => (
								<TableRow key={item.id}>
									<TableCell className="font-medium">{item.name || "-"}</TableCell>
									<TableCell>
										<Badge variant="secondary">
											{SCOPE_LABELS[item.scope_kind] ?? item.scope_kind}
										</Badge>
									</TableCell>
									<TableCell className="font-mono text-xs">{item.pattern}</TableCell>
									<TableCell>
										<Badge variant="outline" className="text-xs">
											{item.match_type}
										</Badge>
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{item.request_types?.join(", ") ?? "all"}
									</TableCell>
									<TableCell className="text-right">
										<div className="flex items-center justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => handleEdit(item)}
												aria-label="Edit pricing override"
											>
												<Edit className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												className="text-destructive"
												onClick={() => setDeleteTarget(item)}
												aria-label="Delete pricing override"
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{/* Pagination */}
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">
					{isLoading
						? "Loading..."
						: `${total} record${total !== 1 ? "s" : ""} total`}
				</p>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setPage((p) => Math.max(0, p - 1))}
						disabled={page === 0 || isLoading}
					>
						<ChevronLeft className="mr-1 h-4 w-4" />
						Prev
					</Button>
					<span className="text-muted-foreground text-sm">
						{page + 1} / {totalPages}
					</span>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setPage((p) => p + 1)}
						disabled={page >= totalPages - 1 || isLoading}
					>
						Next
						<ChevronRight className="ml-1 h-4 w-4" />
					</Button>
				</div>
			</div>

			{/* Create / Edit Sheet */}
			<ModelPriceSheet
				open={sheetOpen}
				onOpenChange={handleSheetClose}
				editingOverride={editingOverride}
				onSaved={() => {
					refetch();
				}}
			/>

			{/* Delete confirmation */}
			<AlertDialog open={!!deleteTarget} onOpenChange={(open) => (!open ? setDeleteTarget(null) : undefined)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Pricing Override</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeleting}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={(e) => {
								e.preventDefault();
								void handleDeleteConfirm();
							}}
							disabled={isDeleting}
							className="bg-destructive hover:bg-destructive/90"
						>
							{isDeleting ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
