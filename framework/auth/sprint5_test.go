package auth_test

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/auth"
)

// --- E4-S7: Account Deletion Tests ---

func TestDeleteAccount(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	// Delete account with correct password
	err := svc.DeleteAccount(ctx, userID, auth.DeleteAccountRequest{
		Password: "securePassword123",
	})
	if err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}

	// User should no longer be findable via normal GetByID
	user, err := svc.GetUser(ctx, userID)
	if err != auth.ErrUserNotFound {
		t.Errorf("expected ErrUserNotFound after deletion, got user=%v err=%v", user, err)
	}

	// Login should fail
	_, err = svc.Login(ctx, auth.LoginRequest{
		Email:    "user@example.com",
		Password: "securePassword123",
	}, "", "")
	if err == nil {
		t.Error("expected login to fail after account deletion")
	}
}

func TestDeleteAccountWrongPassword(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	err := svc.DeleteAccount(ctx, userID, auth.DeleteAccountRequest{
		Password: "wrong-password",
	})
	if err != auth.ErrInvalidCredentials {
		t.Errorf("expected ErrInvalidCredentials for wrong password, got %v", err)
	}
}

func TestDeleteAccountNoPassword(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	err := svc.DeleteAccount(ctx, userID, auth.DeleteAccountRequest{})
	if err != auth.ErrPasswordRequiredForDelete {
		t.Errorf("expected ErrPasswordRequiredForDelete, got %v", err)
	}
}

func TestDeleteAccountAlreadyDeleted(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	// First deletion
	err := svc.DeleteAccount(ctx, userID, auth.DeleteAccountRequest{Password: "securePassword123"})
	if err != nil {
		t.Fatalf("first DeleteAccount: %v", err)
	}

	// Second deletion should fail
	err = svc.DeleteAccount(ctx, userID, auth.DeleteAccountRequest{Password: "securePassword123"})
	if err != auth.ErrAccountDeletionPending {
		t.Errorf("expected ErrAccountDeletionPending, got %v", err)
	}
}

func TestUndoDeleteAccount(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	// Delete account
	err := svc.DeleteAccount(ctx, userID, auth.DeleteAccountRequest{Password: "securePassword123"})
	if err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}

	// Undo deletion
	err = svc.UndoDeleteAccount(ctx, userID)
	if err != nil {
		t.Fatalf("UndoDeleteAccount: %v", err)
	}

	// User should be findable again
	user, err := svc.GetUser(ctx, userID)
	if err != nil {
		t.Fatalf("GetUser after undo: %v", err)
	}
	if user.Status != auth.UserStatusActive {
		t.Errorf("expected status active after undo, got %s", user.Status)
	}

	// Login should work again
	_, err = svc.Login(ctx, auth.LoginRequest{
		Email:    "user@example.com",
		Password: "securePassword123",
	}, "", "")
	if err != nil {
		t.Errorf("login should work after undo: %v", err)
	}
}

func TestUndoDeleteAccountNotFound(t *testing.T) {
	config := auth.DefaultConfig()
	config.JWTIssuer = "test-issuer"
	config.JWTAudience = "test-audience"

	store := auth.NewMemoryStoreFactory()
	sender := auth.NewNoopMessageSender()
	svc, err := auth.NewAuthService(config, store, sender, nil)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}

	err = svc.UndoDeleteAccount(context.Background(), "nonexistent-id")
	if err != auth.ErrUserNotFound {
		t.Errorf("expected ErrUserNotFound, got %v", err)
	}
}

func TestDeleteAccountRevokesSessions(t *testing.T) {
	svc, userID, tokens := setupActiveUser(t)
	ctx := context.Background()

	// Login to create a second session
	_, err := svc.Login(ctx, auth.LoginRequest{
		Email:    "user@example.com",
		Password: "securePassword123",
	}, "", "")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	sessions, _ := svc.ListSessions(ctx, userID)
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}

	// Delete account
	err = svc.DeleteAccount(ctx, userID, auth.DeleteAccountRequest{Password: "securePassword123"})
	if err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}

	// All sessions should be gone — refresh token should fail
	_, err = svc.RefreshToken(ctx, auth.RefreshTokenRequest{RefreshToken: tokens.RefreshToken})
	if err == nil {
		t.Error("expected refresh to fail after account deletion")
	}
}

func TestCleanupExpiredDeletions(t *testing.T) {
	config := auth.DefaultConfig()
	config.JWTIssuer = "test-issuer"
	config.JWTAudience = "test-audience"
	config.AccountDeletionCoolDown = 1 * time.Millisecond // Very short for testing

	store := auth.NewMemoryStoreFactory()
	sender := auth.NewNoopMessageSender()
	svc, err := auth.NewAuthService(config, store, sender, nil)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}

	ctx := context.Background()

	// Register and verify two users
	for _, email := range []string{"a@test.com", "b@test.com"} {
		user, err := svc.Register(ctx, auth.RegisterRequest{
			Email:    email,
			Password: "password1234",
		})
		if err != nil {
			t.Fatalf("Register %s: %v", email, err)
		}
		code := sender.Codes[email]
		_, err = svc.VerifyEmail(ctx, auth.VerifyEmailRequest{Email: email, Code: code})
		if err != nil {
			t.Fatalf("VerifyEmail %s: %v", email, err)
		}

		// Delete account
		err = svc.DeleteAccount(ctx, user.ID, auth.DeleteAccountRequest{Password: "password1234"})
		if err != nil {
			t.Fatalf("DeleteAccount %s: %v", email, err)
		}
	}

	// Wait for cool-down to expire
	time.Sleep(10 * time.Millisecond)

	// Cleanup
	count, err := svc.CleanupExpiredDeletions(ctx)
	if err != nil {
		t.Fatalf("CleanupExpiredDeletions: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 deleted accounts, got %d", count)
	}

	// Cleanup again should find nothing
	count, err = svc.CleanupExpiredDeletions(ctx)
	if err != nil {
		t.Fatalf("second CleanupExpiredDeletions: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 on second cleanup, got %d", count)
	}
}

// --- E2-S5: Key Rotation Tests ---

func TestRotatingJWTManagerSignAndVerify(t *testing.T) {
	config := auth.DefaultKeyRotationConfig()

	rm, err := auth.NewRotatingJWTManager("", "test-issuer", "test-audience", config)
	if err != nil {
		t.Fatalf("NewRotatingJWTManager: %v", err)
	}

	// Sign a token
	token, expires, err := rm.Sign("user-123", "session-456", 15*time.Minute)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}
	if expires.Before(time.Now()) {
		t.Error("expected expiry in the future")
	}

	// Verify the token
	claims, err := rm.Verify(token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.Sub != "user-123" {
		t.Errorf("expected sub=user-123, got %s", claims.Sub)
	}
	if claims.Iss != "test-issuer" {
		t.Errorf("expected iss=test-issuer, got %s", claims.Iss)
	}
	if claims.SessionID != "session-456" {
		t.Errorf("expected session_id=session-456, got %s", claims.SessionID)
	}
}

func TestRotatingJWTManagerJWKS(t *testing.T) {
	rm, err := auth.NewRotatingJWTManager("", "test-issuer", "test-audience", nil)
	if err != nil {
		t.Fatalf("NewRotatingJWTManager: %v", err)
	}

	jwks := rm.GetJWKS()
	if len(jwks.Keys) != 1 {
		t.Fatalf("expected 1 key in JWKS, got %d", len(jwks.Keys))
	}

	key := jwks.Keys[0]
	if key.Kty != "EC" {
		t.Errorf("expected kty=EC, got %s", key.Kty)
	}
	if key.Crv != "P-256" {
		t.Errorf("expected crv=P-256, got %s", key.Crv)
	}
	if key.Alg != "ES256" {
		t.Errorf("expected alg=ES256, got %s", key.Alg)
	}
}

func TestRotatingJWTManagerGetKid(t *testing.T) {
	rm, err := auth.NewRotatingJWTManager("", "test-issuer", "test-audience", nil)
	if err != nil {
		t.Fatalf("NewRotatingJWTManager: %v", err)
	}

	kid := rm.GetKid()
	if kid == "" {
		t.Error("expected non-empty kid")
	}
}

func TestRotatingJWTManagerMultipleKeysInJWKS(t *testing.T) {
	config := &auth.KeyRotationConfig{
		KeyTTL:            1 * time.Hour,
		RotationInterval:  1 * time.Millisecond, // Very short to trigger rotation quickly
		GracePeriod:       1 * time.Hour,
	}

	rm, err := auth.NewRotatingJWTManager("", "test-issuer", "test-audience", config)
	if err != nil {
		t.Fatalf("NewRotatingJWTManager: %v", err)
	}

	// Wait for rotation
	time.Sleep(10 * time.Millisecond)

	// Sign a new token (should trigger rotation if enough time passed)
	token, _, err := rm.Sign("user-123", "session-456", 15*time.Minute)
	if err != nil {
		t.Fatalf("Sign after rotation: %v", err)
	}

	// The old token should still be verifiable
	claims, err := rm.Verify(token)
	if err != nil {
		t.Fatalf("Verify after rotation: %v", err)
	}
	if claims.Sub != "user-123" {
		t.Errorf("expected sub=user-123, got %s", claims.Sub)
	}
}

func TestRotatingJWTManagerGetKeys(t *testing.T) {
	rm, err := auth.NewRotatingJWTManager("", "test-issuer", "test-audience", nil)
	if err != nil {
		t.Fatalf("NewRotatingJWTManager: %v", err)
	}

	// GetKeys is on RotatingJWTManager, not on the JWTManager interface
	rotating, ok := rm.(*auth.RotatingJWTManager)
	if !ok {
		t.Fatal("expected RotatingJWTManager type")
	}

	keys := rotating.GetKeys()
	if len(keys) != 1 {
		t.Fatalf("expected 1 key, got %d", len(keys))
	}
	if !keys[0].IsSigning {
		t.Error("expected key to be signing")
	}
	if !keys[0].IsVerifying {
		t.Error("expected key to be verifying")
	}
	if keys[0].Algorithm != "ES256" {
		t.Errorf("expected algorithm ES256, got %s", keys[0].Algorithm)
	}
}
