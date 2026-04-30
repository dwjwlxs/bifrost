package auth_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/maximhq/bifrost/framework/auth"
)

// helper to create an active user with tokens.
func setupActiveUser(t *testing.T) (auth.AuthService, string, *auth.TokenPair) {
	t.Helper()
	config := auth.DefaultConfig()
	config.JWTIssuer = "test-issuer"
	config.JWTAudience = "test-audience"

	store := auth.NewMemoryStoreFactory()
	sender := auth.NewNoopMessageSender()
	svc, err := auth.NewAuthService(config, store, sender, nil)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}

	ctx := context.Background()

	// Register
	user, err := svc.Register(ctx, auth.RegisterRequest{
		Email:    "user@example.com",
		Password: "securePassword123",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Verify email
	code := sender.Codes["user@example.com"]
	tokens, err := svc.VerifyEmail(ctx, auth.VerifyEmailRequest{
		Email: "user@example.com",
		Code:  code,
	})
	if err != nil {
		t.Fatalf("VerifyEmail: %v", err)
	}

	return svc, user.ID, tokens
}

// --- E4-S1: List Sessions ---

func TestListSessions(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	// After registration + verify, there should be 1 session
	sessions, err := svc.ListSessions(ctx, userID)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 1 {
		t.Errorf("expected 1 session, got %d", len(sessions))
	}
	if sessions[0].ID == "" {
		t.Error("session ID should not be empty")
	}

	// Login again → should have 2 sessions
	_, err = svc.Login(ctx, auth.LoginRequest{
		Email:    "user@example.com",
		Password: "securePassword123",
	}, "test-device", "127.0.0.1")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	sessions, err = svc.ListSessions(ctx, userID)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 2 {
		t.Errorf("expected 2 sessions, got %d", len(sessions))
	}
}

func TestListSessionsEmpty(t *testing.T) {
	config := auth.DefaultConfig()
	config.JWTIssuer = "test-issuer"
	config.JWTAudience = "test-audience"

	store := auth.NewMemoryStoreFactory()
	sender := auth.NewNoopMessageSender()
	svc, err := auth.NewAuthService(config, store, sender, nil)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}

	// Non-existent user should return empty list
	sessions, err := svc.ListSessions(context.Background(), "non-existent-user")
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(sessions))
	}
}

// --- E4-S2: Revoke Session ---

func TestRevokeSession(t *testing.T) {
	svc, userID, tokens := setupActiveUser(t)
	ctx := context.Background()

	// Validate the access token to get session info, or use ListSessions
	sessions, err := svc.ListSessions(ctx, userID)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) == 0 {
		t.Fatal("expected at least 1 session")
	}

	// Revoke the session
	err = svc.RevokeSession(ctx, userID, sessions[0].ID)
	if err != nil {
		t.Fatalf("RevokeSession: %v", err)
	}

	// Verify session is gone
	sessions, err = svc.ListSessions(ctx, userID)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions after revoke, got %d", len(sessions))
	}

	// Refresh token should no longer work
	_, err = svc.RefreshToken(ctx, auth.RefreshTokenRequest{
		RefreshToken: tokens.RefreshToken,
	})
	if err != auth.ErrInvalidRefreshToken {
		t.Errorf("expected ErrInvalidRefreshToken after revoke, got %v", err)
	}
}

func TestRevokeSessionWrongOwner(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	// List sessions to get a valid session ID
	sessions, err := svc.ListSessions(ctx, userID)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}

	// Try to revoke with a wrong user ID
	err = svc.RevokeSession(ctx, "wrong-user-id", sessions[0].ID)
	if err != auth.ErrNotSessionOwner {
		t.Errorf("expected ErrNotSessionOwner, got %v", err)
	}
}

func TestRevokeSessionNotFound(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	err := svc.RevokeSession(ctx, userID, "non-existent-session")
	if err != auth.ErrSessionNotFound {
		t.Errorf("expected ErrSessionNotFound, got %v", err)
	}
}

// --- E4-S4: Profile ---

func TestGetProfile(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	profile, err := svc.GetProfile(ctx, userID)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if profile.Email != "user@example.com" {
		t.Errorf("expected email user@example.com, got %s", profile.Email)
	}
	if profile.Status != auth.UserStatusActive {
		t.Errorf("expected status active, got %s", profile.Status)
	}
	// PasswordHash should not be serialized to JSON (json:"-" tag)
	data, _ := json.Marshal(profile)
	if strings.Contains(string(data), "password_hash") || strings.Contains(string(data), profile.PasswordHash) {
		t.Error("password hash should not appear in JSON output")
	}
}

func TestGetProfileNotFound(t *testing.T) {
	config := auth.DefaultConfig()
	store := auth.NewMemoryStoreFactory()
	svc, _ := auth.NewAuthService(config, store, auth.NewNoopMessageSender(), nil)

	_, err := svc.GetProfile(context.Background(), "non-existent")
	if err != auth.ErrUserNotFound {
		t.Errorf("expected ErrUserNotFound, got %v", err)
	}
}

func TestUpdateProfile(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	phone := "+1234567890"
	displayName := "Test User"
	profile, err := svc.UpdateProfile(ctx, userID, auth.UpdateProfileRequest{
		Phone:       &phone,
		DisplayName: &displayName,
	})
	if err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}
	if profile.Phone != "+1234567890" {
		t.Errorf("expected phone +1234567890, got %s", profile.Phone)
	}
	if profile.DisplayName != "Test User" {
		t.Errorf("expected display name Test User, got %s", profile.DisplayName)
	}

	// Verify persisted
	profile2, err := svc.GetProfile(ctx, userID)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if profile2.Phone != "+1234567890" {
		t.Errorf("phone not persisted: got %s", profile2.Phone)
	}
	if profile2.DisplayName != "Test User" {
		t.Errorf("display name not persisted: got %s", profile2.DisplayName)
	}
}

// --- E4-S5: Change Email ---

func TestChangeEmail(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	// Initiate email change
	err := svc.ChangeEmail(ctx, userID, auth.ChangeEmailRequest{
		NewEmail: "newemail@example.com",
	})
	if err != nil {
		t.Fatalf("ChangeEmail: %v", err)
	}

	// Verify old email is still active
	profile, _ := svc.GetProfile(ctx, userID)
	if profile.EmailNormalized != "user@example.com" {
		t.Errorf("old email should still be active, got %s", profile.EmailNormalized)
	}
}

func TestVerifyEmailChange(t *testing.T) {
	config := auth.DefaultConfig()
	config.JWTIssuer = "test-issuer"
	config.JWTAudience = "test-audience"

	store := auth.NewMemoryStoreFactory()
	sender := auth.NewNoopMessageSender()
	svc, err := auth.NewAuthService(config, store, sender, nil)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}
	ctx := context.Background()

	// Register and activate
	user, _ := svc.Register(ctx, auth.RegisterRequest{
		Email:    "old@example.com",
		Password: "securePassword123",
	})
	code := sender.Codes["old@example.com"]
	svc.VerifyEmail(ctx, auth.VerifyEmailRequest{
		Email: "old@example.com",
		Code:  code,
	})

	// Initiate email change
	err = svc.ChangeEmail(ctx, user.ID, auth.ChangeEmailRequest{
		NewEmail: "new@example.com",
	})
	if err != nil {
		t.Fatalf("ChangeEmail: %v", err)
	}

	// Get the verification code for the new email
	newCode := sender.Codes["new@example.com"]
	if newCode == "" {
		t.Fatal("expected verification code for new email")
	}

	// Verify email change
	err = svc.VerifyEmailChange(ctx, user.ID, auth.VerifyEmailChangeRequest{
		NewEmail: "new@example.com",
		Code:     newCode,
	})
	if err != nil {
		t.Fatalf("VerifyEmailChange: %v", err)
	}

	// Verify the email was changed
	profile, _ := svc.GetProfile(ctx, user.ID)
	if profile.EmailNormalized != "new@example.com" {
		t.Errorf("expected email new@example.com, got %s", profile.EmailNormalized)
	}

	// Old email should no longer work for login
	_, err = svc.Login(ctx, auth.LoginRequest{
		Email:    "old@example.com",
		Password: "securePassword123",
	}, "", "")
	if err != auth.ErrInvalidCredentials {
		t.Errorf("old email login should fail, got %v", err)
	}

	// New email should work for login
	_, err = svc.Login(ctx, auth.LoginRequest{
		Email:    "new@example.com",
		Password: "securePassword123",
	}, "", "")
	if err != nil {
		t.Errorf("new email login should succeed, got %v", err)
	}
}

func TestChangeEmailAlreadyInUse(t *testing.T) {
	config := auth.DefaultConfig()
	config.JWTIssuer = "test-issuer"
	config.JWTAudience = "test-audience"

	store := auth.NewMemoryStoreFactory()
	sender := auth.NewNoopMessageSender()
	svc, _ := auth.NewAuthService(config, store, sender, nil)
	ctx := context.Background()

	// Register and activate first user
	user1, _ := svc.Register(ctx, auth.RegisterRequest{
		Email:    "user1@example.com",
		Password: "securePassword123",
	})
	code1 := sender.Codes["user1@example.com"]
	svc.VerifyEmail(ctx, auth.VerifyEmailRequest{
		Email: "user1@example.com",
		Code:  code1,
	})

	// Register and activate second user
	sender.Codes = make(map[string]string)
	user2, _ := svc.Register(ctx, auth.RegisterRequest{
		Email:    "user2@example.com",
		Password: "securePassword123",
	})
	code2 := sender.Codes["user2@example.com"]
	svc.VerifyEmail(ctx, auth.VerifyEmailRequest{
		Email: "user2@example.com",
		Code:  code2,
	})

	// User2 tries to change email to user1's email — should fail at ChangeEmail stage
	err := svc.ChangeEmail(ctx, user2.ID, auth.ChangeEmailRequest{
		NewEmail: "user1@example.com",
	})
	if err != auth.ErrEmailAlreadyInUse {
		t.Errorf("expected ErrEmailAlreadyInUse, got %v", err)
	}
	_ = user1
}

// --- E4-S6: Change Password ---

func TestChangePassword(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	// Create a second session (login again)
	svc.Login(ctx, auth.LoginRequest{
		Email:    "user@example.com",
		Password: "securePassword123",
	}, "device-2", "192.168.1.1")

	// Verify 2 sessions
	sessions, _ := svc.ListSessions(ctx, userID)
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}

	// Change password
	err := svc.ChangePassword(ctx, userID, auth.ChangePasswordRequest{
		OldPassword: "securePassword123",
		NewPassword: "newSecurePassword456",
	})
	if err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}

	// All sessions should be revoked (including the one used for ChangePassword)
	sessions, _ = svc.ListSessions(ctx, userID)
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions after password change, got %d", len(sessions))
	}

	// Old password should not work
	_, err = svc.Login(ctx, auth.LoginRequest{
		Email:    "user@example.com",
		Password: "securePassword123",
	}, "", "")
	if err != auth.ErrInvalidCredentials {
		t.Errorf("old password should fail, got %v", err)
	}

	// New password should work
	_, err = svc.Login(ctx, auth.LoginRequest{
		Email:    "user@example.com",
		Password: "newSecurePassword456",
	}, "", "")
	if err != nil {
		t.Errorf("new password should work, got %v", err)
	}
}

func TestChangePasswordWrongOld(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	err := svc.ChangePassword(ctx, userID, auth.ChangePasswordRequest{
		OldPassword: "wrongPassword999",
		NewPassword: "newSecurePassword456",
	})
	if err != auth.ErrOldPasswordIncorrect {
		t.Errorf("expected ErrOldPasswordIncorrect, got %v", err)
	}
}

func TestChangePasswordSameAsOld(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	err := svc.ChangePassword(ctx, userID, auth.ChangePasswordRequest{
		OldPassword: "securePassword123",
		NewPassword: "securePassword123",
	})
	if err != auth.ErrPasswordSame {
		t.Errorf("expected ErrPasswordSame, got %v", err)
	}
}

func TestChangePasswordTooShort(t *testing.T) {
	svc, userID, _ := setupActiveUser(t)
	ctx := context.Background()

	err := svc.ChangePassword(ctx, userID, auth.ChangePasswordRequest{
		OldPassword: "securePassword123",
		NewPassword: "short",
	})
	if err != auth.ErrPasswordTooShort {
		t.Errorf("expected ErrPasswordTooShort, got %v", err)
	}
}
