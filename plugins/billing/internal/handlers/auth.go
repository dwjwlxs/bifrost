package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"

	bconfig "github.com/dwjwlxs/bifrost/plugins/billing/internal/config"
	"github.com/dwjwlxs/bifrost/plugins/billing/internal/repos/billingstore/tables"
	authsvc "github.com/dwjwlxs/bifrost/plugins/billing/internal/services/authn"
	"github.com/dwjwlxs/bifrost/plugins/billing/internal/services/console"
	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// PlatformAuthHandler handles platform multi-tenant authentication endpoints.
type PlatformAuthHandler struct {
	db          *gorm.DB
	authService authsvc.AuthService
	configStore configstore.ConfigStore
	jwtKey      []byte
	jwtExpiry   time.Duration

	config *bconfig.BillingPluginConfig
}

// NewPlatformAuthHandler creates a new PlatformAuthHandler.
func NewPlatformAuthHandler(config *bconfig.BillingPluginConfig) *PlatformAuthHandler {
	d, _ := time.ParseDuration(config.ConsumerAuthConfig.PlatformJWTExpiry)
	return &PlatformAuthHandler{
		db:          config.Config.ConfigStore.DB(),
		authService: config.ConsumerAuthService,
		configStore: config.Config.ConfigStore,
		jwtKey:      []byte(config.ConsumerAuthConfig.PlatformJWTSecret),
		jwtExpiry:   d,
		config:      config,
	}
}

// platformHandleServiceError maps framework/auth errors to HTTP responses for platform handlers.
func platformHandleServiceError(ctx *fasthttp.RequestCtx, err error) {
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	switch {
	case errors.Is(err, authsvc.ErrUserNameTaken):
		SendError(ctx, fasthttp.StatusConflict, "username already taken", errMsg)
	case errors.Is(err, authsvc.ErrUserAlreadyExists):
		SendError(ctx, fasthttp.StatusConflict, "user already exists", errMsg)
	case errors.Is(err, authsvc.ErrVerificationCodeInvalid):
		SendError(ctx, fasthttp.StatusBadRequest, "invalid verification code", errMsg)
	case errors.Is(err, authsvc.ErrVerificationCodeExpired):
		SendError(ctx, fasthttp.StatusBadRequest, "verification code expired", errMsg)
	case errors.Is(err, authsvc.ErrVerificationCodeMaxAttempts):
		SendError(ctx, fasthttp.StatusTooManyRequests, "verification code max attempts exceeded", errMsg)
	default:
		SendError(ctx, fasthttp.StatusInternalServerError, "internal server error", errMsg)
	}
}

// RegisterRoutes registers platform auth routes on the router.
func (h *PlatformAuthHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	// Public routes (no platform auth required)
	r.POST("/api/platform/login", lib.ChainMiddlewares(h.login, middlewares...))
	r.POST("/api/platform/register", lib.ChainMiddlewares(h.register, middlewares...))
	r.POST("/api/platform/verify", lib.ChainMiddlewares(h.verify, middlewares...))
	r.POST("/api/platform/refresh-token", lib.ChainMiddlewares(h.refreshToken, middlewares...))
	r.POST("/api/platform/logout", lib.ChainMiddlewares(h.logout, middlewares...))

	// Protected routes (platform JWT + auth JWT dual verification)
	platformAuthMw := append([]schemas.BifrostHTTPMiddleware{PlatformAuthMiddleware(h.config)}, middlewares...)
	r.GET("/api/platform/profile", lib.ChainMiddlewares(h.getProfile, platformAuthMw...))
}

// emailRegex validates basic email format.
var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

// buildPlatformClaimsForUser queries the membership tables for the given user
// and constructs PlatformClaims. It does NOT set AuthToken — callers must do that.
func (h *PlatformAuthHandler) buildPlatformClaimsForUser(userID string, authToken string, jwtClaims *authsvc.JWTClaims) *console.PlatformClaims {
	var admin tables.TablePlatformAdmin
	isAdmin := false
	if err := h.db.Where("user_id = ?", userID).First(&admin).Error; err == nil {
		isAdmin = true
	}

	var orgMembers []tables.TablePlatformOrgMember
	orgs := make([]console.OrgClaim, 0)
	if err := h.db.Where("user_id = ?", userID).Find(&orgMembers).Error; err == nil {
		for _, m := range orgMembers {
			orgs = append(orgs, console.OrgClaim{ID: m.OrgID, Role: m.Role})
		}
	}

	var teamMembers []tables.TablePlatformTeamMember
	teams := make([]console.TeamClaim, 0)
	if err := h.db.Where("user_id = ?", userID).Find(&teamMembers).Error; err == nil {
		for _, m := range teamMembers {
			teams = append(teams, console.TeamClaim{ID: m.TeamID, Role: m.Role})
		}
	}

	platformClaims := &console.PlatformClaims{
		UserID:    userID,
		IsAdmin:   isAdmin,
		Orgs:      orgs,
		Teams:     teams,
		AuthToken: authToken,
		Email:     jwtClaims.Email,
		UserName:  jwtClaims.UserName,
		Exp:       jwtClaims.Exp,
		Iat:       jwtClaims.Iat,
		Jti:       "",
	}

	// Email is already in auth JWT claims — no need to query old user table
	return platformClaims
}

// issuePlatformToken validates the access token, builds platform claims, signs a
// platform JWT, and sets the refresh token cookie. Returns the platform JWT string
// and the platform JWT expiry time (for use in expires_at response field).
// Callers are responsible for sending the JSON response.
func (h *PlatformAuthHandler) issuePlatformToken(ctx *fasthttp.RequestCtx, tokenPair *authsvc.TokenPair) (string, time.Time, error) {
	goCtx := context.Background()

	jwtClaims, err := h.authService.ValidateAccessToken(goCtx, tokenPair.AccessToken)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("failed to validate access token: %w", err)
	}

	userID := jwtClaims.Sub
	if userID == "" {
		return "", time.Time{}, fmt.Errorf("invalid user ID in token")
	}

	platformClaims := h.buildPlatformClaimsForUser(userID, tokenPair.AccessToken, jwtClaims)
	platformJWT, err := console.SignPlatformJWT(platformClaims, h.jwtKey, h.jwtExpiry)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("failed to sign platform token: %w", err)
	}

	platformExpiry := time.Now().Add(h.jwtExpiry)

	setRefreshTokenCookie(ctx, tokenPair.RefreshToken, tokenPair.RefreshExpiresAt)
	return platformJWT, platformExpiry, nil
}

// login handles POST /api/platform/login
func (h *PlatformAuthHandler) login(ctx *fasthttp.RequestCtx) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format", err.Error())
		return
	}

	if req.Email == "" || req.Password == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Email and password are required", "")
		return
	}

	goCtx := context.Background()

	// 1. Call authService.Login to get a token pair
	tokenPair, err := h.authService.Login(goCtx, authsvc.LoginRequest{
		Email:    req.Email,
		Password: req.Password,
	}, "", ctx.RemoteIP().String())
	if err != nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "Invalid credentials", err.Error())
		return
	}

	// 2. Build platform JWT and set refresh cookie
	platformJWT, platformExpiry, err := h.issuePlatformToken(ctx, tokenPair)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to sign platform token", err.Error())
		return
	}
	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"access_token":  platformJWT,
			"refresh_token": tokenPair.RefreshToken,
			"expires_at":    platformExpiry.Format(time.RFC3339),
		},
	})
}

// register handles POST /api/platform/register
func (h *PlatformAuthHandler) register(ctx *fasthttp.RequestCtx) {
	var req struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format", err.Error())
		return
	}

	if req.Email == "" || req.Password == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Email and password are required", "")
		return
	}

	if req.Username == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Username is required", "")
		return
	}

	if len(req.Password) < 6 {
		SendError(ctx, fasthttp.StatusBadRequest, "Password must be at least 6 characters", "")
		return
	}

	if !emailRegex.MatchString(req.Email) {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid email format", "")
		return
	}

	goCtx := context.Background()

	user, err := h.authService.Register(goCtx, authsvc.RegisterRequest{
		Email:    req.Email,
		UserName: req.Username,
		Password: req.Password,
	})
	if err != nil {
		if errors.Is(err, authsvc.ErrUserNameTaken) {
			SendError(ctx, fasthttp.StatusConflict, "Username is already taken", err.Error())
			return
		}
		SendError(ctx, fasthttp.StatusConflict, "Registration failed", err.Error())
		return
	}

	// Create governance_users record after registration succeeds.
	if err := h.db.WithContext(goCtx).Create(&tables.TableUser{
		ID:   user.ID,
		Name: req.Username,
	}).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to create governance user", err.Error())
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"user_id":  user.ID,
			"email":    user.Email,
			"username": user.UserName,
		},
	})
}

// verify handles POST /api/platform/verify
func (h *PlatformAuthHandler) verify(ctx *fasthttp.RequestCtx) {
	var req struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}

	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format", err.Error())
		return
	}

	if req.Email == "" || req.Code == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Email and code are required", "")
		return
	}

	goCtx := context.Background()

	// 1. Call authService.VerifyEmail to get auth token pair
	tokenPair, err := h.authService.VerifyEmail(goCtx, authsvc.VerifyEmailRequest{
		Email: req.Email,
		Code:  req.Code,
	})
	if err != nil {
		platformHandleServiceError(ctx, err)
		return
	}

	// 2. Build platform JWT and set refresh cookie
	platformJWT, platformExpiry, err := h.issuePlatformToken(ctx, tokenPair)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to sign platform token", err.Error())
		return
	}
	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"access_token":  platformJWT,
			"refresh_token": tokenPair.RefreshToken,
			"expires_at":    platformExpiry.Format(time.RFC3339),
		},
	})
}

// logout handles POST /api/platform/logout
// Public route (no platform JWT required) so that users with expired access tokens can still log out.
// Revokes the server-side session and clears the httpOnly refresh token cookie.
func (h *PlatformAuthHandler) logout(ctx *fasthttp.RequestCtx) {
	// 1. Read refresh token from httpOnly cookie or request body
	refreshToken := getRefreshTokenFromCookie(ctx)
	if refreshToken == "" {
		var req struct {
			RefreshToken string `json:"refresh_token"`
		}
		_ = json.Unmarshal(ctx.PostBody(), &req) // body may be empty
		refreshToken = req.RefreshToken
	}

	// 2. Revoke server-side session if a refresh token was found
	if refreshToken != "" {
		goCtx := context.Background()
		_ = h.authService.Logout(goCtx, refreshToken)
	}

	// 3. Always clear the httpOnly cookie — even if no refresh token was found,
	//    clearing the cookie ensures a clean client state.
	clearRefreshTokenCookie(ctx)

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "logged out",
	})
}

// refreshToken handles POST /api/platform/refresh-token
func (h *PlatformAuthHandler) refreshToken(ctx *fasthttp.RequestCtx) {
	// 1. Read refresh token from httpOnly cookie (preferred) or body (fallback for legacy clients)
	refreshToken := getRefreshTokenFromCookie(ctx)
	if refreshToken == "" {
		var req struct {
			RefreshToken string `json:"refresh_token"`
		}
		if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
			SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format", err.Error())
			return
		}
		refreshToken = req.RefreshToken
	}

	if refreshToken == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Refresh token is required", "")
		return
	}

	goCtx := context.Background()

	// 2. Exchange refresh token for a new token pair
	tokenPair, err := h.authService.RefreshToken(goCtx, authsvc.RefreshTokenRequest{
		RefreshToken: refreshToken,
	})
	if err != nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "Invalid refresh token", err.Error())
		return
	}

	// 3. Build platform JWT and rotate refresh cookie
	platformJWT, platformExpiry, err := h.issuePlatformToken(ctx, tokenPair)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to sign platform token", err.Error())
		return
	}
	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"access_token":  platformJWT,
			"refresh_token": tokenPair.RefreshToken,
			"expires_at":    platformExpiry.Format(time.RFC3339),
		},
	})
}

// getProfile handles GET /api/platform/profile (protected by PlatformAuthMiddleware)
func (h *PlatformAuthHandler) getProfile(ctx *fasthttp.RequestCtx) {
	platformClaims := GetPlatformClaimsFromContext(ctx)
	if platformClaims == nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized", "")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"user_id":  platformClaims.UserID,
			"email":    platformClaims.Email,
			"username": platformClaims.UserName,
			"is_admin": platformClaims.IsAdmin,
			"orgs":     platformClaims.Orgs,
			"teams":    platformClaims.Teams,
		},
	})
}
