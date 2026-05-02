import { createFileRoute } from "@tanstack/react-router";
import RechargePage from "../recharge";

export const Route = createFileRoute("/platform/console/wallet/recharge")({
	component: RechargePage,
});
