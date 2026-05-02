import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Tailwind + global styles (also declares @font-face for local Geist fonts).
import "@/app/globals.css";

import { routeTree } from "./routeTree.gen";
import { ErrorComponent } from "./__error";
import { NotFoundComponent } from "./__notFound";
import { setPlatformRouter, setPlatformStore } from "@/lib/platform/platformBaseApi";
import { store } from "@/lib/store";

const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	scrollRestoration: true,
	notFoundMode: "root",
	defaultNotFoundComponent: NotFoundComponent,
	defaultErrorComponent: ErrorComponent,
});

// Inject router & store refs so RTK Query baseQuery can navigate and
// dispatch actions on 401 + refresh-failure (outside React context).
setPlatformRouter(router);
setPlatformStore(store);

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);