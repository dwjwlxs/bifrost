import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getToken, getUser } from "@/lib/platform/auth";

export const Route = createFileRoute("/platform/console/admin")({
	beforeLoad: () => {
		if (!getToken()) {
			throw redirect({ to: "/platform/login", replace: true });
		}
		const user = getUser();
		if (!user?.is_admin && user?.role !== "admin") {
			throw redirect({ to: "/platform/console/dashboard", replace: true });
		}
	},
	component: () => <Outlet />,
});