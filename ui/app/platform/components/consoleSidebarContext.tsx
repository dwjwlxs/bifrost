import { createContext, useContext, useState, ReactNode, useEffect } from "react";

interface ConsoleSidebarContextType {
	isCollapsed: boolean;
	isMobile: boolean;
	isMobileMenuOpen: boolean;
	toggleCollapse: () => void;
	toggleMobileMenu: () => void;
	closeMobileMenu: () => void;
}

const ConsoleSidebarContext = createContext<ConsoleSidebarContextType | undefined>(undefined);

export function ConsoleSidebarProvider({ children }: { children: ReactNode }) {
	// Check if mobile on mount and window resize
	const [isMobile, setIsMobile] = useState(() => {
		if (typeof window !== "undefined") {
			return window.innerWidth < 768;
		}
		return false;
	});

	const [isCollapsed, setIsCollapsed] = useState(() => {
		if (typeof window !== "undefined") {
			return window.innerWidth < 768;
		}
		return false;
	});

	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

	// Update mobile state on resize
	useEffect(() => {
		const handleResize = () => {
			const mobile = window.innerWidth < 768;
			setIsMobile(mobile);
			// Auto-collapse on mobile, auto-expand on desktop
			setIsCollapsed(mobile);
			// Close mobile menu when switching to desktop
			if (!mobile) {
				setIsMobileMenuOpen(false);
			}
		};

		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	const toggleCollapse = () => {
		setIsCollapsed((prev) => !prev);
	};

	const toggleMobileMenu = () => {
		setIsMobileMenuOpen((prev) => !prev);
	};

	const closeMobileMenu = () => {
		setIsMobileMenuOpen(false);
	};

	return (
		<ConsoleSidebarContext.Provider value={{ isCollapsed, isMobile, isMobileMenuOpen, toggleCollapse, toggleMobileMenu, closeMobileMenu }}>
			{children}
		</ConsoleSidebarContext.Provider>
	);
}

export function useConsoleSidebar() {
	const context = useContext(ConsoleSidebarContext);
	if (context === undefined) {
		throw new Error("useConsoleSidebar must be used within a ConsoleSidebarProvider");
	}
	return context;
}