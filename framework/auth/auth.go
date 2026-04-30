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
}

// service is the concrete implementation of AuthService.
type service struct {
	config      *Config
	hasher      PasswordHasher
	jwtManager  JWTManager
	tokenGen    *TokenGenerator
	verifier    *VerificationCodeManager
	codeSender  MessageSender
	store       StoreFactory
	rateLimiter RateLimiter
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

	return &service{
		config:      config,
		hasher:      hasher,
		jwtManager:  jwtManager,
		tokenGen:    tokenGen,
		verifier:    verifier,
		codeSender:  codeSender,
		store:       store,
		rateLimiter: rateLimiter,
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
