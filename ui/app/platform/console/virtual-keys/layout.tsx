import { createFileRoute, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/platform/auth";
import VirtualKeysPage from "./page";

export const Route = createFileRoute("/platform/console/virtual-keys")({
	beforeLoad: () => {
		if (!getToken()) {
			throw redirect({ to: "/platform/login", replace: true });
		}
	},
	component: VirtualKeysPage,
});