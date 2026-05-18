import { BookOpen } from "lucide-react";

export default function DocsPage() {
	return (
		<div className="mx-auto max-w-2xl px-6 py-12">
			<div className="mb-8 flex items-center gap-3">
				<BookOpen className="text-primary h-8 w-8" />
				<h1 className="text-3xl font-bold">Documentation</h1>
			</div>

			<p className="text-muted-foreground mb-8 text-lg">
				Welcome to the Bifrost documentation. Select a section from the sidebar to get started.
			</p>

			<div className="grid gap-4 sm:grid-cols-2">
				<a
					href="/platform/docs/api-reference"
					className="hover:bg-accent group rounded-lg border p-5 transition-colors"
				>
					<BookOpen className="text-primary mb-3 h-5 w-5" />
					<h3 className="font-semibold">API Reference</h3>
					<p className="text-muted-foreground mt-1 text-sm">
						Complete OpenAPI reference for all Bifrost endpoints — inference, governance,
						providers, MCP, and more.
					</p>
				</a>
			</div>
		</div>
	);
}
