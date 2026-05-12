import { useState } from "react";
import type { ProviderResponse } from "@/lib/platform/platformApi";
import { usePlatformAdminCreateProviderMutation } from "@/lib/platform/platformApi";
import { RenderProviderIcon, type ProviderIconType } from "@/lib/constants/icons";
import { ProviderLabels, ProviderNames } from "@/lib/constants/logs";
import { AddProviderDropdown, type ProviderOption } from "@/app/workspace/providers/views/addProviderDropdown";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scrollArea";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Server, Search, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ProviderSidebarProps {
	providers: ProviderResponse[];
	selectedProvider: string;
	onSelectProvider: (name: string) => void;
	onProviderCreated?: (name: string) => void;
	onAddCustomProvider?: () => void;
	refetchProviders?: () => void;
}

function statusColor(status: string) {
	if (status === "active") return "bg-emerald-500";
	if (status === "error" || status === "list_models_failed") return "bg-red-500";
	return "bg-yellow-500";
}

function statusLabel(status: string) {
	if (status === "active") return "Active";
	if (status === "error") return "Error";
	if (status === "list_models_failed") return "Discovery Failed";
	if (status === "deleted") return "Deleted";
	return status;
}

export function ProviderSidebar({
	providers,
	selectedProvider,
	onSelectProvider,
	onProviderCreated,
	onAddCustomProvider,
	refetchProviders,
}: ProviderSidebarProps) {
	const [search, setSearch] = useState("");
	const [createProvider] = usePlatformAdminCreateProviderMutation();

	const existingInSidebar = new Set(providers.map((p) => p.name));
	const knownProviders: ProviderOption[] = ProviderNames.map((name) => ({ name }));

	const filtered = providers.filter((p) => {
		if (!search) return true;
		const q = search.toLowerCase();
		const isKnown = ProviderNames.includes(p.name as (typeof ProviderNames)[number]);
		const label = isKnown ? ProviderLabels[p.name as keyof typeof ProviderLabels] : p.name;
		return label.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
	});

	const handleSelectKnownProvider = async (name: string) => {
		try {
			await createProvider({ provider: name }).unwrap();
			refetchProviders?.();
			onProviderCreated?.(name);
		} catch (err: any) {
			if (err?.status === 409) {
				refetchProviders?.();
				onProviderCreated?.(name);
				return;
			}
			toast.error("Failed to add provider", { description: err?.data?.message || err?.message || "Unknown error" });
		}
	};

	const handleAddCustomProvider = () => {
		onAddCustomProvider?.();
	};

	return (
		<div className="bg-muted/30 flex w-72 shrink-0 flex-col border-r">
			<div className="flex items-center gap-2 border-b px-4 py-3">
				<Server className="text-muted-foreground h-4 w-4" />
				<span className="text-sm font-semibold">Providers</span>
				<Badge variant="secondary" className="ml-auto text-xs">
					{providers.length}
				</Badge>
			</div>
			<div className="px-3 py-2">
				<div className="relative">
					<Search className="text-muted-foreground absolute top-2.5 left-2.5 h-3.5 w-3.5" />
					<Input
						placeholder="Search providers..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="h-8 pl-8 text-sm"
					/>
				</div>
			</div>
			<TooltipProvider>
				<ScrollArea className="flex-1">
					<div className="space-y-0.5 p-2">
						{filtered.length === 0 && <div className="text-muted-foreground px-2 py-6 text-center text-sm">No providers found</div>}
						{filtered.map((provider) => {
							const isKnown = ProviderNames.includes(provider.name as (typeof ProviderNames)[number]);
							const label = isKnown ? ProviderLabels[provider.name as keyof typeof ProviderLabels] : provider.name;
							const isActive = selectedProvider === provider.name;
							const hasIssue = provider.provider_status !== "active";
							// Icon: use name if known, otherwise fall back to base_provider_type
							const iconProvider = isKnown ? provider.name : (provider.custom_provider_config?.base_provider_type ?? provider.name);

							return (
								<Tooltip key={provider.name}>
									<TooltipTrigger asChild>
										<button
											onClick={() => onSelectProvider(provider.name)}
											className={cn(
												"flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors",
												isActive
													? "border-primary/50 bg-primary/10 font-medium ring-1 ring-primary/20"
													: "hover:bg-muted border border-transparent",
											)}
										>
											<RenderProviderIcon provider={iconProvider as ProviderIconType} size="sm" className="h-4 w-4 shrink-0" />
											<span className="min-w-0 flex-1 truncate">{label}</span>
											{!isKnown && (
												<Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px]">
													CUSTOM
												</Badge>
											)}
											{hasIssue && <span className={cn("h-2 w-2 shrink-0 rounded-full", statusColor(provider.provider_status))} />}
										</button>
									</TooltipTrigger>
									<TooltipContent side="right">{hasIssue ? statusLabel(provider.provider_status) : label}</TooltipContent>
								</Tooltip>
							);
						})}
						<div className="pt-2">
							<AddProviderDropdown
								existingInSidebar={existingInSidebar}
								knownProviders={knownProviders}
								onSelectKnownProvider={handleSelectKnownProvider}
								onAddCustomProvider={handleAddCustomProvider}
							/>
						</div>
					</div>
				</ScrollArea>
			</TooltipProvider>
		</div>
	);
}