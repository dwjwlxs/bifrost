import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { isTokenValid, isTokenExpiringSoon, refreshSessionIfNeeded } from "@/lib/platform/auth";

export const Route = createFileRoute("/platform/console")({
	beforeLoad: () => {
		// Use isTokenValid — token must exist AND not be expired.
		// Expired tokens redirect immediately (no page flash waiting for 401).
		if (!isTokenValid()) {
			throw redirect({ to: "/platform/login", replace: true });
		}
		// Kick off background refresh if token is close to expiry.
		// This is fire-and-forget — doesn't block the route or wait for result.
		if (isTokenExpiringSoon()) {
			refreshSessionIfNeeded();
		}
	},
	component: () => (
		<div className="container mx-auto px-4 py-6">
			<Outlet />
		</div>
	),
});