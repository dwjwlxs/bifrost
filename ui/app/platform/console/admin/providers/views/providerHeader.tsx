import type { ProviderResponse } from "@/lib/platform/platformApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Globe, Gauge, Shield, Activity, SettingsIcon } from "lucide-react";

interface ProviderHeaderProps {
	provider: ProviderResponse;
	onEditConfig: () => void;
	onDeleteProvider: () => void;
}

export function ProviderHeader({ provider, onEditConfig, onDeleteProvider }: ProviderHeaderProps) {
	const nc = provider.network_config;
	const cc = provider.concurrency_and_buffer_size;
	const isActive = provider.provider_status === "active";

	return (
		<div className="flex flex-col gap-3 border-b px-6 py-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<h2 className="text-lg font-semibold">{provider.name}</h2>
					<Badge variant={isActive ? "default" : "destructive"} className="text-xs capitalize">
						{provider.provider_status}
					</Badge>
					{provider.custom_provider_config && (
						<Badge variant="outline" className="text-xs">
							Custom
						</Badge>
					)}
				</div>
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						variant="outline"
						aria-label="Delete provider"
						className="text-destructive hover:bg-destructive/10 hover:text-destructive"
						onClick={onDeleteProvider}
					>
						<Trash2 className="h-3.5 w-3.5" />
					</Button>
					<Button size="sm" variant="outline" onClick={onEditConfig}>
						<SettingsIcon className="mr-2 h-3.5 w-3.5" />
						Edit Provider Config
					</Button>
				</div>
			</div>
			<div className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
				{nc.base_url && (
					<span className="flex items-center gap-1">
						<Globe className="h-3 w-3" />
						{nc.base_url}
					</span>
				)}
				<span className="flex items-center gap-1">
					<Gauge className="h-3 w-3" />
					Concurrency: {cc.concurrency}
				</span>
				<span className="flex items-center gap-1">
					<Activity className="h-3 w-3" />
					Buffer: {cc.buffer_size}
				</span>
				{nc.timeout != null && (
					<span className="flex items-center gap-1">
						<Shield className="h-3 w-3" />
						Timeout: {nc.timeout}s
					</span>
				)}
				{nc.max_retries != null && <span>Retries: {nc.max_retries}</span>}
				{provider.proxy_config?.url && <span>Proxy: {provider.proxy_config.url}</span>}
			</div>
		</div>
	);
}