import { useState } from "react";
import axios from "axios";
import { useNavigate, Link } from "@tanstack/react-router";
import { setToken, setUser } from "@/lib/platform/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmailVerificationDialog } from "@/app/platform/components/email-verification-dialog";
import type { PlatformUser } from "@/lib/platform/auth";
import type { PlatformUserInfo } from "@/lib/platform/platformApi";

export default function LoginPage() {
	const navigate = useNavigate();
	const [login, setLogin] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [showVerifyDialog, setShowVerifyDialog] = useState(false);
	const [verifyEmail, setVerifyEmail] = useState("");

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			const res = await axios.post("/api/user/login", { login, password });
			const { token, user } = res.data.data;
			setToken(token);
			setUser(user);
			navigate({ to: "/platform/console/dashboard" });
		} catch (err: any) {
			const errData = err.response?.data;
			const errCode = errData?.code;
			const errMsg: string = errData?.message || err.message || "Login failed";

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
		} finally {
			setLoading(false);
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
				onVerified={(token: string, user: PlatformUserInfo) => {
					setToken(token);
					setUser(user as unknown as PlatformUser);
					navigate({ to: "/platform/console/dashboard" });
				}}
			/>
		</div>
	);
}