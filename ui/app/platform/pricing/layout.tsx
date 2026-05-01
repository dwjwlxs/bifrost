import { createFileRoute } from "@tanstack/react-router";
import PricingPage from "./pricing";

function RouteComponent() {
	return <PricingPage />;
}

export const Route = createFileRoute("/platform/pricing")({
	component: RouteComponent,
});