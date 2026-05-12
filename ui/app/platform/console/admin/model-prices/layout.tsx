import { createFileRoute } from "@tanstack/react-router";
import ModelPricesPage from "./page";

export const Route = createFileRoute("/platform/console/admin/model-prices")({
	component: ModelPricesPage,
});