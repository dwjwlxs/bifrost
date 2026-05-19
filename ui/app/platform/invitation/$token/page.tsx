/**
 * Invitation confirmation page — GET /platform/invitation/:token
 *
 * Public route: no auth required to view details.
 * Accepting requires being logged in with the invited email address.
 */
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { isAuthenticated } from "@/lib/platform/auth";
import { usePlatformGetInvitationQuery, usePlatformAcceptInvitationMutation } from "@/lib/platform/endpoints/invitations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserPlus, Users, Building2, Clock, AlertCircle, CheckCircle2 } from "lucide-react";

export default function InvitationPage() {
	const params = useParams({ strict: false }) as { token?: string };
	const token = params?.token || "";
	const navigate = useNavigate();

	const { data: invitation, isLoading, isError, error: queryError } = usePlatformGetInvitationQuery(token);
	const [acceptInvitation, { isLoading: accepting, isSuccess, error: acceptError }] = usePlatformAcceptInvitationMutation();

	const notAuthenticated = !isAuthenticated();

	// Handle accept button click
	const handleAccept = async () => {
		if (notAuthenticated) {
			// Redirect to login, come back here after
			navigate({ to: "/platform/login", search: { redirect: `/platform/invitation/${token}` } });
			return;
		}

		try {
			const res = await acceptInvitation(token).unwrap();
			if (res.code === "0") {
				// Accept succeeded — redirect to organizations page
				navigate({ to: "/platform/console/organizations" });
			} else {
				// Error handled via isError state
			}
		} catch (err: any) {
			// Error already captured by RTK Query error state
		}
	};

	// Decode backend error from RTK Query error
	const errorMessage = (() => {
		const err = acceptError || queryError;
		if (!err) return "";
		const d = err as { data?: { message?: string } };
		return d?.data?.message || "An error occurred.";
	})();

	if (isLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-gray-50">
				<div className="text-center">
					<div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
					<p className="text-gray-600">Loading invitation...</p>
				</div>
			</div>
		);
	}

	if (isError || !invitation) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
				<Card className="w-full max-w-md">
					<CardHeader className="text-center">
						<div className="bg-destructive/10 mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full">
							<AlertCircle className="text-destructive h-7 w-7" />
						</div>
						<CardTitle className="text-2xl">Invalid Invitation</CardTitle>
						<CardDescription>{errorMessage || "This invitation may have expired or already been accepted."}</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Link to="/platform/login">
							<Button variant="outline" className="w-full">
								Sign in to your account
							</Button>
						</Link>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (isSuccess || invitation.accepted) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
				<Card className="w-full max-w-md">
					<CardHeader className="text-center">
						<div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
							<CheckCircle2 className="h-7 w-7 text-green-600" />
						</div>
						<CardTitle className="text-2xl">You're in!</CardTitle>
						<CardDescription>You've joined {invitation.org_name}. Redirecting to your dashboard...</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Link to="/platform/console/organizations">
							<Button className="w-full">Go to Organizations</Button>
						</Link>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen flex-col bg-gray-50">
			<header className="border-b bg-white">
				<div className="container mx-auto px-4 py-4">
					<Link to="/platform/home" className="flex items-center gap-2">
						<img src="/dRouter_logo_img.png" alt="dRouter" className="h-8 w-8" />
						<span className="text-xl font-bold">dRouter</span>
					</Link>
				</div>
			</header>

			<div className="flex flex-1 items-center justify-center px-4 py-12">
				<div className="w-full max-w-md">
					<div className="rounded-xl border bg-white p-8 shadow-sm">
						{/* Invite banner */}
						<div className="mb-8 rounded-lg bg-blue-50 p-4">
							<div className="mb-3 flex items-center gap-3">
								<div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
									<UserPlus className="h-5 w-5 text-blue-600" />
								</div>
								<div>
									<p className="font-semibold text-blue-900">You've been invited!</p>
									<p className="text-sm text-blue-700">Join as {invitation.role}</p>
								</div>
							</div>
							<div className="space-y-1 text-sm text-blue-800">
								<div className="flex items-center gap-2">
									<Building2 className="h-4 w-4 opacity-70" />
									<span>{invitation.org_name}</span>
								</div>
								{invitation.team_name && invitation.team_name !== invitation.org_name && (
									<div className="flex items-center gap-2">
										<Users className="h-4 w-4 opacity-70" />
										<span>{invitation.team_name}</span>
									</div>
								)}
								<div className="flex items-center gap-2">
									<Clock className="h-4 w-4 opacity-70" />
									<span>Invited email: {invitation.email}</span>
								</div>
							</div>
						</div>

						<h1 className="mb-2 text-2xl font-bold">Accept Invitation</h1>
						<p className="mb-8 text-gray-600">
							Join {invitation.org_name}
							{invitation.team_name && invitation.team_name !== invitation.org_name && ` as a member of ${invitation.team_name}`}
						</p>

						{errorMessage && (
							<div className="mb-6 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600">
								<AlertCircle className="h-4 w-4 shrink-0" />
								{errorMessage}
							</div>
						)}

						<div className="space-y-4">
							{notAuthenticated ? (
								<>
									<p className="text-sm text-gray-600">Sign in or create an account to accept this invitation.</p>
									<Button onClick={handleAccept} className="w-full">
										Sign in to Accept
									</Button>
									<Link to="/platform/register" search={{ redirect: `/platform/invitation/${token}` }} className="block">
										<Button variant="outline" className="w-full">
											Create an account
										</Button>
									</Link>
								</>
							) : (
								<>
									<p className="text-sm text-gray-600">You're signed in. Click below to accept this invitation.</p>
									<Button onClick={handleAccept} disabled={accepting} className="w-full">
										{accepting ? "Accepting..." : "Accept & Join"}
									</Button>
									<Link to="/platform/console/organizations" className="block">
										<Button variant="ghost" className="w-full">
											Cancel
										</Button>
									</Link>
								</>
							)}
						</div>
					</div>

					<p className="mt-6 text-center text-xs text-gray-500">
						<a href="#" className="underline">
							Terms of Service
						</a>
						{" · "}
						<a href="#" className="underline">
							Privacy Policy
						</a>
					</p>
				</div>
			</div>
		</div>
	);
}