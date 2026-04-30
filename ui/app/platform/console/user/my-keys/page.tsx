import FullPageLoader from "@/components/fullPageLoader";
import { useDebouncedValue } from "@/hooks/useDebounce";
import { getErrorMessage, useGetCustomersQuery, useGetTeamsQuery, useGetVirtualKeysQuery, useGetCurrentUserQuery } from "@/lib/store";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import VirtualKeysTable from "@/app/workspace/virtual-keys/views/virtualKeysTable";

const POLLING_INTERVAL = 5000;
const PAGE_SIZE = 25;

export default function MyKeysPage() {
	const { data: currentUser } = useGetCurrentUserQuery();
	const shownErrorsRef = useRef(new Set<string>());

	const [urlState, setUrlState] = useQueryStates(
		{
			search: parseAsString.withDefault(""),
			offset: parseAsInteger.withDefault(0),
			sort_by: parseAsString.withDefault(""),
			order: parseAsString.withDefault(""),
		},
		{ history: "push" },
	);

	const debouncedSearch = useDebouncedValue(urlState.search, 300);

	// Filter VKs by user's customer_id or team_id
	const {
		data: virtualKeysData,
		error: vkError,
		isLoading: vkLoading,
	} = useGetVirtualKeysQuery(
		{
			limit: PAGE_SIZE,
			offset: urlState.offset,
			search: debouncedSearch || undefined,
			customer_id: currentUser?.customer_id || undefined,
			team_id: currentUser?.team_id || undefined,
			sort_by: (urlState.sort_by as "name" | "budget_spent" | "created_at" | "status") || undefined,
			order: (urlState.order as "asc" | "desc") || undefined,
		},
		{
			skip: !currentUser,
			pollingInterval: POLLING_INTERVAL,
		},
	);

	// Load teams and customers for display names
	const {
		data: teamsData,
		error: teamsError,
		isLoading: teamsLoading,
	} = useGetTeamsQuery(undefined, {
		pollingInterval: POLLING_INTERVAL,
	});

	const {
		data: customersData,
		error: customersError,
		isLoading: customersLoading,
	} = useGetCustomersQuery(undefined, {
		pollingInterval: POLLING_INTERVAL,
	});

	const vkTotal = virtualKeysData?.total_count ?? 0;

	// Snap offset back when total shrinks past current page
	useEffect(() => {
		if (!virtualKeysData || urlState.offset < vkTotal) return;
		setUrlState({ offset: vkTotal === 0 ? 0 : Math.floor((vkTotal - 1) / PAGE_SIZE) * PAGE_SIZE });
	}, [vkTotal, urlState.offset]);

	const isLoading = vkLoading || teamsLoading || customersLoading;

	useEffect(() => {
		if (!vkError && !teamsError && !customersError) {
			shownErrorsRef.current.clear();
			return;
		}
		const errorKey = `${!!vkError}-${!!teamsError}-${!!customersError}`;
		if (shownErrorsRef.current.has(errorKey)) return;
		shownErrorsRef.current.add(errorKey);
		if (vkError && teamsError && customersError) {
			toast.error("Failed to load data.");
		} else {
			if (vkError) toast.error(`Failed to load virtual keys: ${getErrorMessage(vkError)}`);
			if (teamsError) toast.error(`Failed to load teams: ${getErrorMessage(teamsError)}`);
			if (customersError) toast.error(`Failed to load customers: ${getErrorMessage(customersError)}`);
		}
	}, [vkError, teamsError, customersError]);

	if (isLoading) {
		return <FullPageLoader />;
	}

	const handleSearchChange = (value: string) => {
		setUrlState({ search: value || null, offset: 0 });
	};

	const handleOffsetChange = (newOffset: number) => {
		setUrlState({ offset: newOffset });
	};

	const handleSortChange = (newSortBy: string, newOrder: string) => {
		setUrlState({ sort_by: newSortBy || null, order: newOrder || null, offset: 0 });
	};

	return (
		<div className="mx-auto w-full max-w-7xl p-6">
			<div className="mb-6">
				<h1 className="text-2xl font-bold">My Virtual Keys</h1>
				<p className="text-muted-foreground">
					Manage your API keys for accessing AI models. Keys are automatically filtered by your organization/team.
				</p>
			</div>

			<VirtualKeysTable
				virtualKeys={virtualKeysData?.virtual_keys || []}
				totalCount={virtualKeysData?.total_count || 0}
				teams={teamsData?.teams || []}
				customers={customersData?.customers || []}
				search={urlState.search}
				debouncedSearch={debouncedSearch}
				onSearchChange={handleSearchChange}
				customerFilter={currentUser?.customer_id || ""}
				onCustomerFilterChange={() => {}} // No-op for user view
				teamFilter={currentUser?.team_id || ""}
				onTeamFilterChange={() => {}} // No-op for user view
				offset={urlState.offset}
				limit={PAGE_SIZE}
				onOffsetChange={handleOffsetChange}
				sortBy={urlState.sort_by}
				order={urlState.order}
				onSortChange={handleSortChange}
				hideFilters={true} // Hide filter dropdowns for user view
			/>
		</div>
	);
}