import { createFileRoute, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/platform/auth";
import DashboardPage from "./page";

export const Route = createFileRoute("/platform/console/dashboard")({
	beforeLoad: () => {
		if (!getToken()) {
			throw redirect({ to: "/platform/login", replace: true });
		}
	},
	component: DashboardPage,
});