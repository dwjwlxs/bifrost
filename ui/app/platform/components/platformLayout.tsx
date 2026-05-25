import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdownMenu";
import { ThemeProvider } from "@/components/themeProvider";
import { ReduxProvider } from "@/lib/store";
import { useLogout } from "@/lib/platform/hooks";
import { Link, useLocation } from "@tanstack/react-router";
import { LogOut, User, ChevronDown } from "lucide-react";
import { Toaster } from "sonner";
import { ConsoleSidebar } from "./consoleSidebar";
import { ConsoleSidebarProvider, useConsoleSidebar } from "./consoleSidebarContext";
import { getUser, onAuthEvent } from "@/lib/platform/auth";
import { AuthGate, DefaultAuthSkeleton } from "@/components/authGate";
import type { PlatformUserInfo } from "@/lib/platform/types";

// ── Public nav links (shown on marketing pages) ───────────────────
const publicNavItems = [
	{ label: "About", to: "/platform/about" },
	{ label: "Models", to: "/platform/model" },
	// { label: "Pricing", to: "/platform/pricing" },
	{ label: "Docs", to: "/platform/docs" },
];

/**
 * Unified platform header.
 * Reads user from localStorage synchronously on every render — no stale state.
 * Re-renders when pathname changes (navigation) or token changes (login/logout).
 */
export function PlatformHeader() {
	const pathname = useLocation({ select: (l) => l.pathname });

	const isConsole = pathname.startsWith("/platform/console");
	const isLoginOrRegister = pathname === "/platform/login" || pathname === "/platform/register" || pathname === "/platform/verify-email";

	// On login/register pages, show a minimal header
	if (isLoginOrRegister) {
		return (
			<header className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 w-full border-b backdrop-blur">
				<div className="container mx-auto flex h-14 items-center px-4">
					<Link to="/platform/home" className="flex items-center gap-2">
						<img src="/ecerai_logo_img.png" alt="dRouter" className="h-6 w-6" />
						<span className="font-bold">dRouter</span>
					</Link>
				</div>
			</header>
		);
	}

	return (
		<header className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 w-full border-b backdrop-blur">
			<div className="container mx-auto flex h-14 items-center px-4">
				{/* Logo */}
				<Link to="/platform/home" className="mr-6 flex items-center gap-2">
					<img src="/ecerai_logo_img.png" alt="dRouter" className="h-6 w-6" />
					<span className="font-bold sm:inline-block">dRouter</span>
				</Link>

				{/* Nav Links — only shown on public pages */}
				{!isConsole && (
					<nav className="flex items-center gap-1">
						{publicNavItems.map((item) => {
							const isActive = pathname === item.to;
							return (
								<Link
									key={item.to}
									to={item.to}
									className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
										isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
									}`}
								>
									{item.label}
								</Link>
							);
						})}
					</nav>
				)}

				<div className="flex-1" />

				{/* Right side: user menu or auth buttons — reactive via AuthGate */}
				<AuthGate
					loading={<DefaultAuthSkeleton />}
					signedIn={
						<PlatformUserMenu />
					}
					signedOut={
						<div className="flex items-center gap-2">
							<Button variant="ghost" size="sm" asChild>
								<Link to="/platform/login">Sign in</Link>
							</Button>
							<Button size="sm" asChild>
								<Link to="/platform/register">Sign up</Link>
							</Button>
						</div>
					}
				/>
			</div>
		</header>
	);
}

/** Extracted user menu — only rendered when authenticated (inside AuthGate signedIn) */
function PlatformUserMenu() {
	const logout = useLogout();
	const [user, setUser] = useState<PlatformUserInfo | null>(getUser);

	// Subscribe to auth events for reactive updates (login + logout)
	useEffect(() => {
		const unsubLogin = onAuthEvent("login", () => {
			const u = getUser();
			if (u) setUser(u);
		});
		const unsubLogout = onAuthEvent("logout", () => {
			setUser(null);
		});
		const unsubUserUpdate = onAuthEvent("user_update", () => {
			const u = getUser();
			if (u) setUser(u);
		});
		return () => {
			unsubLogin();
			unsubLogout();
			unsubUserUpdate();
		};
	}, []);

	if (!user) return <DefaultAuthSkeleton />;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" className="flex items-center gap-2">
					<div className="bg-primary/10 flex h-7 w-7 items-center justify-center rounded-full">
						<User className="text-primary h-4 w-4" />
					</div>
					<span className="hidden text-sm sm:inline-block">{user.nickname || user.username}</span>
					<ChevronDown className="text-muted-foreground h-3.5 w-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<div className="px-2 py-1.5">
					<p className="text-sm font-medium">{user.nickname || user.username}</p>
					<p className="text-muted-foreground text-xs">{user.email}</p>
					<p className="text-muted-foreground mt-1 text-xs">
						Role: <span className="font-mono">{user.role}</span>
					</p>
				</div>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link to="/platform/console/dashboard">
						<User className="mr-2 h-4 w-4" />
						My Account
					</Link>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={logout} className="text-red-600">
					<LogOut className="mr-2 h-4 w-4" />
					Log out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Shared footer for marketing pages.
 */
export function PlatformFooter() {
	return (
		<footer className="border-t px-4 py-8">
			<div className="container mx-auto">
				<div className="flex flex-col items-center justify-between gap-4 md:flex-row">
					<div className="flex items-center gap-2">
						<img src="/ecerai_logo_img.png" alt="dRouter" className="h-5 w-5" />
						<span className="text-sm font-bold">dRouter</span>
					</div>
					<div className="text-muted-foreground flex gap-6 text-sm">
						<Link to="/platform/about" className="hover:text-foreground">
							About
						</Link>
						<Link to="/platform/model" className="hover:text-foreground">
							Models
						</Link>
						<Link to="/platform/pricing" className="hover:text-foreground">
							Pricing
						</Link>
						<Link to="/platform/docs" className="hover:text-foreground">
							Docs
						</Link>
					</div>
					<div className="text-muted-foreground text-sm">© 2026 dRouter. All rights reserved.</div>
				</div>
			</div>
		</footer>
	);
}

/**
 * Console layout wrapper with sidebar.
 */
function ConsoleLayout({ children }: { children: React.ReactNode }) {
	const { isCollapsed, isMobile } = useConsoleSidebar();

	// Calculate margin based on sidebar state
	const mainMarginClass = isMobile ? "ml-0" : isCollapsed ? "ml-16" : "ml-64";

	return (
		<div className="flex min-h-0 flex-1">
			{/* Console sidebar — role derived internally via useUserRole() */}
			<ConsoleSidebar />
			{/* Main content area - margin adjusts based on sidebar state */}
			<main className={`flex-1 transition-all duration-300 ${mainMarginClass}`}>{children}</main>
		</div>
	);
}

/**
 * Lightweight wrapper — ThemeProvider + Toaster + Redux + unified header.
 * Used by /platform root layout for ALL pages (public + console).
 *
 * AuthGate handles reactive auth state — the console sidebar only renders
 * when the user is authenticated. Public pages remain accessible without auth.
 */
export function PlatformProviders({ children }: { children: React.ReactNode }) {
	const pathname = useLocation({ select: (l) => l.pathname });

	const isConsole = pathname.startsWith("/platform/console");
	const isInvitation = pathname.startsWith("/platform/invitation/");

	// AuthGate wraps the console layout ONLY. The /platform layout.tsx beforeLoad
	// is the single auth gatekeeper — if it passes, the console route renders.
	// AuthGate here is purely for the reactive header user menu + loading state.
	return (
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<Toaster />
			<ReduxProvider>
				<ConsoleSidebarProvider>
					<div className="bg-background flex min-h-screen flex-col">
						{!isInvitation && <PlatformHeader />}
						{isConsole ? (
							<AuthGate
								loading={<DefaultAuthConsoleLayout />}
								signedIn={<ConsoleLayout>{children}</ConsoleLayout>}
								signedOut={<main className="flex-1">{children}</main>}
							/>
						) : (
							<main className="flex-1">{children}</main>
						)}
					</div>
				</ConsoleSidebarProvider>
			</ReduxProvider>
		</ThemeProvider>
	);
}

function DefaultAuthConsoleLayout() {
	return (
		<div className="flex min-h-0 flex-1">
			{/* Sidebar skeleton */}
			<div className="bg-sidebar w-64 shrink-0 animate-pulse" />
			{/* Main content skeleton */}
			<main className="flex-1 p-8">
				<div className="mx-auto max-w-4xl space-y-6">
					<div className="bg-muted h-8 w-48 animate-pulse rounded" />
					<div className="bg-muted h-4 w-96 animate-pulse rounded" />
					<div className="bg-muted h-64 w-full animate-pulse rounded" />
				</div>
			</main>
		</div>
	);
}