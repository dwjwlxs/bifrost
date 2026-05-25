import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getUser, isTokenValid, isTokenExpiringSoon, refreshSessionIfNeeded } from "@/lib/platform/auth";

export const Route = createFileRoute("/platform/console/admin")({
	beforeLoad: () => {
		if (!isTokenValid()) {
			throw redirect({ to: "/platform/login", replace: true });
		}
		if (isTokenExpiringSoon()) {
			refreshSessionIfNeeded();
		}
		const user = getUser();
		if (!user?.is_admin && user?.role !== "admin") {
			throw redirect({ to: "/platform/console/dashboard", replace: true });
		}
	},
	component: () => <Outlet />,
});