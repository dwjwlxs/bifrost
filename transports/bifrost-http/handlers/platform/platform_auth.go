package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	fauth "github.com/maximhq/bifrost/framework/auth"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// Cookie name for refresh token (httpOnly, sent automatically on refresh requests)
const refreshTokenCookieName = "bifrost_refresh_token"

// setRefreshTokenCookie sets an httpOnly cookie with the refresh token.
func setRefreshTokenCookie(ctx *fasthttp.RequestCtx, token string, expiresAt time.Time) {
	cookie := fasthttp.AcquireCookie()
	defer fasthttp.ReleaseCookie(cookie)
	cookie.SetKey(refreshTokenCookieName)
	cookie.SetValue(token)
	cookie.SetExpire(expiresAt)
	cookie.SetPath("/")
	cookie.SetHTTPOnly(true)
	// SameSite=Lax: cookie sent with same-site top-level GET navigations.
	// For cross-origin AJAX with credentials, use SameSite=None; Secure.
	// Using Lax is safe when API and frontend share the same root domain.
	cookie.SetSameSite(fasthttp.CookieSameSiteLaxMode)
	// Set Secure flag when behind HTTPS proxy (production)
	if string(ctx.Request.Header.Peek("X-Forwarded-Proto")) == "https" {
		cookie.SetSecure(true)
	}
	ctx.Response.Header.SetCookie(cookie)
}

// getRefreshTokenFromCookie reads the refresh token from the httpOnly cookie.
func getRefreshTokenFromCookie(ctx *fasthttp.RequestCtx) string {
	return string(ctx.Request.Header.Cookie(refreshTokenCookieName))
}

// Context key types for platform auth (prevents key collisions).
type platformUserIDKey struct{}
type platformClaimsKey struct{}

// GetPlatformUserIDFromContext extracts the platform user ID (string UUID)
// from the request context. Returns empty string if not set.
func GetPlatformUserIDFromContext(ctx *fasthttp.RequestCtx) string {
	if v := ctx.UserValue(platformUserIDKey{}); v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// GetPlatformClaimsFromContext extracts the full PlatformClaims from the
// request context. Returns nil if not set.
func GetPlatformClaimsFromContext(ctx *fasthttp.RequestCtx) *PlatformClaims {
	if v := ctx.UserValue(platformClaimsKey{}); v != nil {
		if c, ok := v.(*PlatformClaims); ok {
			return c
		}
	}
	return nil
}

// PlatformAuthHandler handles platform multi-tenant authentication endpoints.
type PlatformAuthHandler struct {
	db          *gorm.DB
	authService fauth.AuthService
	configStore configstore.ConfigStore
	jwtKey      []byte
	jwtExpiry   time.Duration
}

// NewPlatformAuthHandler creates a new PlatformAuthHandler.
func NewPlatformAuthHandler(db *gorm.DB, authService fauth.AuthService, configStore configstore.ConfigStore) *PlatformAuthHandler {
	if db == nil {
		panic("NewPlatformAuthHandler: db must not be nil")
	}
	if authService == nil {
		panic("NewPlatformAuthHandler: authService must not be nil")
	}

	return &PlatformAuthHandler{
		db:          db,
		authService: authService,
		configStore: configStore,
		jwtKey:      PlatformJWTKey,
		jwtExpiry:   PlatformJWTExpiry,
	}
}

// platformHandleServiceError maps framework/auth errors to HTTP responses for platform handlers.
func platformHandleServiceError(ctx *fasthttp.RequestCtx, err error) {
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	switch {
	case errors.Is(err, fauth.ErrUserNameTaken):
		sendError(ctx, fasthttp.StatusConflict, "username already taken", errMsg)
	case errors.Is(err, fauth.ErrUserAlreadyExists):
		sendError(ctx, fasthttp.StatusConflict, "user already exists", errMsg)
	case errors.Is(err, fauth.ErrVerificationCodeInvalid):
		sendError(ctx, fasthttp.StatusBadRequest, "invalid verification code", errMsg)
	case errors.Is(err, fauth.ErrVerificationCodeExpired):
		sendError(ctx, fasthttp.StatusBadRequest, "verification code expired", errMsg)
	case errors.Is(err, fauth.ErrVerificationCodeMaxAttempts):
		sendError(ctx, fasthttp.StatusTooManyRequests, "verification code max attempts exceeded", errMsg)
	default:
		sendError(ctx, fasthttp.StatusInternalServerError, "internal server error", errMsg)
	}
}

// RegisterRoutes registers platform auth routes on the router.
func (h *PlatformAuthHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	// Public routes (no platform auth required)
	r.POST("/api/platform/login", lib.ChainMiddlewares(h.login, middlewares...))
	r.POST("/api/platform/register", lib.ChainMiddlewares(h.register, middlewares...))
	r.POST("/api/platform/verify", lib.ChainMiddlewares(h.verify, middlewares...))
	r.POST("/api/platform/refresh-token", lib.ChainMiddlewares(h.refreshToken, middlewares...))

	// Protected routes (platform JWT + auth JWT dual verification)
	platformAuthMw := append([]schemas.BifrostHTTPMiddleware{PlatformAuthMiddleware(h.db, h.authService)}, middlewares...)
	r.GET("/api/platform/profile", lib.ChainMiddlewares(h.getProfile, platformAuthMw...))
}

// PlatformAuthMiddleware performs dual verification:
// 1. Extract Bearer token and verify platform JWT (HMAC-SHA256)
// 2. Extract auth_token from platform claims
// 3. Verify auth JWT via authService.ValidateAccessToken (ES256)
// 4. Set platform_user_id and platform_claims on the request context
func PlatformAuthMiddleware(db *gorm.DB, authService fauth.AuthService) schemas.BifrostHTTPMiddleware {
	if db == nil || authService == nil {
		panic("PlatformAuthMiddleware: db and authService must not be nil")
	}
	jwtKey := PlatformJWTKey
	if len(jwtKey) == 0 {
		panic("PlatformAuthMiddleware: jwtKey must not be empty")
	}
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			// 1. Extract Bearer token
			authHeader := string(ctx.Request.Header.Peek("Authorization"))
			token := strings.TrimPrefix(authHeader, "Bearer ")
			if token == "" || token == authHeader {
				sendError(ctx, fasthttp.StatusUnauthorized, "Missing or invalid Authorization header", "")
				return
			}

			// 2. Verify platform JWT
			platformClaims, err := VerifyPlatformJWT(token, jwtKey)
			if err != nil {
				sendError(ctx, fasthttp.StatusUnauthorized, "Invalid platform token", err.Error())
				return
			}

			// 3. Extract and verify the embedded auth JWT
			if platformClaims.AuthToken == "" {
				sendError(ctx, fasthttp.StatusUnauthorized, "Platform token missing embedded auth token", "")
				return
			}

			goCtx := context.Background()
			_, err = authService.ValidateAccessToken(goCtx, platformClaims.AuthToken)
			if err != nil {
				// Auth JWT is invalid or expired → reject even if platform JWT is still valid.
				// This is the safety-first approach: if the underlying auth identity is gone,
				// the platform session should be invalid too.
				sendError(ctx, fasthttp.StatusUnauthorized, "Embedded auth token invalid or expired", err.Error())
				return
			}

			// 4. Set platform identity on the request context
			ctx.SetUserValue(platformUserIDKey{}, platformClaims.UserID)
			ctx.SetUserValue(platformClaimsKey{}, platformClaims)

			// 5. Continue to the next handler
			next(ctx)
		}
	}
}

// emailRegex validates basic email format.
var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

// buildPlatformClaimsForUser queries the membership tables for the given user
// and constructs PlatformClaims. It does NOT set AuthToken — callers must do that.
func (h *PlatformAuthHandler) buildPlatformClaimsForUser(userID string, authToken string, jwtClaims *fauth.JWTClaims) *PlatformClaims {
	var admin tables.TablePlatformAdmin
	isAdmin := false
	if err := h.db.Where("user_id = ?", userID).First(&admin).Error; err == nil {
		isAdmin = true
	}

	var orgMembers []tables.TablePlatformOrgMember
	orgs := make([]OrgClaim, 0)
	if err := h.db.Where("user_id = ?", userID).Find(&orgMembers).Error; err == nil {
		for _, m := range orgMembers {
			orgs = append(orgs, OrgClaim{ID: m.OrgID, Role: m.Role})
		}
	}

	var teamMembers []tables.TablePlatformTeamMember
	teams := make([]TeamClaim, 0)
	if err := h.db.Where("user_id = ?", userID).Find(&teamMembers).Error; err == nil {
		for _, m := range teamMembers {
			teams = append(teams, TeamClaim{ID: m.TeamID, Role: m.Role})
		}
	}

	platformClaims := &PlatformClaims{
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
// platform JWT, and sets the refresh token cookie. Returns the platform JWT string.
// Callers are responsible for sending the JSON response.
func (h *PlatformAuthHandler) issuePlatformToken(ctx *fasthttp.RequestCtx, tokenPair *fauth.TokenPair) (string, error) {
	goCtx := context.Background()

	jwtClaims, err := h.authService.ValidateAccessToken(goCtx, tokenPair.AccessToken)
	if err != nil {
		return "", fmt.Errorf("failed to validate access token: %w", err)
	}

	userID := jwtClaims.Sub
	if userID == "" {
		return "", fmt.Errorf("invalid user ID in token")
	}

	platformClaims := h.buildPlatformClaimsForUser(userID, tokenPair.AccessToken, jwtClaims)
	platformJWT, err := SignPlatformJWT(platformClaims, h.jwtKey, h.jwtExpiry)
	if err != nil {
		return "", fmt.Errorf("failed to sign platform token: %w", err)
	}

	setRefreshTokenCookie(ctx, tokenPair.RefreshToken, tokenPair.ExpiresAt)
	return platformJWT, nil
}

// login handles POST /api/platform/login
func (h *PlatformAuthHandler) login(ctx *fasthttp.RequestCtx) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "Invalid request format", err.Error())
		return
	}

	if req.Email == "" || req.Password == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "Email and password are required", "")
		return
	}

	goCtx := context.Background()

	// 1. Call authService.Login to get a token pair
	tokenPair, err := h.authService.Login(goCtx, fauth.LoginRequest{
		Email:    req.Email,
		Password: req.Password,
	}, "", ctx.RemoteIP().String())
	if err != nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "Invalid credentials", err.Error())
		return
	}

	// 2. Build platform JWT and set refresh cookie
	platformJWT, err := h.issuePlatformToken(ctx, tokenPair)
	if err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to sign platform token", err.Error())
		return
	}
	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"access_token":  platformJWT,
			"refresh_token": tokenPair.RefreshToken,
			"expires_at":    tokenPair.ExpiresAt.Format(time.RFC3339),
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
		sendError(ctx, fasthttp.StatusBadRequest, "Invalid request format", err.Error())
		return
	}

	if req.Email == "" || req.Password == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "Email and password are required", "")
		return
	}

	if req.Username == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "Username is required", "")
		return
	}

	if len(req.Password) < 6 {
		sendError(ctx, fasthttp.StatusBadRequest, "Password must be at least 6 characters", "")
		return
	}

	if !emailRegex.MatchString(req.Email) {
		sendError(ctx, fasthttp.StatusBadRequest, "Invalid email format", "")
		return
	}

	goCtx := context.Background()

	user, err := h.authService.Register(goCtx, fauth.RegisterRequest{
		Email:    req.Email,
		UserName: req.Username,
		Password: req.Password,
	})
	if err != nil {
		if errors.Is(err, fauth.ErrUserNameTaken) {
			sendError(ctx, fasthttp.StatusConflict, "Username is already taken", err.Error())
			return
		}
		sendError(ctx, fasthttp.StatusConflict, "Registration failed", err.Error())
		return
	}

	sendJSON(ctx, map[string]any{
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
		sendError(ctx, fasthttp.StatusBadRequest, "Invalid request format", err.Error())
		return
	}

	if req.Email == "" || req.Code == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "Email and code are required", "")
		return
	}

	goCtx := context.Background()

	// 1. Call authService.VerifyEmail to get auth token pair
	tokenPair, err := h.authService.VerifyEmail(goCtx, fauth.VerifyEmailRequest{
		Email: req.Email,
		Code:  req.Code,
	})
	if err != nil {
		platformHandleServiceError(ctx, err)
		return
	}

	// 2. Build platform JWT and set refresh cookie
	platformJWT, err := h.issuePlatformToken(ctx, tokenPair)
	if err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to sign platform token", err.Error())
		return
	}
	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"access_token":  platformJWT,
			"refresh_token": tokenPair.RefreshToken,
			"expires_at":    tokenPair.ExpiresAt.Format(time.RFC3339),
		},
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
			sendError(ctx, fasthttp.StatusBadRequest, "Invalid request format", err.Error())
			return
		}
		refreshToken = req.RefreshToken
	}

	if refreshToken == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "Refresh token is required", "")
		return
	}

	goCtx := context.Background()

	// 2. Exchange refresh token for a new token pair
	tokenPair, err := h.authService.RefreshToken(goCtx, fauth.RefreshTokenRequest{
		RefreshToken: refreshToken,
	})
	if err != nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "Invalid refresh token", err.Error())
		return
	}

	// 3. Build platform JWT and rotate refresh cookie
	platformJWT, err := h.issuePlatformToken(ctx, tokenPair)
	if err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to sign platform token", err.Error())
		return
	}
	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"access_token":  platformJWT,
			"refresh_token": tokenPair.RefreshToken,
			"expires_at":    tokenPair.ExpiresAt.Format(time.RFC3339),
		},
	})
}

// getProfile handles GET /api/platform/profile (protected by PlatformAuthMiddleware)
func (h *PlatformAuthHandler) getProfile(ctx *fasthttp.RequestCtx) {
	platformClaims := GetPlatformClaimsFromContext(ctx)
	if platformClaims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized", "")
		return
	}

	sendJSON(ctx, map[string]any{
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
