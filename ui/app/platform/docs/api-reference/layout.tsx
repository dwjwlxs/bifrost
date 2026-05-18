import { createFileRoute } from "@tanstack/react-router";
import ApiReferencePage from "./page";

export const Route = createFileRoute("/platform/docs/api-reference")({
	component: ApiReferencePage,
});
