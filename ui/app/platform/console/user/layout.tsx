import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useGetCurrentUserQuery } from "@/lib/store";
import FullPageLoader from "@/components/fullPageLoader";
import { NoPermissionView } from "@/components/noPermissionView";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";

function UserLayout() {
	const { data: currentUser } = useGetCurrentUserQuery();

	if (!currentUser) {
		return <FullPageLoader />;
	}

	return (
		<div className="flex h-full">
			<aside className="bg-background w-64 border-r">
				<nav className="p-4">
					<h2 className="mb-4 font-semibold">My Workspace</h2>
					<ul className="space-y-2">
						<li>
							<a
								href="/platform/console/user/my-keys"
								className="text-foreground hover:bg-accent block rounded-md px-3 py-2 text-sm font-medium"
							>
								My Virtual Keys
							</a>
						</li>
						<li>
							<a
								href="/platform/console/user/profile"
								className="text-foreground hover:bg-accent block rounded-md px-3 py-2 text-sm font-medium"
							>
								Profile
							</a>
						</li>
					</ul>
				</nav>
			</aside>
			<main className="flex-1 overflow-auto">
				<Outlet />
			</main>
		</div>
	);
}

export const Route = createFileRoute("/platform/console/user")({
	component: UserLayout,
});