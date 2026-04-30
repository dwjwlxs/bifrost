import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { PlatformUserInfo } from "@/lib/platform/platformApi";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN = 30;

export interface EmailVerificationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	email: string;
	onVerified: (token: string, user: PlatformUserInfo) => void;
}

export function EmailVerificationDialog({ open, onOpenChange, email, onVerified }: EmailVerificationDialogProps) {
	const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [cooldown, setCooldown] = useState(0);
	const inputRefs = useRef<Array<HTMLInputElement | null>>(Array(CODE_LENGTH).fill(null));
	const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Focus first input when dialog opens
	useEffect(() => {
		if (open) {
			setTimeout(() => {
				inputRefs.current[0]?.focus();
			}, 50);
		} else {
			// Reset state when dialog closes
			setDigits(Array(CODE_LENGTH).fill(""));
			setError("");
			setLoading(false);
		}
	}, [open]);

	// Cooldown timer cleanup
	useEffect(() => {
		return () => {
			if (cooldownRef.current) clearInterval(cooldownRef.current);
		};
	}, []);

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

	const handleDigitChange = (index: number, value: string) => {
		// Allow only digits
		const cleaned = value.replace(/\D/g, "");
		if (!cleaned && value) return;

		// Clear error when user starts typing
		if (error) setError("");

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
				if (error) setError("");
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
		if (error) setError("");
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
		setLoading(true);

		try {
			const res = await axios.post("/api/user/verify-email", { email, code });
			const { token, user } = res.data.data;
			onVerified(token, user);
		} catch (err: any) {
			setError(err.response?.data?.message || err.message || "Verification failed. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	const handleResend = async () => {
		if (cooldown > 0) return;
		setError("");

		try {
			await axios.post("/api/user/resend-verification", { email });
			startCooldown();
		} catch (err: any) {
			setError(err.response?.data?.message || err.message || "Failed to resend code. Please try again.");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md" disableOutsideClick>
				<DialogHeader className="items-center text-center">
					<div className="bg-primary/10 mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full">
						<Mail className="text-primary h-7 w-7" />
					</div>
					<DialogTitle className="text-2xl">Verify Your Email</DialogTitle>
					<DialogDescription>
						{email ? (
							<>
								We've sent a 6-digit verification code to <span className="text-foreground font-medium">{email}</span>
							</>
						) : (
							"We've sent a 6-digit verification code to your email address"
						)}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleVerify} className="space-y-6 pt-2">
					{error && (
						<div data-testid="email-verification-dialog-error" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
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
								data-testid={`email-verification-dialog-input-${index}`}
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

					<Button type="submit" className="w-full" disabled={!isComplete || loading} data-testid="email-verification-dialog-submit">
						{loading ? "Verifying..." : "Verify"}
					</Button>

					<div className="text-muted-foreground text-center text-sm">
						Didn't receive the code?{" "}
						<button
							type="button"
							data-testid="email-verification-dialog-resend"
							onClick={handleResend}
							disabled={cooldown > 0}
							className={`font-medium transition-colors ${
								cooldown > 0 ? "text-muted-foreground cursor-not-allowed" : "text-primary underline-offset-4 hover:underline"
							}`}
						>
							{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Code"}
						</button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}