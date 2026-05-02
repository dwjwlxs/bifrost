import { createFileRoute } from "@tanstack/react-router";
import WalletPage from "./page";

export const Route = createFileRoute("/platform/console/wallet")({
	component: WalletPage,
});
