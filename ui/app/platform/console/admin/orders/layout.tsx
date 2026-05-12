import { createFileRoute } from "@tanstack/react-router";
import OrdersPage from "./page";

export const Route = createFileRoute("/platform/console/admin/orders")({
	component: OrdersPage,
});