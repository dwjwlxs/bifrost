package auth

import "time"

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
