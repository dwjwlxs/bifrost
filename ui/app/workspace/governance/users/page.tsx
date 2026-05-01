import FullPageLoader from "@/components/fullPageLoader";
import { useDebouncedValue } from "@/hooks/useDebounce";
import { getErrorMessage, useGetCustomersQuery, useGetTeamsQuery, useGetUsersQuery } from "@/lib/store";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import UsersTable from "@/app/workspace/governance/views/usersTable";
import { useQueryStates, parseAsInteger, parseAsString } from "nuqs";

const POLLING_INTERVAL = 5000;
const PAGE_SIZE = 25;

export default function GovernanceUsersPage() {
	const hasUsersAccess = useRbac(RbacResource.Users, RbacOperation.View);
	const hasTeamsAccess = useRbac(RbacResource.Teams, RbacOperation.View);
	const hasCustomersAccess = useRbac(RbacResource.Customers, RbacOperation.View);
	const shownErrorsRef = useRef(new Set<string>());

	const [urlState, setUrlState] = useQueryStates({
		search: parseAsString.withDefault(""),
		offset: parseAsInteger.withDefault(0),
	});

	const debouncedSearch = useDebouncedValue(urlState.search, 300);

	useEffect(() => {
		setUrlState({ offset: 0 });
	}, [debouncedSearch]);

	const {
		data: usersData,
		error: usersError,
		isLoading: usersLoading,
	} = useGetUsersQuery(
		{
			limit: PAGE_SIZE,
			offset: urlState.offset,
			search: debouncedSearch || undefined,
		},
		{
			skip: !hasUsersAccess,
			pollingInterval: POLLING_INTERVAL,
		},
	);

	const {
		data: teamsData,
		error: teamsError,
		isLoading: teamsLoading,
	} = useGetTeamsQuery(undefined, {
		skip: !hasTeamsAccess,
		pollingInterval: POLLING_INTERVAL,
	});

	const {
		data: customersData,
		error: customersError,
		isLoading: customersLoading,
	} = useGetCustomersQuery(undefined, {
		skip: !hasCustomersAccess,
		pollingInterval: POLLING_INTERVAL,
	});

	const usersTotal = usersData?.total ?? 0;

	// Snap offset back when total shrinks past current page
	useEffect(() => {
		if (!usersData || urlState.offset < usersTotal) return;
		setUrlState({
			offset: usersTotal === 0 ? 0 : Math.floor((usersTotal - 1) / PAGE_SIZE) * PAGE_SIZE,
		});
	}, [usersTotal, urlState.offset]);

	const isLoading = usersLoading || teamsLoading || customersLoading;

	useEffect(() => {
		if (!usersError && !teamsError && !customersError) {
			shownErrorsRef.current.clear();
			return;
		}
		const errorKey = `${!!usersError}-${!!teamsError}-${!!customersError}`;
		if (shownErrorsRef.current.has(errorKey)) return;
		shownErrorsRef.current.add(errorKey);
		if (usersError && teamsError && customersError) {
			toast.error("Failed to load governance data.");
		} else {
			if (usersError) toast.error(`Failed to load users: ${getErrorMessage(usersError)}`);
			if (teamsError) toast.error(`Failed to load teams: ${getErrorMessage(teamsError)}`);
			if (customersError) toast.error(`Failed to load customers: ${getErrorMessage(customersError)}`);
		}
	}, [usersError, teamsError, customersError]);

	if (isLoading) {
		return <FullPageLoader />;
	}

	return (
		<div className="mx-auto w-full max-w-7xl">
			<UsersTable
				users={usersData?.list || []}
				totalCount={usersData?.total || 0}
				teams={teamsData?.teams || []}
				customers={customersData?.customers || []}
				search={urlState.search}
				debouncedSearch={debouncedSearch}
				onSearchChange={(value) => setUrlState({ search: value || null, offset: 0 })}
				offset={urlState.offset}
				limit={PAGE_SIZE}
				onOffsetChange={(newOffset) => setUrlState({ offset: newOffset })}
			/>
		</div>
	);
}