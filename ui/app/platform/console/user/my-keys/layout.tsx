import { createFileRoute, Outlet } from "@tanstack/react-router";
import MyKeysPage from "./page";

function RouteComponent() {
	// For now, always show the page - child routes can be added later if needed
	return <MyKeysPage />;
}

export const Route = createFileRoute("/platform/console/user/my-keys")({
	component: RouteComponent,
});