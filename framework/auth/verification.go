package auth

import (
	"context"
	"time"
)

// VerificationCodeManager handles creation and validation of verification codes.
type VerificationCodeManager struct {
	repo   VerificationCodeRepository
	config *Config
}

// NewVerificationCodeManager creates a new VerificationCodeManager.
func NewVerificationCodeManager(repo VerificationCodeRepository, config *Config) *VerificationCodeManager {
	return &VerificationCodeManager{
		repo:   repo,
		config: config,
	}
}

// CreateCode generates a new verification code, hashes it, and stores it.
// Returns the plaintext code (to be sent to the user) and any error.
func (m *VerificationCodeManager) CreateCode(ctx context.Context, userID, recipient string, codeType VerificationCodeType) (string, error) {
	code, err := GenerateVerificationCode(m.config.VerificationCodeLength)
	if err != nil {
		return "", err
	}

	vc := &VerificationCode{
		ID:        generateUUID(),
		UserID:    userID,
		CodeType:  codeType,
		CodeHash:  HashSHA256Base64(code),
		Recipient: recipient,
		Attempts:  0,
		ExpiresAt: time.Now().Add(m.config.VerificationCodeTTL),
		CreatedAt: time.Now(),
	}

	if err := m.repo.Create(ctx, vc); err != nil {
		return "", err
	}

	return code, nil
}

// VerifyCode validates a verification code against the latest stored code for the recipient.
// Returns the verification record on success.
func (m *VerificationCodeManager) VerifyCode(ctx context.Context, recipient string, codeType VerificationCodeType, code string) (*VerificationCode, error) {
	vc, err := m.repo.GetLatest(ctx, recipient, codeType)
	if err != nil {
		return nil, err
	}
	if vc == nil {
		return nil, ErrVerificationCodeInvalid
	}

	// Check expiry
	if time.Now().After(vc.ExpiresAt) {
		return nil, ErrVerificationCodeExpired
	}

	// Check max attempts
	if vc.Attempts >= m.config.VerificationMaxAttempts {
		return nil, ErrVerificationCodeMaxAttempts
	}

	// Increment attempts
	if err := m.repo.IncrementAttempts(ctx, vc.ID); err != nil {
		return nil, err
	}

	// Check if already verified
	if vc.VerifiedAt != nil {
		return nil, ErrVerificationCodeInvalid
	}

	// Compare hash
	expectedHash := HashSHA256Base64(code)
	if vc.CodeHash != expectedHash {
		return nil, ErrVerificationCodeInvalid
	}

	// Mark as verified
	now := time.Now()
	vc.VerifiedAt = &now
	if err := m.repo.MarkVerified(ctx, vc.ID); err != nil {
		return nil, err
	}

	return vc, nil
}

// CleanupExpired removes expired verification codes from storage.
func (m *VerificationCodeManager) CleanupExpired(ctx context.Context) (int64, error) {
	return m.repo.DeleteExpired(ctx)
}
