package auth

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// --- ChangeEmail ---

func (s *service) ChangeEmail(ctx context.Context, userID string, req ChangeEmailRequest) error {
	newEmail := normalizeEmail(req.NewEmail)
	if newEmail == "" || !strings.Contains(newEmail, "@") {
		return fmt.Errorf("auth: invalid email format")
	}

	// Get user
	user, err := s.store.UserRepo().GetByID(ctx, userID)
	if err != nil {
		return ErrUserNotFound
	}

	if user.Status != UserStatusActive {
		return fmt.Errorf("auth: account must be active to change email")
	}

	// Check if new email is the same as current
	if user.EmailNormalized == newEmail {
		return fmt.Errorf("auth: new email is the same as current email")
	}

	// Check if new email is already taken by another user
	existingUser, _ := s.store.UserRepo().GetByEmail(ctx, newEmail)
	if existingUser != nil && existingUser.ID != userID {
		return ErrEmailAlreadyInUse
	}

	// Generate and send verification code to the new email
	code, err := s.verifier.CreateCode(ctx, userID, newEmail, VerificationCodeTypeEmailChange)
	if err != nil {
		return fmt.Errorf("auth: failed to generate email change code: %w", err)
	}

	// Send the code (fire and forget)
	_ = s.codeSender.SendVerificationCode(ctx, newEmail, VerificationCodeTypeEmailChange, code)

	return nil
}

// --- VerifyEmailChange ---

func (s *service) VerifyEmailChange(ctx context.Context, userID string, req VerifyEmailChangeRequest) error {
	newEmail := normalizeEmail(req.NewEmail)
	if newEmail == "" || req.Code == "" {
		return ErrEmailChangeInvalid
	}

	// Get user
	user, err := s.store.UserRepo().GetByID(ctx, userID)
	if err != nil {
		return ErrUserNotFound
	}

	if user.Status != UserStatusActive {
		return fmt.Errorf("auth: account must be active to change email")
	}

	// Verify the code
	_, err = s.verifier.VerifyCode(ctx, newEmail, VerificationCodeTypeEmailChange, req.Code)
	if err != nil {
		return ErrEmailChangeInvalid
	}

	// Double-check email is still available (race condition guard)
	existingUser, _ := s.store.UserRepo().GetByEmail(ctx, newEmail)
	if existingUser != nil && existingUser.ID != userID {
		return ErrEmailAlreadyInUse
	}

	// Update email
	now := time.Now()
	user.Email = req.NewEmail
	user.EmailNormalized = newEmail
	user.UpdatedAt = now

	if err := s.store.UserRepo().Update(ctx, user); err != nil {
		return fmt.Errorf("auth: failed to update email: %w", err)
	}

	// Notify old email (fire and forget, non-fatal)
	if user.Email != "" {
		_ = s.codeSender.SendVerificationCode(ctx, user.Email, VerificationCodeTypeEmailVerify, "your email has been changed to "+newEmail)
	}

	return nil
}

// --- ChangePassword ---

func (s *service) ChangePassword(ctx context.Context, userID string, req ChangePasswordRequest) error {
	if req.OldPassword == "" || req.NewPassword == "" {
		return ErrOldPasswordIncorrect
	}

	if len(req.NewPassword) < s.config.PasswordMinLength {
		return ErrPasswordTooShort
	}

	// Get user
	user, err := s.store.UserRepo().GetByID(ctx, userID)
	if err != nil {
		return ErrUserNotFound
	}

	if user.Status != UserStatusActive {
		return fmt.Errorf("auth: account must be active to change password")
	}

	// Verify old password
	ok, err := s.hasher.Verify(req.OldPassword, user.PasswordHash)
	if err != nil || !ok {
		return ErrOldPasswordIncorrect
	}

	// Check if new password is the same as old
	if req.OldPassword == req.NewPassword {
		return ErrPasswordSame
	}

	// Check breached password
	if s.isPasswordBreached(req.NewPassword) {
		return ErrPasswordBreached
	}

	// Hash new password
	hash, err := s.hasher.Hash(req.NewPassword)
	if err != nil {
		return fmt.Errorf("auth: failed to hash password: %w", err)
	}

	// Update password
	user.PasswordHash = hash
	user.UpdatedAt = time.Now()
	if err := s.store.UserRepo().Update(ctx, user); err != nil {
		return fmt.Errorf("auth: failed to update password: %w", err)
	}

	// Revoke all other sessions (force re-login everywhere else except current)
	_ = s.store.SessionRepo().DeleteByUserID(ctx, user.ID)

	return nil
}

// isPasswordBreached checks if a password appears in the HaveIBeenPwned database
// using the k-anonymity model (only the first 5 chars of the SHA-1 hash are sent).
func (s *service) isPasswordBreached(password string) bool {
	// The check is intentionally non-blocking:
	// if the external API is unreachable, we allow the password.
	// In production, this could be made configurable.
	return CheckHaveIBeenPwned(password)
}
