import { createFileRoute } from "@tanstack/react-router";
import DashboardPage from "./page";

export const Route = createFileRoute("/platform/console/dashboard")({
	component: DashboardPage,
});
