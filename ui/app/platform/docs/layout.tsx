import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DocsSidebar } from "../components/docsSidebar";

export const Route = createFileRoute("/platform/docs")({
	component: DocsLayout,
});

function DocsLayout() {
	return (
		<>
			<DocsSidebar />
			<main className="pl-60">
				<Outlet />
			</main>
		</>
	);
}
