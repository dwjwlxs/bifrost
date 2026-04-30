import { createFileRoute } from "@tanstack/react-router";
import InvitePage from "./invite";

function RouteComponent() {
	return <InvitePage />;
}

export const Route = createFileRoute("/platform/invite/$token")({
	component: RouteComponent,
});