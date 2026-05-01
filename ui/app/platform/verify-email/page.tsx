import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { setToken, setUser, type PlatformUser } from "@/lib/platform/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail } from "lucide-react";
import { usePlatformVerifyEmailMutation, usePlatformResendVerificationMutation } from "@/lib/platform/platformApi";
import type { PlatformUserInfo } from "@/lib/platform/platformApi";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN = 30;

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

export default function VerifyEmailPage() {
	const navigate = useNavigate();

	// Read email from URL search params
	const email = (() => {
		if (typeof window === "undefined") return "";
		const params = new URLSearchParams(window.location.search);
		return params.get("email") || "";
	})();

	const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
	const [error, setError] = useState("");
	const [cooldown, setCooldown] = useState(0);
	const inputRefs = useRef<Array<HTMLInputElement | null>>(Array(CODE_LENGTH).fill(null));
	const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const [verifyEmail, { isLoading: loading }] = usePlatformVerifyEmailMutation();
	const [resendVerification] = usePlatformResendVerificationMutation();

	// Focus first input on mount
	useEffect(() => {
		inputRefs.current[0]?.focus();
	}, []);

	// Cooldown timer
	const startCooldown = useCallback(() => {
		setCooldown(RESEND_COOLDOWN);
		if (cooldownRef.current) clearInterval(cooldownRef.current);
		cooldownRef.current = setInterval(() => {
			setCooldown((prev) => {
				if (prev <= 1) {
					clearInterval(cooldownRef.current!);
					return 0;
				}
				return prev - 1;
			});
		}, 1000);
	}, []);

	useEffect(() => {
		return () => {
			if (cooldownRef.current) clearInterval(cooldownRef.current);
		};
	}, []);

	const handleDigitChange = (index: number, value: string) => {
		// Allow only digits
		const cleaned = value.replace(/\D/g, "");
		if (!cleaned && value) return;

		const newDigits = [...digits];

		if (cleaned.length > 1) {
			// Handle paste of multiple digits
			const pasted = cleaned.slice(0, CODE_LENGTH - index);
			for (let i = 0; i < pasted.length; i++) {
				if (index + i < CODE_LENGTH) {
					newDigits[index + i] = pasted[i];
				}
			}
			setDigits(newDigits);
			const nextIndex = Math.min(index + pasted.length, CODE_LENGTH - 1);
			inputRefs.current[nextIndex]?.focus();
		} else {
			newDigits[index] = cleaned;
			setDigits(newDigits);
			if (cleaned && index < CODE_LENGTH - 1) {
				inputRefs.current[index + 1]?.focus();
			}
		}
	};

	const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Backspace") {
			if (digits[index]) {
				const newDigits = [...digits];
				newDigits[index] = "";
				setDigits(newDigits);
			} else if (index > 0) {
				inputRefs.current[index - 1]?.focus();
			}
		} else if (e.key === "ArrowLeft" && index > 0) {
			inputRefs.current[index - 1]?.focus();
		} else if (e.key === "ArrowRight" && index < CODE_LENGTH - 1) {
			inputRefs.current[index + 1]?.focus();
		}
	};

	const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
		e.preventDefault();
		const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
		if (!pasted) return;
		const newDigits = [...digits];
		for (let i = 0; i < pasted.length; i++) {
			newDigits[i] = pasted[i];
		}
		setDigits(newDigits);
		const focusIdx = Math.min(pasted.length, CODE_LENGTH - 1);
		inputRefs.current[focusIdx]?.focus();
	};

	const code = digits.join("");
	const isComplete = code.length === CODE_LENGTH && digits.every((d) => d !== "");

	const handleVerify = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!isComplete) return;
		setError("");

		try {
			const res = await verifyEmail({ email, code }).unwrap();
			// New response format: { code, message, data: { access_token, refresh_token, expires_at } }
			const { access_token, refresh_token } = res.data;
			setToken(access_token);
			// Store refresh token for later use
			// @ts-ignore - internal usage
			window.__bifrost_refresh_token = refresh_token;
			navigate({ to: "/platform/console/dashboard" });
		} catch (err: any) {
			setError(err?.data?.message || err?.message || "Verification failed. Please try again.");
		}
	};

	const handleResend = async () => {
		if (cooldown > 0) return;
		setError("");

		try {
			await resendVerification({ email }).unwrap();
			startCooldown();
		} catch (err: any) {
			setError(err?.data?.message || err?.message || "Failed to resend code. Please try again.");
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-md">
				<CardHeader className="text-center">
					<div className="bg-primary/10 mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full">
						<Mail className="text-primary h-7 w-7" />
					</div>
					<CardTitle className="text-2xl">Verify Your Email</CardTitle>
					<CardDescription>
						{email ? (
							<>
								We've sent a 6-digit verification code to <span className="text-foreground font-medium">{email}</span>
							</>
						) : (
							"We've sent a 6-digit verification code to your email address"
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleVerify} className="space-y-6">
						{error && (
							<div data-testid="verify-email-error" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
								{error}
							</div>
						)}

						{/* 6-digit code inputs */}
						<div className="flex justify-center gap-2">
							{digits.map((digit, index) => (
								<Input
									key={index}
									ref={(el) => {
										inputRefs.current[index] = el;
									}}
									data-testid={`verify-email-input-${index}`}
									type="text"
									inputMode="numeric"
									maxLength={CODE_LENGTH}
									value={digit}
									onChange={(e) => handleDigitChange(index, e.target.value)}
									onKeyDown={(e) => handleKeyDown(index, e)}
									onPaste={handlePaste}
									className="h-12 w-12 text-center text-lg font-semibold"
									autoComplete="one-time-code"
								/>
							))}
						</div>

						<Button type="submit" className="w-full" disabled={!isComplete || loading} data-testid="verify-email-submit">
							{loading ? "Verifying..." : "Verify"}
						</Button>

						<div className="text-muted-foreground text-center text-sm">
							Didn't receive the code?{" "}
							<button
								type="button"
								data-testid="verify-email-resend"
								onClick={handleResend}
								disabled={cooldown > 0}
								className={`font-medium transition-colors ${
									cooldown > 0 ? "text-muted-foreground cursor-not-allowed" : "text-primary underline-offset-4 hover:underline"
								}`}
							>
								{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Code"}
							</button>
						</div>

						<p className="text-muted-foreground text-center text-sm">
							<Link to="/platform/register" className="text-primary underline-offset-4 hover:underline">
								Back to Register
							</Link>
						</p>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}