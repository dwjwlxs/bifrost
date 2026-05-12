import { createFileRoute } from "@tanstack/react-router";
import UsersPage from "./page";

export const Route = createFileRoute("/platform/console/admin/users")({
	component: UsersPage,
});