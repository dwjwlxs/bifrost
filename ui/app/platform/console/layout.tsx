import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/platform/auth";

export const Route = createFileRoute("/platform/console")({
	beforeLoad: () => {
		if (!getToken()) {
			throw redirect({ to: "/platform/login", replace: true });
		}
	},
	component: () => (
		<div className="container mx-auto px-4 py-6">
			<Outlet />
		</div>
	),
});