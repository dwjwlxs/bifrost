import { createFileRoute } from "@tanstack/react-router";
import LoginPage from "./page";

export const Route = createFileRoute("/platform/login")({
	component: LoginPage,
});