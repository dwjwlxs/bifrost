import { createFileRoute, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/platform/auth";
import OrganizationsPage from "./page";

export const Route = createFileRoute("/platform/console/organizations")({
	beforeLoad: () => {
		if (!getToken()) {
			throw redirect({ to: "/platform/login", replace: true });
		}
	},
	component: OrganizationsPage,
});