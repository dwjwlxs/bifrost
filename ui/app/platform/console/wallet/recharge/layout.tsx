import { createFileRoute, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/platform/auth";
import RechargePage from "../recharge";

export const Route = createFileRoute("/platform/console/wallet/recharge")({
	beforeLoad: () => {
		if (!getToken()) {
			throw redirect({ to: "/platform/login", replace: true });
		}
	},
	component: RechargePage,
});