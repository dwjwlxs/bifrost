import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { PlatformProviders } from "./components/platformLayout";
import { isAuthenticated } from "@/lib/platform/auth";

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
	"/platform/home",
	"/platform/about",
	"/platform/model",
	"/platform/pricing",
	"/platform/login",
	"/platform/register",
	"/platform/verify-email",
];

export const Route = createFileRoute("/platform")({
	beforeLoad: ({ location }) => {
		const pathname = location.pathname;

		// Redirect /platform or /platform/ to dashboard
		if (pathname === "/platform" || pathname === "/platform/") {
			throw redirect({ to: "/platform/console/dashboard", replace: true });
		}

		// Allow public routes without auth
		if (PUBLIC_ROUTES.some((route) => pathname === route)) {
			return;
		}

		// Allow invite routes (token-based, no session needed)
		if (pathname.startsWith("/platform/invite/")) {
			return;
		}

		// Require auth for all other routes (including /platform/console/*)
		if (!isAuthenticated()) {
			throw redirect({ to: "/platform/login", search: { redirect: pathname } });
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