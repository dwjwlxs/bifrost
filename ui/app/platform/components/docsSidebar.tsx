import { Link, useLocation } from "@tanstack/react-router";
import { FileText, BookOpen } from "lucide-react";

const docsNavItems = [
	{ label: "API Reference", to: "/platform/docs/api-reference", icon: BookOpen },
];

/**
 * Docs page sidebar — static, no auth required.
 * Mirrors the look of ConsoleSidebar for visual consistency.
 */
export function DocsSidebar() {
	const pathname = useLocation({ select: (l) => l.pathname });

	return (
		<aside className="bg-background fixed top-14 left-0 z-40 flex h-[calc(100vh-3.5rem)] w-60 flex-col border-r">
			{/* Navigation items */}
			<nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
				<p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					Documentation
				</p>
				{docsNavItems.map((item) => {
					const isActive = pathname.startsWith(item.to);
					return (
						<Link
							key={item.to}
							to={item.to}
							className={`group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
								isActive
									? "bg-accent text-accent-foreground"
									: "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							}`}
						>
							<item.icon className="h-4 w-4 flex-shrink-0" />
							<span className="truncate">{item.label}</span>
						</Link>
					);
				})}
			</nav>
		</aside>
	);
}
