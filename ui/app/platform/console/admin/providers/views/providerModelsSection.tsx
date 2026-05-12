import { useState } from "react";
import { usePlatformAdminAddProviderModelMutation } from "@/lib/platform/platformApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Cpu, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";

interface ProviderModelsSectionProps {
	models: string[];
	isLoading: boolean;
	providerName: string;
}

export function ProviderModelsSection({ models, isLoading, providerName }: ProviderModelsSectionProps) {
	const [addModel] = usePlatformAdminAddProviderModelMutation();
	const [search, setSearch] = useState("");
	const [newModelName, setNewModelName] = useState("");
	const [isAdding, setIsAdding] = useState(false);

	const filtered = search ? models.filter((m) => m.toLowerCase().includes(search.toLowerCase())) : models;

	const handleAddModel = async () => {
		const name = newModelName.trim();
		if (!name) return;
		try {
			await addModel({ provider: providerName, model: name }).unwrap();
			toast.success("Model added");
			setNewModelName("");
			setIsAdding(false);
		} catch {
			toast.error("Failed to add model");
		}
	};

	if (isLoading) {
		return (
			<div className="space-y-3 px-6">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div className="bg-muted h-4 w-20 animate-pulse rounded" />
						<div className="bg-muted h-4 w-8 animate-pulse rounded" />
					</div>
				</div>
				<div className="flex flex-wrap gap-1.5">
					{[...Array(6)].map((_, i) => (
						<div key={i} className="bg-muted h-5 w-20 animate-pulse rounded px-2 py-0.5" />
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="px-6 py-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2 text-sm font-medium">
					<Cpu className="h-4 w-4" />
					Models
					<Badge variant="secondary" className="text-xs">
						{models.length}
					</Badge>
				</div>
				<div className="flex items-center gap-2">
					{models.length > 5 && (
						<div className="relative">
							<Search className="text-muted-foreground absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2" />
							<Input
								placeholder="Filter models..."
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="h-7 w-40 pl-7 text-xs"
							/>
						</div>
					)}
					{!isAdding ? (
						<Button size="sm" variant="outline" onClick={() => setIsAdding(true)}>
							<Plus className="mr-1.5 h-3.5 w-3.5" />
							Add Model
						</Button>
					) : (
						<div className="flex items-center gap-1.5">
							<Input
								autoFocus
								placeholder="model-name"
								value={newModelName}
								onChange={(e) => setNewModelName(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleAddModel();
									if (e.key === "Escape") {
										setIsAdding(false);
										setNewModelName("");
									}
								}}
								className="h-7 w-40 text-xs"
							/>
							<Button size="sm" className="h-7 px-2" onClick={handleAddModel} disabled={!newModelName.trim()}>
								Add
							</Button>
							<Button
								size="sm"
								variant="outline"
								className="h-7 gap-1.5"
								onClick={() => {
									setIsAdding(false);
									setNewModelName("");
								}}
							>
								<X className="h-3.5 w-3.5" />
								Cancel
							</Button>
						</div>
					)}
				</div>
			</div>
			<div className="mt-3 flex flex-wrap gap-1.5">
				{filtered.length === 0 && (
					<p className="text-muted-foreground py-4 text-sm">{search ? "No models match your filter." : "No models configured."}</p>
				)}
				{filtered.map((model) => (
					<Badge key={model} variant="outline" className="px-2 py-0.5 text-xs font-normal">
						{model}
					</Badge>
				))}
			</div>
		</div>
	);
}