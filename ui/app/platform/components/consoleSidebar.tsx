import { Link, useLocation } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import { useConsoleSidebar } from "./consoleSidebarContext";
import { getVisibleNavItems } from "@/lib/platform/config";

interface ConsoleSidebarProps {
	isAdmin?: boolean;
}

/**
 * Console sidebar with collapsible navigation.
 * Left side panel with expandable/collapsible menu items.
 * Navigation items are role-based via lib/platform/config.ts.
 */
export function ConsoleSidebar({ isAdmin = false }: ConsoleSidebarProps) {
	const pathname = useLocation({ select: (l) => l.pathname });
	const { isCollapsed, isMobile, isMobileMenuOpen, toggleCollapse, toggleMobileMenu, closeMobileMenu } = useConsoleSidebar();

	const navItems = getVisibleNavItems(isAdmin);

	const handleNavClick = () => {
		if (isMobile) {
			closeMobileMenu();
		}
	};

	return (
		<>
			{/* Mobile menu button - only visible on mobile */}
			{isMobile && (
				<button
					onClick={toggleMobileMenu}
					className="bg-muted/50 hover:bg-muted text-muted-foreground sticky top-14 z-30 ml-4 rounded-md border p-2 transition-colors md:hidden"
					type="button"
					aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
				>
					{isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
				</button>
			)}

			{/* Sidebar */}
			<aside
				className={`bg-background fixed top-14 left-0 z-40 flex h-[calc(100vh-3.5rem)] flex-col border-r transition-all duration-300 ${
					isMobile ? (isMobileMenuOpen ? "w-64 translate-x-0" : "w-64 -translate-x-full") : isCollapsed ? "w-16" : "w-64"
				} ${isMobile && !isMobileMenuOpen ? "pointer-events-none" : ""}`}
			>
				{/* Collapse toggle button - desktop only */}
				{!isMobile && (
					<div className="flex justify-end p-2">
						<button
							onClick={toggleCollapse}
							className="text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
							title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
							type="button"
						>
							{isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
						</button>
					</div>
				)}

				{/* Navigation items */}
				<nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
					{navItems.map((item) => {
						const isActive = pathname.startsWith(item.to);
						return (
							<Link
								key={item.to}
								to={item.to}
								onClick={handleNavClick}
								className={`group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
									isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
								}`}
								title={isCollapsed && !isMobile ? item.label : undefined}
							>
								<item.icon className="h-5 w-5 flex-shrink-0" />
								{(!isCollapsed || isMobile) && <span className="truncate">{item.label}</span>}
							</Link>
						);
					})}
				</nav>
			</aside>

			{/* Mobile overlay */}
			{isMobile && isMobileMenuOpen && (
				<div onClick={closeMobileMenu} className="bg-background/80 fixed inset-0 z-30 backdrop-blur-sm md:hidden" />
			)}
		</>
	);
}