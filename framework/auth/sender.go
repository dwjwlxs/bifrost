package auth

import "context"

// CodeSender abstracts the delivery of verification codes (email, SMS, etc.).
// Implementations should be non-blocking and idempotent.
type CodeSender interface {
	// SendVerificationCode delivers a verification code to the recipient.
	// The code is plaintext; the caller should format it for the user.
	SendVerificationCode(ctx context.Context, recipient string, codeType VerificationCodeType, code string) error
}

// NoopCodeSender is a no-op sender that discards codes (for testing).
type NoopCodeSender struct{}

func (NoopCodeSender) SendVerificationCode(_ context.Context, _ string, _ VerificationCodeType, _ string) error {
	return nil
}
