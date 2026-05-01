import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import axios from "axios";

interface InviteInfo {
	email: string;
	role: string;
	organization_name: string;
	team_name?: string;
	inviter_name: string;
	expires_at: string;
}

export default function InvitePage() {
	// Get token from URL path: /platform/invite/invite-token/:token
	const params = useParams({ strict: false }) as { token?: string };
	const token = params?.token;

	const navigate = useNavigate();
	const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [accepting, setAccepting] = useState(false);
	const [form, setForm] = useState({
		username: "",
		password: "",
		confirmPassword: "",
	});
	const [formError, setFormError] = useState("");

	useEffect(() => {
		if (token) {
			fetchInviteInfo(token);
		}
	}, [token]);

	const fetchInviteInfo = async (t: string) => {
		setLoading(true);
		setError("");
		try {
			const res = await axios.get(`/api/invite/${t}`);
			if (res.data.success) {
				setInviteInfo(res.data.data);
			}
		} catch (err: any) {
			setError(err.response?.data?.message || "Invalid or expired invite");
		} finally {
			setLoading(false);
		}
	};

	const handleAccept = async (e: React.FormEvent) => {
		e.preventDefault();
		setFormError("");

		if (!token) {
			setFormError("Invalid invite token");
			return;
		}

		if (form.password !== form.confirmPassword) {
			setFormError("Passwords do not match");
			return;
		}

		if (form.password.length < 6) {
			setFormError("Password must be at least 6 characters");
			return;
		}

		setAccepting(true);

		try {
			const res = await axios.post("/api/invite/accept", {
				token: token,
				username: form.username,
				password: form.password,
			});

			if (res.data.success) {
				// Store token and redirect to platform console
				localStorage.setItem("token", res.data.data.token);
				localStorage.setItem("user", JSON.stringify(res.data.data.user));
				navigate({ to: "/platform/console" });
			}
		} catch (err: any) {
			setFormError(err.response?.data?.message || "Failed to accept invite");
		} finally {
			setAccepting(false);
		}
	};

	if (loading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-gray-50">
				<div className="text-center">
					<div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
					<p className="text-gray-600">Loading invite...</p>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex min-h-screen flex-col bg-gray-50">
				<header className="border-b bg-white">
					<div className="container mx-auto px-4 py-4">
						<Link to="/platform/home" className="flex items-center gap-2">
							<img src="/bifrost-icon.webp" alt="Bifrost" className="h-8 w-8" />
							<span className="text-xl font-bold">Bifrost</span>
						</Link>
					</div>
				</header>
				<div className="flex flex-1 items-center justify-center px-4">
					<div className="w-full max-w-md">
						<div className="rounded-xl border bg-white p-8 text-center shadow-sm">
							<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
								<svg className="h-8 w-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
								</svg>
							</div>
							<h1 className="mb-2 text-2xl font-bold">Invalid Invitation</h1>
							<p className="mb-6 text-gray-600">{error}</p>
							<Link to="/platform/login">
								<Button variant="outline">Create a new account</Button>
							</Link>
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen flex-col bg-gray-50">
			{/* Header */}
			<header className="border-b bg-white">
				<div className="container mx-auto px-4 py-4">
					<Link to="/platform/home" className="flex items-center gap-2">
						<img src="/bifrost-icon.webp" alt="Bifrost" className="h-8 w-8" />
						<span className="text-xl font-bold">Bifrost</span>
					</Link>
				</div>
			</header>

			{/* Content */}
			<div className="flex flex-1 items-center justify-center px-4 py-12">
				<div className="w-full max-w-md">
					<div className="rounded-xl border bg-white p-8 shadow-sm">
						{/* Invite Info */}
						<div className="mb-8 rounded-lg bg-blue-50 p-4">
							<div className="mb-3 flex items-center gap-3">
								<div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
									<svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
										/>
									</svg>
								</div>
								<div>
									<p className="font-semibold text-blue-900">You've been invited!</p>
									<p className="text-sm text-blue-700">{inviteInfo?.inviter_name} invited you</p>
								</div>
							</div>
							<div className="space-y-1 text-sm text-blue-800">
								<p>
									<span className="font-medium">Organization:</span> {inviteInfo?.organization_name}
								</p>
								{inviteInfo?.team_name && (
									<p>
										<span className="font-medium">Team:</span> {inviteInfo.team_name}
									</p>
								)}
								<p>
									<span className="font-medium">Role:</span> {inviteInfo?.role}
								</p>
								<p>
									<span className="font-medium">Invited email:</span> {inviteInfo?.email}
								</p>
							</div>
						</div>

						<h1 className="mb-2 text-2xl font-bold">Accept Invitation</h1>
						<p className="mb-8 text-gray-600">Create your account to join {inviteInfo?.organization_name}</p>

						{formError && <div className="mb-6 rounded-lg bg-red-50 p-3 text-sm text-red-600">{formError}</div>}

						<form onSubmit={handleAccept} className="space-y-6">
							<div className="space-y-2">
								<Label htmlFor="email">Email</Label>
								<Input id="email" type="email" value={inviteInfo?.email || ""} disabled className="bg-gray-50" />
								<p className="text-xs text-gray-500">This email cannot be changed</p>
							</div>

							<div className="space-y-2">
								<Label htmlFor="username">Username</Label>
								<Input
									id="username"
									type="text"
									placeholder="Choose a username"
									value={form.username}
									onChange={(e) => setForm({ ...form, username: e.target.value })}
									required
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="password">Password</Label>
								<Input
									id="password"
									type="password"
									placeholder="Create a password"
									value={form.password}
									onChange={(e) => setForm({ ...form, password: e.target.value })}
									required
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="confirmPassword">Confirm Password</Label>
								<Input
									id="confirmPassword"
									type="password"
									placeholder="Confirm your password"
									value={form.confirmPassword}
									onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
									required
								/>
							</div>

							<Button type="submit" className="w-full" disabled={accepting}>
								{accepting ? "Accepting invitation..." : "Accept invitation"}
							</Button>
						</form>

						<p className="mt-6 text-center text-sm text-gray-600">
							Already have an account?{" "}
							<Link to="/platform/login" className="font-medium text-blue-600 hover:underline">
								Sign in
							</Link>
						</p>
					</div>

					<p className="mt-6 text-center text-xs text-gray-500">
						By accepting this invitation, you agree to our{" "}
						<a href="#" className="underline">
							Terms of Service
						</a>{" "}
						and{" "}
						<a href="#" className="underline">
							Privacy Policy
						</a>
					</p>
				</div>
			</div>
		</div>
	);
}