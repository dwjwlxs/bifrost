import { useState } from "react";
import axios from "axios";
import { useNavigate, Link } from "@tanstack/react-router";
import { setToken, setUser, type PlatformUser } from "@/lib/platform/auth";
import { EmailVerificationDialog } from "@/app/platform/components/email-verification-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function RegisterPage() {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [showVerifyDialog, setShowVerifyDialog] = useState(false);
	const [verifyEmail, setVerifyEmail] = useState("");

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

		setLoading(true);

		try {
			const res = await axios.post("/api/user/register", {
				email,
				username,
				password,
			});
			const data = res.data.data;
			// Handle both old (token+user) and new (requires_verification) response shapes
			if (data.requires_verification) {
				toast.success("Registration successful! Please check your email for the verification code.");
				setVerifyEmail(data.email || email);
				setShowVerifyDialog(true);
			} else {
				const { token, user } = data;
				setToken(token);
				setUser(user);
				navigate({ to: "/platform/console/dashboard" });
			}
		} catch (err: any) {
			setError(err.response?.data?.message || err.message || "Registration failed");
		} finally {
			setLoading(false);
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
				onVerified={(token, user) => {
					setToken(token);
					setUser(user as unknown as PlatformUser);
					navigate({ to: "/platform/console/dashboard" });
				}}
			/>
		</>
	);
}