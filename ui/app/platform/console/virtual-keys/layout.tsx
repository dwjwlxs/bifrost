import { createFileRoute } from "@tanstack/react-router";
import VirtualKeysPage from "./page";

export const Route = createFileRoute("/platform/console/virtual-keys")({
	component: VirtualKeysPage,
});
