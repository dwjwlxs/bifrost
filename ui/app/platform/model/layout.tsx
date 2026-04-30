import { createFileRoute } from "@tanstack/react-router";
import ModelPage from "./model";

function RouteComponent() {
	return <ModelPage />;
}

export const Route = createFileRoute("/platform/model")({
	component: RouteComponent,
});