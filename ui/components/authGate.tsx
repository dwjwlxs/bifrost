/**
 * AuthGate — unified authentication state container.
 *
 * Mirrors Clerk's <SignedIn>/<SignedOut> mental model but for the Bifrost
 * platform auth system. Renders appropriate UI based on the current auth
 * state without requiring each page to manage its own loading/user/null
 * juggling.
 *
 * Features:
 * - Auth loading skeleton during initial session check
 * - Reactive updates when login/logout happens anywhere in the app (including
 *   other tabs via the storage event system in auth.ts)
 * - Proactive session refresh on mount and on visibility change
 *
 * @example
 * // Wrap a layout or page with AuthGate:
 * <AuthGate
 *   loading={<PageSkeleton />}
 *   signedIn={<Dashboard />}
 *   signedOut={<LoginPrompt />}
 * />
 *
 * // Or with a fallback to a specific route redirect:
 * <AuthGate navigateTo="/platform/login" />
 */
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { onAuthEvent, getUser, getToken, refreshSessionIfNeeded } from "@/lib/platform/auth";

export interface AuthGateProps {
	/**
	 * Child to render when the user is authenticated and the session is valid.
	 * Note: to access the current user, call `getUser()` from the children.
	 */
	signedIn?: React.ReactNode;
	/**
	 * Child to render when the user is NOT authenticated (no valid token).
	 */
	signedOut?: React.ReactNode;
	/**
	 * Child to render while the auth state is being determined:
	 * - On first mount (no data in localStorage yet)
	 * - During proactive session refresh
	 * Defaults to a centered skeleton.
	 */
	loading?: React.ReactNode;
	/**
	 * If set, the user will be redirected to this route if not authenticated.
	 * This is a redirect-based alternative to `signedOut` — useful in route
	 * `beforeLoad` hooks where you can't render a fallback component.
	 */
	navigateTo?: string;
	/**
	 * If `navigateTo` is set, this search params object is passed to the redirect.
	 */
	navigateSearch?: Record<string, string | undefined>;
	/**
	 * Additional data to pass when emitting user_update events.
	 */
	meta?: Record<string, unknown>;
}

/**
 * Auth state machine:
 *
 *  loading → signedIn  (token exists and session check passed)
 *  loading → signedOut (no token, or proactive refresh failed)
 *  signedIn → signedOut (logout, token cleared, or 401 after retries)
 *  signedOut → signedIn (login via setLoggedInfo)
 */
type AuthState = "loading" | "authenticated" | "unauthenticated";

export function AuthGate({
	signedIn,
	signedOut,
	loading,
	navigateTo,
	navigateSearch,
	meta,
}: AuthGateProps) {
	const navigate = useNavigate();
	const [authState, setAuthState] = useState<AuthState>("loading");

	// ── Initial session check + proactive refresh ──────────────────────
	useEffect(() => {
		let cancelled = false;

		async function checkSession() {
			// If no token at all, skip refresh and go straight to unauthenticated
			if (!getToken()) {
				if (!cancelled) setAuthState("unauthenticated");
				return;
			}

			// Attempt proactive refresh — even if the access token is expired,
			// the httpOnly refresh cookie may still be valid.
			await refreshSessionIfNeeded();

			if (!cancelled) {
				// After refresh, check if user info is available in localStorage
				if (getUser()) {
					setAuthState("authenticated");
				} else {
					// Refresh failed or token couldn't be decoded
					setAuthState("unauthenticated");
				}
			}
		}

		checkSession();

		return () => {
			cancelled = true;
		};
	}, []);

	// ── Reactive auth event listeners ────────────────────────────────
	useEffect(() => {
		const handleLogin = () => {
			setAuthState("authenticated");
		};

		const handleLogout = () => {
			setAuthState("unauthenticated");
		};

		const unsubLogin = onAuthEvent("login", handleLogin);
		const unsubLogout = onAuthEvent("logout", handleLogout);

		return () => {
			unsubLogin();
			unsubLogout();
		};
	}, []);

	// ── Visibility-change triggered session refresh ───────────────────
	// When the tab becomes visible again (user switches back from another tab),
	// check if the token needs a proactive refresh.
	useEffect(() => {
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				refreshSessionIfNeeded().then((ok) => {
					if (!ok && !getToken()) {
						setAuthState("unauthenticated");
					}
				});
			}
		};

		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, []);

	// ── Redirect mode ─────────────────────────────────────────────────
	// If `navigateTo` is set, redirect instead of rendering signedOut content.
	// Navigation is triggered via useEffect to avoid side-effects during render.
	useEffect(() => {
		if (navigateTo && authState === "unauthenticated") {
			navigate({ to: navigateTo, search: navigateSearch });
		}
	}, [navigateTo, navigateSearch, authState, navigate]);

	if (navigateTo && authState === "unauthenticated") {
		return null;
	}

	// ── Render ─────────────────────────────────────────────────────────
	if (authState === "loading") {
		return <>{loading ?? <DefaultAuthSkeleton />}</>;
	}

	if (authState === "authenticated") {
		return <>{signedIn ?? null}</>;
	}

	return <>{signedOut ?? null}</>;
}

/**
 * Default skeleton shown during auth loading state.
 * Matches the layout of the PlatformHeader user menu area.
 */
export function DefaultAuthSkeleton() {
	return (
		<div className="flex items-center gap-2">
			<div className="bg-muted h-9 w-28 animate-pulse rounded-full" />
		</div>
	);
}