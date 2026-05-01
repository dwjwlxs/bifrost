import { useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { setToken, setUser, type PlatformUser } from "@/lib/platform/auth";
import { EmailVerificationDialog } from "@/app/platform/components/EmailVerificationDialog";
import { usePlatformRegisterMutation } from "@/lib/platform/platformApi";
import type { PlatformUserInfo } from "@/lib/platform/platformApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

// Convert PlatformUserInfo to PlatformUser (handles field name differences)
function toPlatformUser(info: PlatformUserInfo, extra?: Partial<PlatformUser>): PlatformUser {
	return {
		id: info.id,
		email: info.email,
		username: info.username,
		nickname: info.nickname,
		balance: info.balance,
		is_admin: info.is_admin,
		role: info.role,
		customer_id: info.customer_id,
		team_id: info.team_id,
		status: info.status,
		email_verified: info.is_email_verified,
		created_at: info.created_at,
		updated_at: info.updated_at,
		...extra,
	};
}

export default function RegisterPage() {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");
	const [showVerifyDialog, setShowVerifyDialog] = useState(false);
	const [verifyEmail, setVerifyEmail] = useState("");

	const [platformRegister, { isLoading: loading }] = usePlatformRegisterMutation();

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");

		if (password !== confirmPassword) {
			setError("Passwords do not match");
			return;
		}

		if (password.length < 6) {
			setError("Password must be at least 6 characters");
			return;
		}

		try {
			await platformRegister({ email, username, password }).unwrap();
			// New API: registration always requires email verification
			toast.success("Registration successful! Please check your email for verification code.");
			setVerifyEmail(email);
			setShowVerifyDialog(true);
		} catch (err: any) {
			const errData = err?.data;
			const errCode = errData?.code;
			const errMsg: string = errData?.message || err?.message || "Registration failed";

			// Handle email_not_verified case (e.g., re-registering with pending verification)
			if (errCode === "email_not_verified" || errMsg.toLowerCase().includes("not verified")) {
				const emailFromErr = errData?.data?.email || email;
				setVerifyEmail(emailFromErr);
				setShowVerifyDialog(true);
			} else {
				setError(errMsg);
			}
		}
	};

	return (
		<>
			<div className="flex min-h-screen items-center justify-center px-4">
				<Card className="w-full max-w-md">
					<CardHeader className="text-center">
						<CardTitle className="text-2xl">Create an account</CardTitle>
						<CardDescription>Get started with Bifrost for free</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit} className="space-y-4">
							{error && <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">{error}</div>}
							<div className="space-y-2">
								<Label htmlFor="email">Email</Label>
								<Input
									id="email"
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									placeholder="you@example.com"
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="username">Username</Label>
								<Input
									id="username"
									type="text"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									placeholder="johndoe"
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="password">Password</Label>
								<Input
									id="password"
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="At least 6 characters"
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="confirmPassword">Confirm Password</Label>
								<Input
									id="confirmPassword"
									type="password"
									value={confirmPassword}
									onChange={(e) => setConfirmPassword(e.target.value)}
									placeholder="Repeat your password"
									required
								/>
							</div>
							<Button type="submit" className="w-full" disabled={loading}>
								{loading ? "Creating account..." : "Create account"}
							</Button>
							<p className="text-muted-foreground text-center text-sm">
								Already have an account?{" "}
								<Link to="/platform/login" className="text-primary underline-offset-4 hover:underline">
									Sign in
								</Link>
							</p>
						</form>
					</CardContent>
				</Card>
			</div>
			<EmailVerificationDialog
				open={showVerifyDialog}
				onOpenChange={setShowVerifyDialog}
				email={verifyEmail}
				onVerified={(token, refreshToken) => {
					setToken(token);
					// @ts-ignore - internal usage
					window.__bifrost_refresh_token = refreshToken;
					navigate({ to: "/platform/console/dashboard" });
				}}
			/>
		</>
	);
}