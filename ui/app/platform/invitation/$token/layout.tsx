import { createFileRoute } from "@tanstack/react-router";
import InvitationPage from "./page";

export const Route = createFileRoute("/platform/invitation/$token")({
	component: InvitationPage,
});