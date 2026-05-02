import { createFileRoute } from "@tanstack/react-router";
import ProvidersPage from "./page";

export const Route = createFileRoute("/platform/console/admin/providers")({
	component: ProvidersPage,
});
