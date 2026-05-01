import { createFileRoute, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/platform/auth";
import WalletPage from "./page";

export const Route = createFileRoute("/platform/console/wallet")({
	beforeLoad: () => {
		if (!getToken()) {
			throw redirect({ to: "/platform/login", replace: true });
		}
	},
	component: WalletPage,
});