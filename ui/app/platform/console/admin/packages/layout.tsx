import { createFileRoute } from "@tanstack/react-router";
import PackagesPage from "./page";

export const Route = createFileRoute("/platform/console/admin/packages")({
	component: PackagesPage,
});
