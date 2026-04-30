package auth

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// AuthService defines the public interface for consumer authentication.
// Implementations should be safe for concurrent use.
type AuthService interface {
	// Register creates a new user account with email+password.
	// The account starts in "pending_verification" status.
	// A verification code is generated and sent via the configured CodeSender.
	// Returns the created user (without password hash).
	Register(ctx context.Context, req RegisterRequest) (*User, error)

	// VerifyEmail validates the email verification code and activates the account.
	// On success, returns a token pair (access + refresh).
	VerifyEmail(ctx context.Context, req VerifyEmailRequest) (*TokenPair, error)

	// Login authenticates a user with email+password and returns a token pair.
	// Checks account status, verification, and lockout before issuing tokens.
	Login(ctx context.Context, req LoginRequest, deviceInfo string, ipAddress string) (*TokenPair, error)

	// RefreshToken exchanges a valid refresh token for a new token pair.
	// Implements rotation: the old refresh token is invalidated, and a new one is issued.
	// If the old token is reused (replay detection), all tokens in the family are revoked.
	RefreshToken(ctx context.Context, req RefreshTokenRequest) (*TokenPair, error)

	// Logout revokes a specific refresh token (the session it belongs to).
	Logout(ctx context.Context, refreshToken string) error

	// LogoutAll revokes all sessions for a user.
	LogoutAll(ctx context.Context, userID string) error

	// ValidateAccessToken validates a JWT access token and returns the claims.
	ValidateAccessToken(ctx context.Context, tokenString string) (*JWTClaims, error)

	// GetUser retrieves a user by ID.
	GetUser(ctx context.Context, userID string) (*User, error)

	// GetJWKS returns the public keys in JWKS format for external verification.
	GetJWKS() JWKS

	// ForgotPassword sends a password reset code to the user's email.
	// If the email is not registered, the method returns nil (no-op) to prevent email enumeration.
	ForgotPassword(ctx context.Context, req ForgotPasswordRequest) error

	// ResetPassword validates the password reset code and sets the new password.
	// On success, all other sessions for the user are revoked.
	ResetPassword(ctx context.Context, req ResetPasswordRequest) error

	// OAuthLogin processes an OAuth2 authorization code and returns a token pair.
	// If the user already has a linked identity, they are logged in.
	// If the user is new, an account is created automatically (auto-registration).
	OAuthLogin(ctx context.Context, req OAuthCallbackRequest, deviceInfo string, ipAddress string) (*TokenPair, error)

	// GetOAuthAuthURL returns the OAuth2 authorization URL for the given provider.
	// The state parameter is used for CSRF protection.
	GetOAuthAuthURL(provider IdentityProvider, state string) (string, error)

	// --- Sprint 4: Session & Profile Management ---

	// ListSessions returns all active (non-expired) sessions for a user.
	ListSessions(ctx context.Context, userID string) ([]*SessionInfo, error)

	// RevokeSession revokes a specific session by ID.
	// Returns ErrNotSessionOwner if the session doesn't belong to the user.
	RevokeSession(ctx context.Context, userID string, sessionID string) error

	// GetProfile returns the user's public profile (without password hash).
	GetProfile(ctx context.Context, userID string) (*User, error)

	// UpdateProfile updates the user's profile fields (display name, phone, etc.).
	UpdateProfile(ctx context.Context, userID string, req UpdateProfileRequest) (*User, error)

	// ChangeEmail initiates an email change by sending a verification code to the new email.
	// The old email is NOT changed until VerifyEmailChange is called.
	ChangeEmail(ctx context.Context, userID string, req ChangeEmailRequest) error

	// VerifyEmailChange completes the email change using the verification code.
	VerifyEmailChange(ctx context.Context, userID string, req VerifyEmailChangeRequest) error

	// ChangePassword changes the user's password after verifying the old password.
	// All other sessions are revoked after a successful password change.
	ChangePassword(ctx context.Context, userID string, req ChangePasswordRequest) error
}

// service is the concrete implementation of AuthService.
type service struct {
	config        *Config
	hasher        PasswordHasher
	jwtManager    JWTManager
	tokenGen      *TokenGenerator
	verifier      *VerificationCodeManager
	codeSender    MessageSender
	store         StoreFactory
	rateLimiter   RateLimiter
	oauthRegistry *OAuthProviderRegistry
}

// NewAuthService creates a new AuthService with the given configuration and storage backend.
// If the JWKS private key is not configured, a new ES256 key pair is generated.
// If codeSender is nil, a NoopCodeSender is used.
// If rateLimiter is nil, a NoopRateLimiter is used.
func NewAuthService(config *Config, store StoreFactory, codeSender MessageSender, rateLimiter RateLimiter) (AuthService, error) {
	if config == nil {
		config = DefaultConfig()
	}

	// Initialize JWT manager
	var privatePEM string
	if config.JWKSKeyPair != nil {
		privatePEM = config.JWKSKeyPair.PrivateKeyPEM
	}
	jwtManager, err := NewJWTManager(privatePEM, config.JWTIssuer, config.JWTAudience)
	if err != nil {
		return nil, fmt.Errorf("auth: failed to create JWT manager: %w", err)
	}

	if codeSender == nil {
		codeSender = &NoopMessageSender{}
	}

	if rateLimiter == nil {
		rateLimiter = &NoopRateLimiter{}
	}

	hasher := NewPasswordHasher()
	tokenGen := NewTokenGenerator(jwtManager, config)
	verifier := NewVerificationCodeManager(store.VerificationCodeRepo(), config)
	oauthRegistry := NewOAuthProviderRegistry(config.OAuth)

	return &service{
		config:        config,
		hasher:        hasher,
		jwtManager:    jwtManager,
		tokenGen:      tokenGen,
		verifier:      verifier,
		codeSender:    codeSender,
		store:         store,
		rateLimiter:   rateLimiter,
		oauthRegistry: oauthRegistry,
	}, nil
}

// --- Register ---

func (s *service) Register(ctx context.Context, req RegisterRequest) (*User, error) {
	email := normalizeEmail(req.Email)

	// Validate email
	if email == "" {
		return nil, fmt.Errorf("auth: email is required")
	}
	if !strings.Contains(email, "@") {
		return nil, fmt.Errorf("auth: invalid email format")
	}

	// Validate password length
	if len(req.Password) < s.config.PasswordMinLength {
		return nil, ErrPasswordTooShort
	}

	// Check if email already exists
	exists, err := s.store.UserRepo().EmailExists(ctx, email)
	if err != nil {
		return nil, fmt.Errorf("auth: failed to check email: %w", err)
	}
	if exists {
		return nil, ErrUserAlreadyExists
	}

	// Hash password
	hash, err := s.hasher.Hash(req.Password)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	userID := uuid.New().String()
	user := &User{
		ID:              userID,
		Email:           req.Email,
		EmailNormalized: email,
		PasswordHash:    hash,
		Status:          UserStatusPendingVerification,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if err := s.store.UserRepo().Create(ctx, user); err != nil {
		return nil, fmt.Errorf("auth: failed to create user: %w", err)
	}

	// Generate and send verification code
	code, err := s.verifier.CreateCode(ctx, userID, email, VerificationCodeTypeEmailVerify)
	if err != nil {
		// User was created but code generation failed. Log but don't fail the registration.
		// The user can request a new code later.
		return user, nil
	}

	// Send the code (fire and forget — failures are non-fatal)
	_ = s.codeSender.SendVerificationCode(ctx, email, VerificationCodeTypeEmailVerify, code)

	return user, nil
}

// --- VerifyEmail ---

func (s *service) VerifyEmail(ctx context.Context, req VerifyEmailRequest) (*TokenPair, error) {
	email := normalizeEmail(req.Email)

	// Get user
	user, err := s.store.UserRepo().GetByEmail(ctx, email)
	if err != nil {
		return nil, ErrUserNotFound
	}

	// Check user status
	switch user.Status {
	case UserStatusActive:
		return nil, fmt.Errorf("auth: email already verified")
	case UserStatusSuspended:
		return nil, ErrUserSuspended
	case UserStatusDeleted:
		return nil, ErrUserDeleted
	}

	// Verify the code
	_, err = s.verifier.VerifyCode(ctx, email, VerificationCodeTypeEmailVerify, req.Code)
	if err != nil {
		return nil, err
	}

	// Activate user
	now := time.Now()
	user.Status = UserStatusActive
	user.UpdatedAt = now
	if err := s.store.UserRepo().Update(ctx, user); err != nil {
		return nil, fmt.Errorf("auth: failed to activate user: %w", err)
	}

	// Issue token pair
	sessionID := uuid.New().String()
	tokens, err := s.tokenGen.GenerateTokenPair(user.ID, sessionID)
	if err != nil {
		return nil, err
	}

	// Store session
	rtHash := HashSHA256Base64(tokens.RefreshToken)
	if err := s.store.SessionRepo().Create(ctx, &Session{
		ID:               sessionID,
		UserID:           user.ID,
		RefreshTokenHash: rtHash,
		TokenFamily:      uuid.New().String(),
		ExpiresAt:        time.Now().Add(s.config.RefreshTokenTTL),
		CreatedAt:        now,
	}); err != nil {
		return nil, fmt.Errorf("auth: failed to create session: %w", err)
	}

	return tokens, nil
}

// --- Login ---

func (s *service) Login(ctx context.Context, req LoginRequest, deviceInfo string, ipAddress string) (*TokenPair, error) {
	email := normalizeEmail(req.Email)

	// Get user
	user, err := s.store.UserRepo().GetByEmail(ctx, email)
	if err != nil {
		// Don't reveal whether the user exists
		// Still check rate limiting for IP
		attempts, _ := s.rateLimiter.IncrementLoginAttempts(ctx, ipAddress)
		if attempts > int64(s.config.LoginMaxAttempts) {
			return nil, ErrAccountLocked
		}
		return nil, ErrInvalidCredentials
	}

	// Check if account is locked due to too many failed attempts
	locked, err := s.rateLimiter.IsAccountLocked(ctx, user.ID)
	if err != nil {
		return nil, fmt.Errorf("auth: failed to check account lockout: %w", err)
	}
	if locked {
		return nil, ErrAccountLocked
	}

	// Check status
	switch user.Status {
	case UserStatusPendingVerification:
		return nil, ErrUserNotVerified
	case UserStatusSuspended:
		return nil, ErrUserSuspended
	case UserStatusDeleted:
		return nil, ErrInvalidCredentials
	}

	// Verify password
	ok, err := s.hasher.Verify(req.Password, user.PasswordHash)
	if err != nil || !ok {
		// Increment failed login attempts
		failedCount, _ := s.rateLimiter.IncrementFailedLogins(ctx, user.ID)
		if failedCount >= int64(s.config.LoginMaxAttempts) {
			// Lock the account
			_ = s.rateLimiter.SetAccountLockout(ctx, user.ID, s.config.LoginLockoutDuration)
		}
		return nil, ErrInvalidCredentials
	}

	// Reset failed login attempts on successful login
	_ = s.rateLimiter.ResetFailedLogins(ctx, user.ID)

	// Issue token pair
	sessionID := uuid.New().String()
	tokens, err := s.tokenGen.GenerateTokenPair(user.ID, sessionID)
	if err != nil {
		return nil, err
	}

	// Store session
	rtHash := HashSHA256Base64(tokens.RefreshToken)
	if err := s.store.SessionRepo().Create(ctx, &Session{
		ID:               sessionID,
		UserID:           user.ID,
		RefreshTokenHash: rtHash,
		TokenFamily:      uuid.New().String(),
		DeviceInfo:       deviceInfo,
		IPAddress:        ipAddress,
		ExpiresAt:        time.Now().Add(s.config.RefreshTokenTTL),
		CreatedAt:        time.Now(),
	}); err != nil {
		return nil, fmt.Errorf("auth: failed to create session: %w", err)
	}

	return tokens, nil
}

// --- RefreshToken ---

func (s *service) RefreshToken(ctx context.Context, req RefreshTokenRequest) (*TokenPair, error) {
	rtHash := HashSHA256Base64(req.RefreshToken)

	// Find session by refresh token hash
	session, err := s.store.SessionRepo().GetByRefreshTokenHash(ctx, rtHash)
	if err != nil {
		return nil, ErrInvalidRefreshToken
	}
	if session == nil {
		return nil, ErrInvalidRefreshToken
	}

	// Check expiry
	if time.Now().After(session.ExpiresAt) {
		_ = s.store.SessionRepo().Delete(ctx, session.ID)
		return nil, ErrRefreshTokenExpired
	}

	// Check if token was already used (replay detection)
	if session.IsUsed {
		// REPLAY DETECTED: revoke the entire token family
		_ = s.store.SessionRepo().RevokeFamily(ctx, session.TokenFamily)
		return nil, ErrRefreshTokenUsed
	}

	// Mark old session as used
	if err := s.store.SessionRepo().MarkUsed(ctx, session.ID); err != nil {
		return nil, fmt.Errorf("auth: failed to mark session used: %w", err)
	}

	// Issue new token pair with the SAME family
	newSessionID := uuid.New().String()
	tokens, err := s.tokenGen.GenerateTokenPair(session.UserID, newSessionID)
	if err != nil {
		return nil, err
	}

	// Create new session preserving the token family
	newRTHash := HashSHA256Base64(tokens.RefreshToken)
	if err := s.store.SessionRepo().Create(ctx, &Session{
		ID:               newSessionID,
		UserID:           session.UserID,
		RefreshTokenHash: newRTHash,
		TokenFamily:      session.TokenFamily, // preserve family
		DeviceInfo:       session.DeviceInfo,
		IPAddress:        session.IPAddress,
		ExpiresAt:        time.Now().Add(s.config.RefreshTokenTTL),
		CreatedAt:        time.Now(),
	}); err != nil {
		return nil, fmt.Errorf("auth: failed to create new session: %w", err)
	}

	return tokens, nil
}

// --- Logout ---

func (s *service) Logout(ctx context.Context, refreshToken string) error {
	rtHash := HashSHA256Base64(refreshToken)
	session, err := s.store.SessionRepo().GetByRefreshTokenHash(ctx, rtHash)
	if err != nil || session == nil {
		// Silently succeed even if token doesn't exist
		return nil
	}
	return s.store.SessionRepo().Delete(ctx, session.ID)
}

func (s *service) LogoutAll(ctx context.Context, userID string) error {
	return s.store.SessionRepo().DeleteByUserID(ctx, userID)
}

// --- ValidateAccessToken ---

func (s *service) ValidateAccessToken(ctx context.Context, tokenString string) (*JWTClaims, error) {
	return s.jwtManager.Verify(tokenString)
}

// --- GetUser ---

func (s *service) GetUser(ctx context.Context, userID string) (*User, error) {
	user, err := s.store.UserRepo().GetByID(ctx, userID)
	if err != nil {
		return nil, ErrUserNotFound
	}
	return user, nil
}

// --- GetJWKS ---

func (s *service) GetJWKS() JWKS {
	return s.jwtManager.GetJWKS()
}

// --- helpers ---

// normalizeEmail lowercases and trims the email.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// generateUUID creates a new UUID v4 string.
func generateUUID() string {
	return uuid.New().String()
}

// --- ForgotPassword ---

func (s *service) ForgotPassword(ctx context.Context, req ForgotPasswordRequest) error {
	email := normalizeEmail(req.Email)
	if email == "" || !strings.Contains(email, "@") {
		// Silently succeed to prevent email enumeration
		return nil
	}

	// Look up user — if not found, return nil (no-op)
	user, err := s.store.UserRepo().GetByEmail(ctx, email)
	if err != nil || user == nil {
		return nil
	}

	// Only allow password reset for active accounts
	if user.Status != UserStatusActive {
		return nil
	}

	// Generate and send password reset code
	code, err := s.verifier.CreateCode(ctx, user.ID, email, VerificationCodeTypePasswordReset)
	if err != nil {
		// Log but don't expose internal errors
		return nil
	}

	// Send the code (fire and forget)
	_ = s.codeSender.SendVerificationCode(ctx, email, VerificationCodeTypePasswordReset, code)

	return nil
}

// --- ResetPassword ---

func (s *service) ResetPassword(ctx context.Context, req ResetPasswordRequest) error {
	email := normalizeEmail(req.Email)

	// Validate input
	if email == "" || req.Code == "" || req.NewPassword == "" {
		return ErrPasswordResetInvalid
	}

	if len(req.NewPassword) < s.config.PasswordMinLength {
		return ErrPasswordTooShort
	}

	// Look up user
	user, err := s.store.UserRepo().GetByEmail(ctx, email)
	if err != nil || user == nil {
		return ErrPasswordResetInvalid
	}

	// Verify the code
	_, err = s.verifier.VerifyCode(ctx, email, VerificationCodeTypePasswordReset, req.Code)
	if err != nil {
		return ErrPasswordResetInvalid
	}

	// Hash the new password
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

	// Revoke all other sessions (force re-login everywhere else)
	_ = s.store.SessionRepo().DeleteByUserID(ctx, user.ID)

	return nil
}

// --- OAuthLogin ---

func (s *service) GetOAuthAuthURL(provider IdentityProvider, state string) (string, error) {
	p := s.oauthRegistry.Get(provider)
	if p == nil {
		return "", ErrOAuthProviderDisabled
	}
	return p.AuthCodeURL(state), nil
}

func (s *service) OAuthLogin(ctx context.Context, req OAuthCallbackRequest, deviceInfo string, ipAddress string) (*TokenPair, error) {
	provider := s.oauthRegistry.Get(req.Provider)
	if provider == nil {
		return nil, ErrOAuthProviderDisabled
	}

	// Exchange code for user info
	userInfo, err := provider.Exchange(ctx, req.Code)
	if err != nil {
		return nil, err
	}

	// Check if identity already exists
	identity, err := s.store.IdentityRepo().GetByProviderAndUID(ctx, userInfo.Provider, userInfo.ProviderUID)
	if err == nil && identity != nil {
		// Existing user — check status and issue tokens
		user, err := s.store.UserRepo().GetByID(ctx, identity.UserID)
		if err != nil {
			return nil, ErrUserNotFound
		}

		switch user.Status {
		case UserStatusSuspended:
			return nil, ErrUserSuspended
		case UserStatusDeleted:
			return nil, ErrUserDeleted
		case UserStatusPendingVerification:
			// OAuth users are automatically verified
			user.Status = UserStatusActive
			user.UpdatedAt = time.Now()
			if err := s.store.UserRepo().Update(ctx, user); err != nil {
				return nil, fmt.Errorf("auth: failed to activate user: %w", err)
			}
		}

		return s.issueTokenPair(ctx, user.ID, deviceInfo, ipAddress, "")
	}

	// New user — auto-register
	now := time.Now()
	userID := uuid.New().String()
	email := userInfo.Email
	emailNormalized := normalizeEmail(email)

	// Check if email already exists (link identity to existing account)
	if emailNormalized != "" {
		existingUser, err := s.store.UserRepo().GetByEmail(ctx, emailNormalized)
		if err == nil && existingUser != nil {
			// Link to existing account
			identity = &Identity{
				ID:          uuid.New().String(),
				UserID:      existingUser.ID,
				Provider:    userInfo.Provider,
				ProviderUID: userInfo.ProviderUID,
				DisplayName: userInfo.DisplayName,
				AvatarURL:   userInfo.AvatarURL,
				CreatedAt:   now,
			}
			if err := s.store.IdentityRepo().Create(ctx, identity); err != nil {
				return nil, fmt.Errorf("auth: failed to create identity: %w", err)
			}

			// Ensure user is active
			if existingUser.Status != UserStatusActive {
				existingUser.Status = UserStatusActive
				existingUser.UpdatedAt = now
				_ = s.store.UserRepo().Update(ctx, existingUser)
			}

			return s.issueTokenPair(ctx, existingUser.ID, deviceInfo, ipAddress, "")
		}
	}

	// Create new user (password hash is nil for OAuth-only accounts)
	user := &User{
		ID:              userID,
		Email:           email,
		EmailNormalized: emailNormalized,
		Status:          UserStatusActive, // OAuth users are auto-verified
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if err := s.store.UserRepo().Create(ctx, user); err != nil {
		return nil, fmt.Errorf("auth: failed to create user: %w", err)
	}

	// Create identity
	identity = &Identity{
		ID:          uuid.New().String(),
		UserID:      userID,
		Provider:    userInfo.Provider,
		ProviderUID: userInfo.ProviderUID,
		DisplayName: userInfo.DisplayName,
		AvatarURL:   userInfo.AvatarURL,
		CreatedAt:   now,
	}
	if err := s.store.IdentityRepo().Create(ctx, identity); err != nil {
		return nil, fmt.Errorf("auth: failed to create identity: %w", err)
	}

	return s.issueTokenPair(ctx, userID, deviceInfo, ipAddress, "")
}

// issueTokenPair creates a session and returns a token pair.
// familyID can be empty for new sessions.
func (s *service) issueTokenPair(ctx context.Context, userID, deviceInfo, ipAddress, familyID string) (*TokenPair, error) {
	sessionID := uuid.New().String()
	tokens, err := s.tokenGen.GenerateTokenPair(userID, sessionID)
	if err != nil {
		return nil, err
	}

	if familyID == "" {
		familyID = uuid.New().String()
	}

	rtHash := HashSHA256Base64(tokens.RefreshToken)
	if err := s.store.SessionRepo().Create(ctx, &Session{
		ID:               sessionID,
		UserID:           userID,
		RefreshTokenHash: rtHash,
		TokenFamily:      familyID,
		DeviceInfo:       deviceInfo,
		IPAddress:        ipAddress,
		ExpiresAt:        time.Now().Add(s.config.RefreshTokenTTL),
		CreatedAt:        time.Now(),
	}); err != nil {
		return nil, fmt.Errorf("auth: failed to create session: %w", err)
	}

	return tokens, nil
}
