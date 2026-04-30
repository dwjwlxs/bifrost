import { createFileRoute } from "@tanstack/react-router";
import AboutPage from "./about";

function RouteComponent() {
	return <AboutPage />;
}

export const Route = createFileRoute("/platform/about")({
	component: RouteComponent,
});