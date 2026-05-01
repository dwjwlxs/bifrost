import { useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { setToken, setUser, type PlatformUser } from "@/lib/platform/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmailVerificationDialog } from "@/app/platform/components/EmailVerificationDialog";
import { usePlatformLoginMutation } from "@/lib/platform/platformApi";
import type { PlatformUserInfo } from "@/lib/platform/platformApi";

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

export default function LoginPage() {
	const navigate = useNavigate();
	const searchParams = useSearch({ from: "/platform/login" });
	const redirect = (searchParams as { redirect?: string }).redirect;
	const [login, setLogin] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [showVerifyDialog, setShowVerifyDialog] = useState(false);
	const [verifyEmail, setVerifyEmail] = useState("");

	const [platformLogin, { isLoading: loading }] = usePlatformLoginMutation();

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");

		try {
			const res = await platformLogin({ login, password }).unwrap();
			// New response format: { code, message, data: { access_token, refresh_token, expires_at } }
			const { access_token, refresh_token } = res.data;
			setToken(access_token);
			// Store refresh token in memory (not localStorage for security)
			// @ts-ignore - internal usage
			window.__bifrost_refresh_token = refresh_token;
			// For login success, we don't have full user info, redirect to dashboard which fetches profile
			const redirectTo = redirect && redirect.startsWith("/") ? redirect : "/platform/console/dashboard";
			navigate({ to: redirectTo });
		} catch (err: any) {
			const errData = err?.data;
			const errCode = errData?.code;
			const errMsg: string = errData?.message || err?.message || "Login failed";

			if (
				errCode === "email_not_verified" ||
				errMsg.toLowerCase().includes("not verified") ||
				errMsg.toLowerCase().includes("email verification")
			) {
				const email = errData?.data?.email || (login.includes("@") ? login : "");
				setVerifyEmail(email);
				setShowVerifyDialog(true);
			} else {
				setError(errMsg);
			}
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-md">
				<CardHeader className="text-center">
					<CardTitle className="text-2xl">Welcome back</CardTitle>
					<CardDescription>Sign in to your Bifrost account</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-4">
						{error && <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">{error}</div>}
						<div className="space-y-2">
							<Label htmlFor="login">Email or Username</Label>
							<Input
								id="login"
								type="text"
								value={login}
								onChange={(e) => setLogin(e.target.value)}
								placeholder="Enter your email or username"
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
								placeholder="Enter your password"
								required
							/>
						</div>
						<Button type="submit" className="w-full" disabled={loading}>
							{loading ? "Signing in..." : "Sign In"}
						</Button>
						<p className="text-muted-foreground text-center text-sm">
							Don't have an account?{" "}
							<Link to="/platform/register" className="text-primary underline-offset-4 hover:underline">
								Register
							</Link>
						</p>
					</form>
				</CardContent>
			</Card>
			<EmailVerificationDialog
				open={showVerifyDialog}
				onOpenChange={setShowVerifyDialog}
				email={verifyEmail}
				onVerified={(token: string, refreshToken: string) => {
					setToken(token);
					// Store refresh token for later use
					// @ts-ignore - internal usage
					window.__bifrost_refresh_token = refreshToken;
					const redirectTo = redirect && redirect.startsWith("/") ? redirect : "/platform/console/dashboard";
					navigate({ to: redirectTo });
				}}
			/>
		</div>
	);
}