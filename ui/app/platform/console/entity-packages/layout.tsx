import { createFileRoute } from "@tanstack/react-router";
import EntityPackagesPage from "./page";

export const Route = createFileRoute("/platform/console/entity-packages")({
	component: EntityPackagesPage,
});