import { createFileRoute } from "@tanstack/react-router";
import BillingPage from "./page";

export const Route = createFileRoute("/platform/console/billing")({
	component: BillingPage,
});