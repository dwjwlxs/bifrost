import { createFileRoute, redirect } from "@tanstack/react-router";
import { getToken, getUser } from "@/lib/platform/auth";
import UsersPage from "./page";

export const Route = createFileRoute("/platform/console/admin/users")({
	beforeLoad: () => {
		if (!getToken()) {
			throw redirect({ to: "/platform/login", replace: true });
		}
		const user = getUser();
		if (!user?.is_admin && user?.role !== "admin") {
			throw redirect({ to: "/platform/console/dashboard", replace: true });
		}
	},
	component: UsersPage,
});