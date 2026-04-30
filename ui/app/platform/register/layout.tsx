import { createFileRoute } from "@tanstack/react-router";
import RegisterPage from "./page";

export const Route = createFileRoute("/platform/register")({
	component: RegisterPage,
});