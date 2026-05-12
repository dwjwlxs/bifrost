import { useState } from "react";
import {
	usePlatformAdminListProvidersQuery,
	usePlatformAdminListProviderKeysQuery,
	usePlatformAdminListProviderModelsQuery,
	usePlatformAdminDeleteProviderMutation,
} from "@/lib/platform/platformApi";
import type { ProviderKeyItem } from "@/lib/platform/platformApi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { KeyRound, Cpu } from "lucide-react";
import { ProviderSidebar } from "./views/providerSidebar";
import { ProviderHeader } from "./views/providerHeader";
import { ProviderConfigSheet } from "./views/providerConfigSheet";
import { ProviderKeySheet } from "./views/providerKeySheet";
import { CustomProviderSheet } from "./views/customProviderSheet";
import { ProviderKeysSection } from "./views/providerKeysSection";
import { ProviderModelsSection } from "./views/providerModelsSection";

export default function ProvidersPage() {
	const { data: providersData, isLoading: loadingProviders, refetch } = usePlatformAdminListProvidersQuery();
	const providers = providersData?.providers ?? [];

	const [selectedProvider, setSelectedProvider] = useState("");
	// Auto-select first provider when data loads
	const activeProvider = selectedProvider || (providers.length > 0 ? providers[0].name : "");
	const currentProvider = providers.find((p) => p.name === activeProvider);

	const { data: keysData, isLoading: loadingKeys } = usePlatformAdminListProviderKeysQuery(activeProvider, { skip: !activeProvider });
	const { data: modelsData, isLoading: loadingModels } = usePlatformAdminListProviderModelsQuery(activeProvider, { skip: !activeProvider });

	const keys = keysData?.items ?? [];
	const models = modelsData?.items?.map((m) => m.name) ?? [];

	// Sheet states
	const [configSheetOpen, setConfigSheetOpen] = useState(false);
	const [keySheetOpen, setKeySheetOpen] = useState(false);
	const [customProviderSheetOpen, setCustomProviderSheetOpen] = useState(false);
	const [editingKey, setEditingKey] = useState<ProviderKeyItem | null>(null);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

	const [deleteProvider, { isLoading: isDeletingProvider }] = usePlatformAdminDeleteProviderMutation();

	const handleSelectProvider = (name: string) => {
		setSelectedProvider(name);
	};

	const handleProviderCreated = (name: string) => {
		setSelectedProvider(name);
	};

	const handleAddCustomProvider = () => {
		setCustomProviderSheetOpen(true);
	};

	const handleEditConfig = () => {
		if (!currentProvider) return;
		setConfigSheetOpen(true);
	};

	const handleCreateKey = () => {
		setEditingKey(null);
		setKeySheetOpen(true);
	};

	const handleEditKey = (key: ProviderKeyItem) => {
		setEditingKey(key);
		setKeySheetOpen(true);
	};

	const handleDeleteProvider = () => {
		if (!currentProvider) return;
		deleteProvider(activeProvider)
			.unwrap()
			.then(() => {
				setDeleteDialogOpen(false);
				const remaining = providers.filter((p) => p.name !== activeProvider);
				if (remaining.length > 0) {
					setSelectedProvider(remaining[0].name);
				} else {
					setSelectedProvider("");
				}
			})
			.catch((err) => {
				toast.error("Failed to delete provider", {
					description: err?.data?.message || err?.message || "Unknown error",
				});
			});
	};

	if (loadingProviders) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="flex flex-col items-center gap-3">
					<div className="bg-muted h-8 w-8 animate-pulse rounded" />
					<p className="text-muted-foreground text-sm">Loading providers...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-[calc(100vh-4rem)] overflow-hidden">
			{/* Left sidebar: Provider list */}
			<ProviderSidebar
				providers={providers}
				selectedProvider={activeProvider}
				onSelectProvider={handleSelectProvider}
				onProviderCreated={handleProviderCreated}
				onAddCustomProvider={handleAddCustomProvider}
				refetchProviders={refetch}
			/>

			{/* Right: Provider detail */}
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
				{!currentProvider ? (
					<div className="text-muted-foreground flex h-full items-center justify-center text-sm">Select a provider to view details</div>
				) : (
					<>
						<ProviderHeader provider={currentProvider} onEditConfig={handleEditConfig} onDeleteProvider={() => setDeleteDialogOpen(true)} />

						<Tabs defaultValue="keys" className="flex min-h-0 flex-1 flex-col">
							<TabsList className="mx-6 mt-3 w-fit">
								<TabsTrigger value="keys" className="text-xs">
									<KeyRound className="mr-1.5 h-3 w-3" />
									Keys ({keys.length})
								</TabsTrigger>
								<TabsTrigger value="models" className="text-xs">
									<Cpu className="mr-1.5 h-3 w-3" />
									Models ({models.length})
								</TabsTrigger>
							</TabsList>

							<TabsContent value="keys" className="mt-0 min-h-0 flex-1 overflow-y-auto">
								<ProviderKeysSection
									keys={keys}
									isLoading={loadingKeys}
									providerName={activeProvider}
									onCreateKey={handleCreateKey}
									onEditKey={handleEditKey}
								/>
							</TabsContent>

							<TabsContent value="models" className="mt-0 min-h-0 flex-1 overflow-y-auto">
								<ProviderModelsSection models={models} isLoading={loadingModels} providerName={activeProvider} />
							</TabsContent>
						</Tabs>
					</>
				)}
			</div>

			{/* Sheets */}
			{currentProvider && (
				<ProviderConfigSheet
					open={configSheetOpen}
					onOpenChange={setConfigSheetOpen}
					providerName={activeProvider}
					provider={currentProvider}
				/>
			)}
			<ProviderKeySheet open={keySheetOpen} onOpenChange={setKeySheetOpen} providerName={activeProvider} editingKey={editingKey} />
			<CustomProviderSheet
				open={customProviderSheetOpen}
				onOpenChange={setCustomProviderSheetOpen}
				onCreated={(name) => {
					refetch();
					setSelectedProvider(name);
				}}
			/>

			{/* Delete confirmation dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Provider</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete provider "{currentProvider?.name}"? This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isDeletingProvider}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleDeleteProvider} disabled={isDeletingProvider}>
							{isDeletingProvider ? "Deleting..." : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}