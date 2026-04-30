package auth

import (
	"time"
)

// UserStatus represents the status of a user account.
type UserStatus string

const (
	UserStatusPendingVerification UserStatus = "pending_verification"
	UserStatusActive              UserStatus = "active"
	UserStatusSuspended           UserStatus = "suspended"
	UserStatusDeleted             UserStatus = "deleted"
)

// User represents a consumer account.
type User struct {
	ID              string      `json:"id"`
	Email           string      `json:"email"`
	EmailNormalized string      `json:"email_normalized"`
	DisplayName     string      `json:"display_name,omitempty"`
	Phone           string      `json:"phone,omitempty"`
	PasswordHash    string      `json:"-"`
	Status          UserStatus  `json:"status"`
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
	DeletedAt       *time.Time  `json:"deleted_at,omitempty"`
}

// Session represents a refresh token session.
type Session struct {
	ID               string    `json:"id"`
	UserID           string    `json:"user_id"`
	RefreshTokenHash string    `json:"-"`
	TokenFamily      string    `json:"token_family"`
	IsUsed           bool      `json:"is_used"`
	DeviceInfo       string    `json:"device_info,omitempty"`
	IPAddress        string    `json:"ip_address,omitempty"`
	ExpiresAt        time.Time `json:"expires_at"`
	CreatedAt        time.Time `json:"created_at"`
}

// VerificationCodeType represents the type of verification code.
type VerificationCodeType string

const (
	VerificationCodeTypeEmailVerify   VerificationCodeType = "email_verify"
	VerificationCodeTypePasswordReset VerificationCodeType = "password_reset"
)

const (
	VerificationCodeTypeEmailChange VerificationCodeType = "email_change"
)

// --- Identity (social login) ---

// IdentityProvider represents a social login provider.
type IdentityProvider string

const (
	IdentityProviderWechat IdentityProvider = "wechat"
)

// Identity represents a linked social login for a user.
type Identity struct {
	ID           string           `json:"id"`
	UserID       string           `json:"user_id"`
	Provider     IdentityProvider `json:"provider"`
	ProviderUID  string           `json:"provider_uid"`
	DisplayName  string           `json:"display_name,omitempty"`
	AvatarURL    string           `json:"avatar_url,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
	CreatedAt    time.Time        `json:"created_at"`
}

// --- Request types ---

// ForgotPasswordRequest holds the input for requesting a password reset.
type ForgotPasswordRequest struct {
	Email string `json:"email"`
}

// ResetPasswordRequest holds the input for resetting a password.
type ResetPasswordRequest struct {
	Email       string `json:"email"`
	Code        string `json:"code"`
	NewPassword string `json:"new_password"`
}

// OAuthCallbackRequest holds the input for processing an OAuth callback.
type OAuthCallbackRequest struct {
	Provider IdentityProvider `json:"provider"`
	Code     string           `json:"code"`
	State    string           `json:"state"`
}

// VerificationCode represents a one-time verification code.
type VerificationCode struct {
	ID         string                `json:"id"`
	UserID     string                `json:"user_id"`
	CodeType   VerificationCodeType  `json:"code_type"`
	CodeHash   string                `json:"-"`
	Recipient  string                `json:"recipient"`
	Attempts   int                   `json:"attempts"`
	ExpiresAt  time.Time             `json:"expires_at"`
	VerifiedAt *time.Time            `json:"verified_at,omitempty"`
	CreatedAt  time.Time             `json:"created_at"`
}

// TokenPair represents an access token + refresh token pair.
type TokenPair struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	TokenType    string    `json:"token_type"`
}

// RegisterRequest holds the input for user registration.
type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// LoginRequest holds the input for user login.
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// VerifyEmailRequest holds the input for email verification.
type VerifyEmailRequest struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

// RefreshTokenRequest holds the input for token refresh.
type RefreshTokenRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// UpdateProfileRequest holds the input for updating a user profile.
type UpdateProfileRequest struct {
	DisplayName *string `json:"display_name,omitempty"`
	Phone       *string `json:"phone,omitempty"`
}

// ChangeEmailRequest holds the input for initiating an email change.
// A verification code is sent to the new email.
type ChangeEmailRequest struct {
	NewEmail string `json:"new_email"`
}

// VerifyEmailChangeRequest holds the input for completing an email change.
type VerifyEmailChangeRequest struct {
	NewEmail string `json:"new_email"`
	Code     string `json:"code"`
}

// ChangePasswordRequest holds the input for changing a password (while logged in).
type ChangePasswordRequest struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

// SessionInfo is a user-facing session representation (no internal hashes exposed).
type SessionInfo struct {
	ID          string    `json:"id"`
	DeviceInfo  string    `json:"device_info,omitempty"`
	IPAddress   string    `json:"ip_address,omitempty"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
}

// --- E4-S7: Account Deletion ---

// DeleteAccountRequest holds the input for requesting account deletion.
// Password is required to confirm the user's identity.
type DeleteAccountRequest struct {
	Password string `json:"password"`
}

// --- E2-S5: Key Rotation ---

// KeyInfo holds metadata about a signing key.
type KeyInfo struct {
	KID        string    `json:"kid"`         // Key ID
	CreatedAt  time.Time `json:"created_at"`  // When this key was created
	ExpiresAt  time.Time `json:"expires_at"`  // When this key stops being used for verification
	PrivateKey interface{} `json:"-"`          // Private key (ECDSA, RSA, etc.) — not serialized
	PublicKey  interface{} `json:"-"`          // Public key — not serialized
	Algorithm  string    `json:"algorithm"`   // e.g. "ES256"
	IsSigning  bool      `json:"is_signing"`  // true = used for signing new tokens
	IsVerifying bool     `json:"is_verifying"` // true = used for verifying existing tokens
}
