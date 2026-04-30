import { createFileRoute } from "@tanstack/react-router";
import VerifyEmailPage from "./page";

export const Route = createFileRoute("/platform/verify-email")({
	component: VerifyEmailPage,
});