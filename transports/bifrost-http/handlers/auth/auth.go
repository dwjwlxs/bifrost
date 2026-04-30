// Package handlers provides HTTP request handlers for the Bifrost HTTP transport.
// This file implements the consumer account auth API endpoints.
package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	fauth "github.com/maximhq/bifrost/framework/auth"
	"github.com/maximhq/bifrost/transports/bifrost-http/handlers"
	"github.com/valyala/fasthttp"
)

// AuthHandler handles consumer account authentication HTTP endpoints.
type AuthHandler struct {
	svc fauth.AuthService
}

// NewAuthHandler creates a new AuthHandler with the given AuthService.
func NewAuthHandler(svc fauth.AuthService) *AuthHandler {
	return &AuthHandler{svc: svc}
}

// RegisterRoutes registers all /api/auth/* routes.
// Public endpoints are registered without auth middleware.
// Protected endpoints use a built-in access-token middleware.
func (h *AuthHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	// Public endpoints (no auth required)
	r.POST("/api/auth/register", h.register)
	r.POST("/api/auth/verify", h.verifyEmail)
	r.POST("/api/auth/login", h.login)
	r.POST("/api/auth/refresh", h.refreshToken)
	r.POST("/api/auth/forgot-password", h.forgotPassword)
	r.POST("/api/auth/reset-password", h.resetPassword)
	r.GET("/api/auth/.well-known/jwks.json", h.jwks)
	r.POST("/api/auth/oauth/{provider}", h.oauthLogin)
	r.GET("/api/auth/oauth/{provider}/url", h.oauthAuthURL)

	// Protected endpoints — wrap with the access-token guard
	protected := middlewares
	for _, m := range middlewares {
		protected = append(protected, m)
	}

	r.POST("/api/auth/logout", h.withAuth(h.logout))
	r.POST("/api/auth/logout-all", h.withAuth(h.logoutAll))
	r.GET("/api/auth/me", h.withAuth(h.getProfile))
	r.PATCH("/api/auth/me", h.withAuth(h.updateProfile))
	r.POST("/api/auth/me/change-email", h.withAuth(h.changeEmail))
	r.POST("/api/auth/me/verify-email-change", h.withAuth(h.verifyEmailChange))
	r.POST("/api/auth/me/change-password", h.withAuth(h.changePassword))
	r.POST("/api/auth/me/delete-account", h.withAuth(h.deleteAccount))
	r.POST("/api/auth/me/undo-delete", h.withAuth(h.undoDeleteAccount))
	r.GET("/api/auth/me/sessions", h.withAuth(h.listSessions))
	r.DELETE("/api/auth/me/sessions/{id}", h.withAuth(h.revokeSession))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// readJSONBody reads and unmarshals the request body into dst.
func readJSONBody(ctx *fasthttp.RequestCtx, dst interface{}) error {
	if !ctx.IsPost() && !ctx.IsPut() && !ctx.IsPatch() {
		return fmt.Errorf("expected JSON body but got %s", ctx.Method())
	}
	body := ctx.PostBody()
	if len(body) == 0 {
		return fmt.Errorf("empty request body")
	}
	return json.Unmarshal(body, dst)
}

// extractAccessToken pulls the Bearer token from the Authorization header.
func extractAccessToken(ctx *fasthttp.RequestCtx) string {
	auth := string(ctx.Request.Header.Peek("Authorization"))
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}

// extractUserIDFromRequest validates the access token and returns the user ID (sub claim).
func (h *AuthHandler) extractUserIDFromRequest(ctx *fasthttp.RequestCtx) (string, error) {
	token := extractAccessToken(ctx)
	if token == "" {
		return "", fmt.Errorf("missing access token")
	}
	claims, err := h.svc.ValidateAccessToken(ctx, token)
	if err != nil {
		return "", err
	}
	return claims.Sub, nil
}

// authMiddleware is a fasthttp middleware that enforces a valid access token.
func (h *AuthHandler) authMiddleware(next fasthttp.RequestHandler) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		userID, err := h.extractUserIDFromRequest(ctx)
		if err != nil {
			handlers.SendError(ctx, fasthttp.StatusUnauthorized, "unauthorized: "+err.Error())
			return
		}
		ctx.SetUserValue("auth_user_id", userID)
		next(ctx)
	}
}

// withAuth wraps a handler function with the auth middleware.
func (h *AuthHandler) withAuth(handler fasthttp.RequestHandler) fasthttp.RequestHandler {
	return h.authMiddleware(handler)
}

// userID extracts the authenticated user ID set by the auth middleware.
func userID(ctx *fasthttp.RequestCtx) string {
	v, _ := ctx.UserValue("auth_user_id").(string)
	return v
}

// mapAuthError converts a framework/auth sentinel error to an HTTP status code + message.
func mapAuthError(err error) (int, string) {
	switch {
	case errors.Is(err, fauth.ErrUserAlreadyExists):
		return fasthttp.StatusConflict, "user already exists with this email"
	case errors.Is(err, fauth.ErrInvalidCredentials):
		return fasthttp.StatusUnauthorized, "invalid email or password"
	case errors.Is(err, fauth.ErrUserNotVerified):
		return fasthttp.StatusForbidden, "email not verified"
	case errors.Is(err, fauth.ErrUserSuspended):
		return fasthttp.StatusForbidden, "account suspended"
	case errors.Is(err, fauth.ErrUserDeleted):
		return fasthttp.StatusGone, "account deleted"
	case errors.Is(err, fauth.ErrAccountLocked):
		return fasthttp.StatusTooManyRequests, "account locked due to too many failed attempts"
	case errors.Is(err, fauth.ErrPasswordTooShort):
		return fasthttp.StatusBadRequest, "password is too short"
	case errors.Is(err, fauth.ErrVerificationCodeInvalid):
		return fasthttp.StatusBadRequest, "invalid verification code"
	case errors.Is(err, fauth.ErrVerificationCodeExpired):
		return fasthttp.StatusBadRequest, "verification code expired"
	case errors.Is(err, fauth.ErrVerificationCodeMaxAttempts):
		return fasthttp.StatusTooManyRequests, "verification code max attempts exceeded"
	case errors.Is(err, fauth.ErrInvalidRefreshToken):
		return fasthttp.StatusUnauthorized, "invalid refresh token"
	case errors.Is(err, fauth.ErrRefreshTokenExpired):
		return fasthttp.StatusUnauthorized, "refresh token expired"
	case errors.Is(err, fauth.ErrRefreshTokenUsed):
		return fasthttp.StatusUnauthorized, "refresh token reuse detected, all sessions revoked"
	case errors.Is(err, fauth.ErrUserNotFound):
		return fasthttp.StatusNotFound, "user not found"
	case errors.Is(err, fauth.ErrPasswordResetInvalid):
		return fasthttp.StatusBadRequest, "invalid or expired password reset code"
	case errors.Is(err, fauth.ErrOAuthProviderDisabled):
		return fasthttp.StatusNotImplemented, "OAuth provider is disabled"
	case errors.Is(err, fauth.ErrSessionNotFound):
		return fasthttp.StatusNotFound, "session not found"
	case errors.Is(err, fauth.ErrNotSessionOwner):
		return fasthttp.StatusForbidden, "you do not own this session"
	case errors.Is(err, fauth.ErrOldPasswordIncorrect):
		return fasthttp.StatusBadRequest, "current password is incorrect"
	case errors.Is(err, fauth.ErrPasswordSame):
		return fasthttp.StatusBadRequest, "new password must be different from current password"
	case errors.Is(err, fauth.ErrEmailAlreadyInUse):
		return fasthttp.StatusConflict, "email is already in use by another account"
	case errors.Is(err, fauth.ErrEmailChangeInvalid):
		return fasthttp.StatusBadRequest, "invalid or expired email change code"
	case errors.Is(err, fauth.ErrAccountDeletionPending):
		return fasthttp.StatusConflict, "account deletion already requested"
	case errors.Is(err, fauth.ErrAccountNotDeleted):
		return fasthttp.StatusBadRequest, "account has not been marked for deletion"
	case errors.Is(err, fauth.ErrAccountDeletionExpired):
		return fasthttp.StatusGone, "account deletion cool-down period has expired"
	case errors.Is(err, fauth.ErrPasswordBreached):
		return fasthttp.StatusBadRequest, "this password has been found in a data breach"
	default:
		return fasthttp.StatusInternalServerError, "internal server error"
	}
}

// handleServiceError maps a service error to an HTTP response.
func handleServiceError(ctx *fasthttp.RequestCtx, err error) {
	code, msg := mapAuthError(err)
	handlers.SendError(ctx, code, msg)
}

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

// POST /api/auth/register
func (h *AuthHandler) register(ctx *fasthttp.RequestCtx) {
	var req fauth.RegisterRequest
	if err := readJSONBody(ctx, &req); err != nil {
		handlers.SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	user, err := h.svc.Register(ctx, req)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSONWithStatus(ctx, map[string]any{
		"message": "user created, verification email sent",
		"user":    user,
	}, fasthttp.StatusCreated)
}

// POST /api/auth/verify
func (h *AuthHandler) verifyEmail(ctx *fasthttp.RequestCtx) {
	var req fauth.VerifyEmailRequest
	if err := readJSONBody(ctx, &req); err != nil {
		handlers.SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	tokens, err := h.svc.VerifyEmail(ctx, req)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, tokens)
}

// POST /api/auth/login
func (h *AuthHandler) login(ctx *fasthttp.RequestCtx) {
	var req fauth.LoginRequest
	if err := readJSONBody(ctx, &req); err != nil {
		handlers.SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	deviceInfo := string(ctx.Request.Header.Peek("User-Agent"))
	ipAddress := ctx.RemoteAddr().String()
	tokens, err := h.svc.Login(ctx, req, deviceInfo, ipAddress)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, tokens)
}

// POST /api/auth/refresh
func (h *AuthHandler) refreshToken(ctx *fasthttp.RequestCtx) {
	var req fauth.RefreshTokenRequest
	if err := readJSONBody(ctx, &req); err != nil {
		handlers.SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	tokens, err := h.svc.RefreshToken(ctx, req)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, tokens)
}

// POST /api/auth/forgot-password
func (h *AuthHandler) forgotPassword(ctx *fasthttp.RequestCtx) {
	var req fauth.ForgotPasswordRequest
	if err := readJSONBody(ctx, &req); err != nil {
		handlers.SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	err := h.svc.ForgotPassword(ctx, req)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	// Always return 200 to prevent email enumeration
	handlers.SendJSON(ctx, map[string]any{
		"message": "if the email is registered, a reset code has been sent",
	})
}

// POST /api/auth/reset-password
func (h *AuthHandler) resetPassword(ctx *fasthttp.RequestCtx) {
	var req fauth.ResetPasswordRequest
	if err := readJSONBody(ctx, &req); err != nil {
		handlers.SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	err := h.svc.ResetPassword(ctx, req)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, map[string]any{
		"message": "password has been reset successfully",
	})
}

// GET /api/auth/.well-known/jwks.json
func (h *AuthHandler) jwks(ctx *fasthttp.RequestCtx) {
	jwks := h.svc.GetJWKS()
	ctx.SetContentType("application/json")
	ctx.Response.Header.Set("Cache-Control", "public, max-age=3600")
	json.NewEncoder(ctx).Encode(jwks)
}

// POST /api/auth/oauth/{provider}
func (h *AuthHandler) oauthLogin(ctx *fasthttp.RequestCtx) {
	provider := fauth.IdentityProvider(ctx.UserValue("provider").(string))
	var body struct {
		Code  string `json:"code"`
		State string `json:"state"`
	}
	if err := readJSONBody(ctx, &body); err != nil {
		handlers.SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	deviceInfo := string(ctx.Request.Header.Peek("User-Agent"))
	ipAddress := ctx.RemoteAddr().String()

	tokens, err := h.svc.OAuthLogin(ctx, fauth.OAuthCallbackRequest{
		Provider: provider,
		Code:     body.Code,
		State:    body.State,
	}, deviceInfo, ipAddress)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, tokens)
}

// GET /api/auth/oauth/{provider}/url
func (h *AuthHandler) oauthAuthURL(ctx *fasthttp.RequestCtx) {
	provider := fauth.IdentityProvider(ctx.UserValue("provider").(string))
	state := string(ctx.QueryArgs().Peek("state"))
	if state == "" {
		state = "csrf_" + string(ctx.Request.Header.Peek("User-Agent"))
	}
	url, err := h.svc.GetOAuthAuthURL(provider, state)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, map[string]any{
		"url":   url,
		"state": state,
	})
}

// ---------------------------------------------------------------------------
// Protected endpoints (require access token)
// ---------------------------------------------------------------------------

// POST /api/auth/logout
func (h *AuthHandler) logout(ctx *fasthttp.RequestCtx) {
	// Logout can accept refresh_token in body or current session
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	_ = readJSONBody(ctx, &body) // body may be empty
	if body.RefreshToken != "" {
		_ = h.svc.Logout(ctx, body.RefreshToken)
	}
	handlers.SendJSON(ctx, map[string]any{"message": "logged out"})
}

// POST /api/auth/logout-all
func (h *AuthHandler) logoutAll(ctx *fasthttp.RequestCtx) {
	uid := userID(ctx)
	_ = h.svc.LogoutAll(ctx, uid)
	handlers.SendJSON(ctx, map[string]any{"message": "all sessions revoked"})
}

// GET /api/auth/me
func (h *AuthHandler) getProfile(ctx *fasthttp.RequestCtx) {
	uid := userID(ctx)
	user, err := h.svc.GetProfile(ctx, uid)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, user)
}

// PATCH /api/auth/me
func (h *AuthHandler) updateProfile(ctx *fasthttp.RequestCtx) {
	uid := userID(ctx)
	var req fauth.UpdateProfileRequest
	if err := readJSONBody(ctx, &req); err != nil {
		handlers.SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	user, err := h.svc.UpdateProfile(ctx, uid, req)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, user)
}

// POST /api/auth/me/change-email
func (h *AuthHandler) changeEmail(ctx *fasthttp.RequestCtx) {
	uid := userID(ctx)
	var req fauth.ChangeEmailRequest
	if err := readJSONBody(ctx, &req); err != nil {
		handlers.SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	err := h.svc.ChangeEmail(ctx, uid, req)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, map[string]any{"message": "verification code sent to new email"})
}

// POST /api/auth/me/verify-email-change
func (h *AuthHandler) verifyEmailChange(ctx *fasthttp.RequestCtx) {
	uid := userID(ctx)
	var req fauth.VerifyEmailChangeRequest
	if err := readJSONBody(ctx, &req); err != nil {
		handlers.SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	err := h.svc.VerifyEmailChange(ctx, uid, req)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, map[string]any{"message": "email changed successfully"})
}

// POST /api/auth/me/change-password
func (h *AuthHandler) changePassword(ctx *fasthttp.RequestCtx) {
	uid := userID(ctx)
	var req fauth.ChangePasswordRequest
	if err := readJSONBody(ctx, &req); err != nil {
		handlers.SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	err := h.svc.ChangePassword(ctx, uid, req)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, map[string]any{"message": "password changed, all other sessions revoked"})
}

// POST /api/auth/me/delete-account
func (h *AuthHandler) deleteAccount(ctx *fasthttp.RequestCtx) {
	uid := userID(ctx)
	var req fauth.DeleteAccountRequest
	if err := readJSONBody(ctx, &req); err != nil {
		handlers.SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	err := h.svc.DeleteAccount(ctx, uid, req)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, map[string]any{
		"message": "account marked for deletion, you have 30 days to undo",
	})
}

// POST /api/auth/me/undo-delete
func (h *AuthHandler) undoDeleteAccount(ctx *fasthttp.RequestCtx) {
	uid := userID(ctx)
	err := h.svc.UndoDeleteAccount(ctx, uid)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, map[string]any{"message": "account restored"})
}

// GET /api/auth/me/sessions
func (h *AuthHandler) listSessions(ctx *fasthttp.RequestCtx) {
	uid := userID(ctx)
	sessions, err := h.svc.ListSessions(ctx, uid)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, map[string]any{
		"sessions": sessions,
	})
}

// DELETE /api/auth/me/sessions/{id}
func (h *AuthHandler) revokeSession(ctx *fasthttp.RequestCtx) {
	uid := userID(ctx)
	sessionID := ctx.UserValue("id").(string)
	err := h.svc.RevokeSession(ctx, uid, sessionID)
	if err != nil {
		handleServiceError(ctx, err)
		return
	}
	handlers.SendJSON(ctx, map[string]any{"message": "session revoked"})
}
