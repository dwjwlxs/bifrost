package auth_test

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/auth"
)

// mockCodeSender captures verification codes for testing.
type mockCodeSender struct {
	codes map[string]string // recipient -> last code
}

func newMockCodeSender() *mockCodeSender {
	return &mockCodeSender{codes: make(map[string]string)}
}

func (m *mockCodeSender) SendVerificationCode(_ context.Context, recipient string, _ auth.VerificationCodeType, code string) error {
	m.codes[recipient] = code
	return nil
}

func TestRegisterAndLogin(t *testing.T) {
	config := auth.DefaultConfig()
	config.JWTIssuer = "test-issuer"
	config.JWTAudience = "test-audience"

	store := auth.NewMemoryStoreFactory()
	sender := newMockCodeSender()
	svc, err := auth.NewAuthService(config, store, sender)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}

	ctx := context.Background()

	// Register
	user, err := svc.Register(ctx, auth.RegisterRequest{
		Email:    "test@example.com",
		Password: "securePassword123",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if user.Status != auth.UserStatusPendingVerification {
		t.Errorf("expected status %s, got %s", auth.UserStatusPendingVerification, user.Status)
	}

	// Check that a verification code was generated
	code := sender.codes["test@example.com"]
	if code == "" {
		t.Fatal("expected verification code to be sent")
	}
	t.Logf("Verification code: %s", code)

	// Duplicate registration should fail
	_, err = svc.Register(ctx, auth.RegisterRequest{
		Email:    "test@example.com",
		Password: "anotherPassword123",
	})
	if err != auth.ErrUserAlreadyExists {
		t.Errorf("expected ErrUserAlreadyExists, got %v", err)
	}

	// Login before verification should fail
	_, err = svc.Login(ctx, auth.LoginRequest{
		Email:    "test@example.com",
		Password: "securePassword123",
	}, "", "")
	if err != auth.ErrUserNotVerified {
		t.Errorf("expected ErrUserNotVerified, got %v", err)
	}
}

func TestPasswordHashing(t *testing.T) {
	hasher := auth.NewPasswordHasher()

	password := "testPassword123!"

	hash, err := hasher.Hash(password)
	if err != nil {
		t.Fatalf("Hash: %v", err)
	}
	if hash == "" {
		t.Fatal("expected non-empty hash")
	}
	t.Logf("Hash: %s", hash)

	// Verify correct password
	ok, err := hasher.Verify(password, hash)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !ok {
		t.Error("expected password to verify")
	}

	// Verify wrong password
	ok, err = hasher.Verify("wrongPassword", hash)
	if err != nil {
		t.Fatalf("Verify wrong: %v", err)
	}
	if ok {
		t.Error("expected wrong password to fail")
	}
}

func TestJWTSigningAndVerification(t *testing.T) {
	jwtMgr, err := auth.NewJWTManager("", "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewJWTManager: %v", err)
	}

	userID := "user-123"
	sessionID := "session-456"
	ttl := 15 * time.Minute

	// Sign
	token, expiresAt, err := jwtMgr.Sign(userID, sessionID, ttl)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}
	t.Logf("Token: %s...", token[:50])

	// Verify
	claims, err := jwtMgr.Verify(token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}

	if claims.Sub != userID {
		t.Errorf("sub: got %s, want %s", claims.Sub, userID)
	}
	if claims.Iss != "test-issuer" {
		t.Errorf("iss: got %s, want test-issuer", claims.Iss)
	}
	if claims.SessionID != sessionID {
		t.Errorf("session_id: got %s, want %s", claims.SessionID, sessionID)
	}
	if claims.KID != jwtMgr.GetKid() {
		t.Errorf("kid: got %s, want %s", claims.KID, jwtMgr.GetKid())
	}
	if claims.Exp != expiresAt.Unix() {
		t.Errorf("exp: got %d, want %d", claims.Exp, expiresAt.Unix())
	}
}

func TestJWKS(t *testing.T) {
	jwtMgr, err := auth.NewJWTManager("", "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewJWTManager: %v", err)
	}

	jwks := jwtMgr.GetJWKS()
	if len(jwks.Keys) != 1 {
		t.Fatalf("expected 1 key, got %d", len(jwks.Keys))
	}

	key := jwks.Keys[0]
	if key.Kty != "EC" {
		t.Errorf("kty: got %s, want EC", key.Kty)
	}
	if key.Crv != "P-256" {
		t.Errorf("crv: got %s, want P-256", key.Crv)
	}
	if key.Alg != "ES256" {
		t.Errorf("alg: got %s, want ES256", key.Alg)
	}
	if key.KID != jwtMgr.GetKid() {
		t.Errorf("kid mismatch")
	}

	t.Logf("JWKS: %+v", jwks)
}

func TestVerificationCode(t *testing.T) {
	config := auth.DefaultConfig()
	config.VerificationCodeLength = 6

	store := auth.NewMemoryStoreFactory()
	verifier := auth.NewVerificationCodeManager(store.VerificationCodeRepo(), config)

	ctx := context.Background()

	// Create code
	code, err := verifier.CreateCode(ctx, "user-1", "test@example.com", auth.VerificationCodeTypeEmailVerify)
	if err != nil {
		t.Fatalf("CreateCode: %v", err)
	}
	t.Logf("Verification code: %s", code)

	if len(code) != 6 {
		t.Errorf("expected 6-digit code, got %d digits", len(code))
	}

	// Verify correct code
	vc, err := verifier.VerifyCode(ctx, "test@example.com", auth.VerificationCodeTypeEmailVerify, code)
	if err != nil {
		t.Fatalf("VerifyCode: %v", err)
	}
	if vc.VerifiedAt == nil {
		t.Error("expected VerifiedAt to be set")
	}

	// Verify same code again should fail (no more active codes)
	_, err = verifier.VerifyCode(ctx, "test@example.com", auth.VerificationCodeTypeEmailVerify, code)
	if err == nil {
		t.Error("expected error on code reuse")
	}
	t.Logf("Reuse error: %v", err)

	// Verify wrong code should fail
	code2, _ := verifier.CreateCode(ctx, "user-1", "test@example.com", auth.VerificationCodeTypeEmailVerify)
	_, err = verifier.VerifyCode(ctx, "test@example.com", auth.VerificationCodeTypeEmailVerify, "000000")
	if err != auth.ErrVerificationCodeInvalid {
		t.Errorf("expected ErrVerificationCodeInvalid, got %v", err)
	}
	t.Logf("Code2: %s (unused)", code2)
}

func TestTokenGeneration(t *testing.T) {
	token, err := auth.GenerateOpaqueToken()
	if err != nil {
		t.Fatalf("GenerateOpaqueToken: %v", err)
	}
	if len(token) == 0 {
		t.Fatal("expected non-empty token")
	}
	t.Logf("Opaque token: %s", token)

	code, err := auth.GenerateVerificationCode(6)
	if err != nil {
		t.Fatalf("GenerateVerificationCode: %v", err)
	}
	if len(code) != 6 {
		t.Errorf("expected 6-digit code, got %d digits", len(code))
	}
	t.Logf("Verification code: %s", code)
}

func TestFullRegisterVerifyLoginFlow(t *testing.T) {
	config := auth.DefaultConfig()
	config.JWTIssuer = "test-issuer"
	config.JWTAudience = "test-audience"

	store := auth.NewMemoryStoreFactory()
	sender := newMockCodeSender()
	svc, err := auth.NewAuthService(config, store, sender)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}

	ctx := context.Background()
	email := "user@test.com"
	password := "securePass123!"

	// 1. Register
	user, err := svc.Register(ctx, auth.RegisterRequest{
		Email:    email,
		Password: password,
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	t.Logf("Registered user: %s (status: %s)", user.ID, user.Status)

	// 2. Get the verification code from the mock sender
	code := sender.codes[email]
	if code == "" {
		t.Fatal("expected verification code to be sent")
	}
	t.Logf("Verification code: %s", code)

	// 3. Verify email
	tokens, err := svc.VerifyEmail(ctx, auth.VerifyEmailRequest{
		Email: email,
		Code:  code,
	})
	if err != nil {
		t.Fatalf("VerifyEmail: %v", err)
	}
	t.Logf("Tokens after verification: access=%s..., refresh=%s...", tokens.AccessToken[:30], tokens.RefreshToken[:20])

	// 4. Login
	loginTokens, err := svc.Login(ctx, auth.LoginRequest{
		Email:    email,
		Password: password,
	}, "TestDevice/1.0", "127.0.0.1")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	t.Logf("Tokens after login: access=%s..., refresh=%s...", loginTokens.AccessToken[:30], loginTokens.RefreshToken[:20])

	// 5. Validate access token
	claims, err := svc.ValidateAccessToken(ctx, loginTokens.AccessToken)
	if err != nil {
		t.Fatalf("ValidateAccessToken: %v", err)
	}
	if claims.Sub != user.ID {
		t.Errorf("sub mismatch: got %s, want %s", claims.Sub, user.ID)
	}

	// 6. Refresh token
	newTokens, err := svc.RefreshToken(ctx, auth.RefreshTokenRequest{
		RefreshToken: loginTokens.RefreshToken,
	})
	if err != nil {
		t.Fatalf("RefreshToken: %v", err)
	}
	t.Logf("Tokens after refresh: access=%s...", newTokens.AccessToken[:30])

	// 7. Old refresh token should now be invalid (replay detection)
	_, err = svc.RefreshToken(ctx, auth.RefreshTokenRequest{
		RefreshToken: loginTokens.RefreshToken,
	})
	if err != auth.ErrRefreshTokenUsed {
		t.Errorf("expected ErrRefreshTokenUsed on replay, got %v", err)
	}
}

func TestPasswordValidation(t *testing.T) {
	config := auth.DefaultConfig()
	config.PasswordMinLength = 8

	store := auth.NewMemoryStoreFactory()
	svc, err := auth.NewAuthService(config, store, nil)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}

	ctx := context.Background()

	// Too short password
	_, err = svc.Register(ctx, auth.RegisterRequest{
		Email:    "short@test.com",
		Password: "short",
	})
	if err != auth.ErrPasswordTooShort {
		t.Errorf("expected ErrPasswordTooShort, got %v", err)
	}

	// Empty email
	_, err = svc.Register(ctx, auth.RegisterRequest{
		Email:    "",
		Password: "validPassword123",
	})
	if err == nil {
		t.Error("expected error for empty email")
	}
}

func TestLogout(t *testing.T) {
	config := auth.DefaultConfig()
	config.JWTIssuer = "test-issuer"
	config.JWTAudience = "test-audience"

	store := auth.NewMemoryStoreFactory()
	sender := newMockCodeSender()
	svc, err := auth.NewAuthService(config, store, sender)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}

	ctx := context.Background()

	// Register
	_, _ = svc.Register(ctx, auth.RegisterRequest{
		Email:    "logout@test.com",
		Password: "password123!",
	})

	// Verify
	code := sender.codes["logout@test.com"]
	tokens, err := svc.VerifyEmail(ctx, auth.VerifyEmailRequest{
		Email: "logout@test.com",
		Code:  code,
	})
	if err != nil {
		t.Fatalf("VerifyEmail: %v", err)
	}

	// Logout
	err = svc.Logout(ctx, tokens.RefreshToken)
	if err != nil {
		t.Fatalf("Logout: %v", err)
	}

	// Refresh after logout should fail
	_, err = svc.RefreshToken(ctx, auth.RefreshTokenRequest{
		RefreshToken: tokens.RefreshToken,
	})
	if err != auth.ErrInvalidRefreshToken {
		t.Errorf("expected ErrInvalidRefreshToken after logout, got %v", err)
	}
}

func TestGetUser(t *testing.T) {
	config := auth.DefaultConfig()
	store := auth.NewMemoryStoreFactory()
	svc, err := auth.NewAuthService(config, store, nil)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}

	ctx := context.Background()

	// Register a user
	user, _ := svc.Register(ctx, auth.RegisterRequest{
		Email:    "getuser@test.com",
		Password: "password123!",
	})

	// Get user
	fetched, err := svc.GetUser(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if fetched.Email != "getuser@test.com" {
		t.Errorf("email mismatch: got %s", fetched.Email)
	}

	// Non-existent user
	_, err = svc.GetUser(ctx, "nonexistent")
	if err != auth.ErrUserNotFound {
		t.Errorf("expected ErrUserNotFound, got %v", err)
	}
}

func TestGetJWKS(t *testing.T) {
	config := auth.DefaultConfig()
	store := auth.NewMemoryStoreFactory()
	svc, err := auth.NewAuthService(config, store, nil)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}

	jwks := svc.GetJWKS()
	if len(jwks.Keys) != 1 {
		t.Fatalf("expected 1 key, got %d", len(jwks.Keys))
	}
	t.Logf("JWKS keys: %d", len(jwks.Keys))
}
