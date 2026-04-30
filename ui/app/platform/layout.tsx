import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { PlatformProviders } from "./components/platformLayout";

export const Route = createFileRoute("/platform")({
	beforeLoad: ({ location }) => {
		if (location.pathname === "/platform" || location.pathname === "/platform/") {
			throw redirect({ to: "/platform/console/dashboard", replace: true });
		}
	},
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<PlatformProviders>
			<Outlet />
		</PlatformProviders>
	);
}