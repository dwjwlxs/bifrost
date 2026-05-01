package handlers

import (
	"context"
	"encoding/json"
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
	}
}

// RegisterRoutes registers platform auth routes on the router.
func (h *PlatformAuthHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	// Public routes (no platform auth required)
	r.POST("/api/platform/login", lib.ChainMiddlewares(h.login, middlewares...))
	r.POST("/api/platform/register", lib.ChainMiddlewares(h.register, middlewares...))
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
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			// 1. Extract Bearer token
			authHeader := string(ctx.Request.Header.Peek("Authorization"))
			token := strings.TrimPrefix(authHeader, "Bearer ")
			if token == "" || token == authHeader {
				SendError(ctx, fasthttp.StatusUnauthorized, "Missing or invalid Authorization header")
				return
			}

			// 2. Verify platform JWT
			platformClaims, err := VerifyPlatformJWT(token)
			if err != nil {
				SendError(ctx, fasthttp.StatusUnauthorized, "Invalid platform token")
				return
			}

			// 3. Extract and verify the embedded auth JWT
			if platformClaims.AuthToken == "" {
				SendError(ctx, fasthttp.StatusUnauthorized, "Platform token missing embedded auth token")
				return
			}

			goCtx := context.Background()
			_, err = authService.ValidateAccessToken(goCtx, platformClaims.AuthToken)
			if err != nil {
				// Auth JWT is invalid or expired → reject even if platform JWT is still valid.
				// This is the safety-first approach: if the underlying auth identity is gone,
				// the platform session should be invalid too.
				SendError(ctx, fasthttp.StatusUnauthorized, "Embedded auth token invalid or expired")
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
func (h *PlatformAuthHandler) buildPlatformClaimsForUser(userID, authToken string) *PlatformClaims {
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
	}

	// Email is already in auth JWT claims — no need to query old user table
	return platformClaims
}

// login handles POST /api/platform/login
func (h *PlatformAuthHandler) login(ctx *fasthttp.RequestCtx) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format")
		return
	}

	if req.Email == "" || req.Password == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Email and password are required")
		return
	}

	goCtx := context.Background()

	// 1. Call authService.Login to get a token pair
	tokenPair, err := h.authService.Login(goCtx, fauth.LoginRequest{
		Email:    req.Email,
		Password: req.Password,
	}, "", ctx.RemoteIP().String())
	if err != nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "Invalid credentials")
		return
	}

	// 2. Extract user_id from the auth JWT
	jwtClaims, err := h.authService.ValidateAccessToken(goCtx, tokenPair.AccessToken)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to validate access token")
		return
	}

	userID := jwtClaims.Sub
	if userID == "" {
		SendError(ctx, fasthttp.StatusInternalServerError, "Invalid user ID in token")
		return
	}

	// 3. Build platform claims using shared helper
	platformClaims := h.buildPlatformClaimsForUser(userID, tokenPair.AccessToken)

	// 4. Sign platform JWT
	platformJWT, err := SignPlatformJWT(platformClaims)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to sign platform token")
		return
	}

	// 5. Return tokens
	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"access_token": platformJWT,
			"refresh_token": tokenPair.RefreshToken,
			"expires_at":   tokenPair.ExpiresAt.Format(time.RFC3339),
		},
	})
}

// register handles POST /api/platform/register
func (h *PlatformAuthHandler) register(ctx *fasthttp.RequestCtx) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format")
		return
	}

	if req.Email == "" || req.Password == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Email and password are required")
		return
	}

	if len(req.Password) < 6 {
		SendError(ctx, fasthttp.StatusBadRequest, "Password must be at least 6 characters")
		return
	}

	if !emailRegex.MatchString(req.Email) {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid email format")
		return
	}

	goCtx := context.Background()

	user, err := h.authService.Register(goCtx, fauth.RegisterRequest{
		Email:    req.Email,
		Password: req.Password,
	})
	if err != nil {
		SendError(ctx, fasthttp.StatusConflict, "Registration failed")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"user_id": user.ID,
			"email":   user.Email,
		},
	})
}

// refreshToken handles POST /api/platform/refresh-token
func (h *PlatformAuthHandler) refreshToken(ctx *fasthttp.RequestCtx) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}

	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format")
		return
	}

	if req.RefreshToken == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Refresh token is required")
		return
	}

	goCtx := context.Background()

	// 1. Exchange refresh token for a new token pair
	tokenPair, err := h.authService.RefreshToken(goCtx, fauth.RefreshTokenRequest{
		RefreshToken: req.RefreshToken,
	})
	if err != nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "Invalid refresh token")
		return
	}

	// 2. Extract user_id from the new access token
	jwtClaims, err := h.authService.ValidateAccessToken(goCtx, tokenPair.AccessToken)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to validate new access token")
		return
	}

	userID := jwtClaims.Sub
	if userID == "" {
		SendError(ctx, fasthttp.StatusInternalServerError, "Invalid user ID in token")
		return
	}

	// 3. Build platform claims using shared helper
	platformClaims := h.buildPlatformClaimsForUser(userID, tokenPair.AccessToken)

	// 4. Sign new platform JWT
	platformJWT, err := SignPlatformJWT(platformClaims)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to sign platform token")
		return
	}

	// 5. Return new tokens
	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"access_token": platformJWT,
			"refresh_token": tokenPair.RefreshToken,
			"expires_at":   tokenPair.ExpiresAt.Format(time.RFC3339),
		},
	})
}

// getProfile handles GET /api/platform/profile (protected by PlatformAuthMiddleware)
func (h *PlatformAuthHandler) getProfile(ctx *fasthttp.RequestCtx) {
	platformClaims := GetPlatformClaimsFromContext(ctx)
	if platformClaims == nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"user_id":  platformClaims.UserID,
			"email":    platformClaims.Email,
			"is_admin": platformClaims.IsAdmin,
			"orgs":     platformClaims.Orgs,
			"teams":    platformClaims.Teams,
		},
	})
}
