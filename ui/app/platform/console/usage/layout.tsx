import { createFileRoute } from "@tanstack/react-router";
import UsagePage from "./page";

export const Route = createFileRoute("/platform/console/usage")({
	component: UsagePage,
});