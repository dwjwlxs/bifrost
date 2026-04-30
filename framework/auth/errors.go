package auth

import "errors"

// Sentinel errors for the auth package.
var (
	// User errors
	ErrUserNotFound      = errors.New("auth: user not found")
	ErrUserAlreadyExists = errors.New("auth: user already exists with this email")
	ErrInvalidCredentials = errors.New("auth: invalid email or password")
	ErrUserNotVerified   = errors.New("auth: user email not verified")
	ErrUserSuspended     = errors.New("auth: user account suspended")
	ErrUserDeleted       = errors.New("auth: user account deleted or not found")
	ErrAccountLocked     = errors.New("auth: account locked due to too many failed attempts")

	// Verification code errors
	ErrVerificationCodeInvalid     = errors.New("auth: invalid verification code")
	ErrVerificationCodeExpired     = errors.New("auth: verification code expired")
	ErrVerificationCodeMaxAttempts = errors.New("auth: verification code max attempts exceeded")

	// Token errors
	ErrInvalidRefreshToken  = errors.New("auth: invalid refresh token")
	ErrRefreshTokenExpired  = errors.New("auth: refresh token expired")
	ErrRefreshTokenUsed     = errors.New("auth: refresh token already used (replay detected)")
	ErrInvalidAccessToken   = errors.New("auth: invalid access token")
	ErrAccessTokenExpired   = errors.New("auth: access token expired")

	// Password errors
	ErrPasswordTooShort     = errors.New("auth: password is too short")
	ErrPasswordHashFailed   = errors.New("auth: failed to hash password")
	ErrPasswordVerifyFailed = errors.New("auth: failed to verify password")

	// Password reset errors
	ErrPasswordResetInvalid = errors.New("auth: invalid or expired password reset code")

	// OAuth errors
	ErrOAuthProviderDisabled = errors.New("auth: OAuth provider is disabled")
	ErrOAuthInvalidCode      = errors.New("auth: invalid OAuth authorization code")
	ErrOAuthStateMismatch    = errors.New("auth: OAuth state mismatch")
	ErrOAuthUnsupported      = errors.New("auth: unsupported OAuth provider")

	// Configuration errors
	ErrMissingJWTKey = errors.New("auth: JWT signing key not configured")

	// Session management errors
	ErrSessionNotFound = errors.New("auth: session not found")
	ErrNotSessionOwner = errors.New("auth: user does not own this session")

	// Profile errors
	ErrEmailAlreadyInUse = errors.New("auth: email is already in use by another account")
	ErrOldPasswordIncorrect = errors.New("auth: current password is incorrect")
	ErrPasswordSame = errors.New("auth: new password must be different from current password")

	// Email change errors
	ErrEmailChangeInvalid = errors.New("auth: invalid or expired email change code")

	// Breached password errors
	ErrPasswordBreached = errors.New("auth: this password has been found in a data breach and cannot be used")
)
