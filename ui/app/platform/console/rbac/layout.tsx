import { createFileRoute } from "@tanstack/react-router";
import RbacPage from "./page";

export const Route = createFileRoute("/platform/console/rbac")({
	component: RbacPage,
});