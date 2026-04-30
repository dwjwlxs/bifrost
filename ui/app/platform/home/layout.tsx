import { createFileRoute } from "@tanstack/react-router";
import HomePage from "./home";

function RouteComponent() {
	return <HomePage />;
}

export const Route = createFileRoute("/platform/home")({
	component: RouteComponent,
});