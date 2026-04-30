import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export default function UserRedirectPage() {
	const navigate = useNavigate();
	useEffect(() => {
		navigate({ to: "/workspace/user/my-keys", replace: true });
	}, [navigate]);
	return null;
}