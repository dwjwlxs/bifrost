import { createFileRoute, Outlet } from "@tanstack/react-router";
import ProfilePage from "./page";

function RouteComponent() {
	return <ProfilePage />;
}

export const Route = createFileRoute("/platform/console/user/profile")({
	component: RouteComponent,
});