import { createFileRoute } from "@tanstack/react-router";
import OrganizationsPage from "./page";

export const Route = createFileRoute("/platform/console/organizations")({
	component: OrganizationsPage,
});
