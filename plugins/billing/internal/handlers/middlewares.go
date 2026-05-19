package handlers

import (
	"context"
	"strings"

	bconfig "github.com/dwjwlxs/bifrost/plugins/billing/internal/config"
	"github.com/dwjwlxs/bifrost/plugins/billing/internal/model"
	"github.com/dwjwlxs/bifrost/plugins/billing/internal/services/console"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
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
func GetPlatformClaimsFromContext(ctx *fasthttp.RequestCtx) *console.PlatformClaims {
	if v := ctx.UserValue(platformClaimsKey{}); v != nil {
		if c, ok := v.(*console.PlatformClaims); ok {
			return c
		}
	}
	return nil
}

// Context key for storing the resolved role string.
type platformResolvedRoleKey struct{}

// Context key for storing the loaded VK record.
type platformVKKey struct{}

// Context key for storing the loaded team record (for org ID lookup in team middlewares).
type platformTeamKey struct{}

// GetPlatformResolvedRoleFromContext returns the resolved role string set by
// role middlewares (e.g., ResolvedRoleOrgAdmin, ResolvedRoleTeamAdmin).
// Returns empty string if not set.
func GetPlatformResolvedRoleFromContext(ctx *fasthttp.RequestCtx) string {
	if v := ctx.UserValue(platformResolvedRoleKey{}); v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// GetPlatformVKFromContext returns the loaded VK record set by RequireVKOwner.
func GetPlatformVKFromContext(ctx *fasthttp.RequestCtx) *tables.TableVirtualKey {
	if v := ctx.UserValue(platformVKKey{}); v != nil {
		if vk, ok := v.(*tables.TableVirtualKey); ok {
			return vk
		}
	}
	return nil
}

// PlatformAuthMiddleware performs dual verification:
// 1. Extract Bearer token and verify platform JWT (HMAC-SHA256)
// 2. Extract auth_token from platform claims
// 3. Verify auth JWT via authService.ValidateAccessToken (ES256)
// 4. Set platform_user_id and platform_claims on the request context
func PlatformAuthMiddleware(config *bconfig.BillingPluginConfig) schemas.BifrostHTTPMiddleware {
	db := config.Config.ConfigStore.DB()
	authService := config.ConsumerAuthService
	if db == nil || authService == nil {
		panic("PlatformAuthMiddleware: db and authService must not be nil")
	}
	jwtKey := console.PlatformJWTKey
	if len(jwtKey) == 0 {
		panic("PlatformAuthMiddleware: jwtKey must not be empty")
	}
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			// 1. Extract Bearer token
			authHeader := string(ctx.Request.Header.Peek("Authorization"))
			token := strings.TrimPrefix(authHeader, "Bearer ")
			if token == "" || token == authHeader {
				SendError(ctx, fasthttp.StatusUnauthorized, "Missing or invalid Authorization header", "")
				return
			}

			// 2. Verify platform JWT
			platformClaims, err := console.VerifyPlatformJWT(token, jwtKey)
			if err != nil {
				SendError(ctx, fasthttp.StatusUnauthorized, "Invalid platform token", err.Error())
				return
			}

			// 3. Extract and verify the embedded auth JWT
			if platformClaims.AuthToken == "" {
				SendError(ctx, fasthttp.StatusUnauthorized, "Platform token missing embedded auth token", "")
				return
			}

			goCtx := context.Background()
			_, err = authService.ValidateAccessToken(goCtx, platformClaims.AuthToken)
			if err != nil {
				// Auth JWT is invalid or expired → reject even if platform JWT is still valid.
				// This is the safety-first approach: if the underlying auth identity is gone,
				// the platform session should be invalid too.
				SendError(ctx, fasthttp.StatusUnauthorized, "Embedded auth token invalid or expired", err.Error())
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

// RequireAdmin checks that the platform user is a system administrator.
// Returns 403 if claims.IsAdmin is false.
func RequireAdmin(next fasthttp.RequestHandler) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		claims := GetPlatformClaimsFromContext(ctx)
		if claims == nil || !claims.IsAdmin {
			SendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Admin access required")
			return
		}
		next(ctx)
	}
}

// RequireOrgAdmin checks that the platform user is an admin for the organization
// identified by the :orgId path parameter.
// Sets platform_resolved_role to ResolvedRoleOrgAdmin on success.
func RequireOrgAdmin(next fasthttp.RequestHandler) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		claims := GetPlatformClaimsFromContext(ctx)
		if claims == nil {
			SendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Unauthorized")
			return
		}

		orgID, _ := ctx.UserValue("orgId").(string)
		if orgID == "" {
			SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Organization ID is required")
			return
		}

		if !claims.IsOrgAdmin(orgID) {
			SendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Organization admin access required")
			return
		}

		ctx.SetUserValue(platformResolvedRoleKey{}, model.ResolvedRoleOrgAdmin)
		next(ctx)
	}
}

// RequireOrgMember checks that the platform user is a member of the organization
// identified by the :orgId path parameter.
func RequireOrgMember(next fasthttp.RequestHandler) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		claims := GetPlatformClaimsFromContext(ctx)
		if claims == nil {
			SendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Unauthorized")
			return
		}

		orgID, _ := ctx.UserValue("orgId").(string)
		if orgID == "" {
			SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Organization ID is required")
			return
		}

		if !claims.IsOrgMember(orgID) {
			SendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Organization membership required")
			return
		}

		next(ctx)
	}
}

// RequireTeamAdmin checks that the platform user is an admin for the team
// identified by the :teamId path parameter.
// First checks if the user is org_admin for the team's parent org (org_admin implies team_admin).
// Then checks claims.IsTeamAdmin(teamID).
// Sets platform_resolved_role to ResolvedRoleOrgAdmin or ResolvedRoleTeamAdmin on success.
func RequireTeamAdmin(db *gorm.DB) schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			claims := GetPlatformClaimsFromContext(ctx)
			if claims == nil {
				SendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Unauthorized")
				return
			}

			teamID, _ := ctx.UserValue("teamId").(string)
			if teamID == "" {
				SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID is required")
				return
			}

			// Check if user is org_admin for the specific org this team belongs to.
			// Query the team to find its customer_id, then check org_admin for that org.
			var team tables.TableTeam
			if err := db.Where("id = ?", teamID).First(&team).Error; err == nil && team.CustomerID != nil {
				if claims.IsOrgAdmin(*team.CustomerID) {
					ctx.SetUserValue(platformResolvedRoleKey{}, model.ResolvedRoleOrgAdmin)
					next(ctx)
					return
				}
			}

			// Check direct team admin
			if claims.IsTeamAdmin(teamID) {
				ctx.SetUserValue(platformResolvedRoleKey{}, model.ResolvedRoleTeamAdmin)
				next(ctx)
				return
			}

			SendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Team admin access required")
		}
	}
}

// RequireTeamMember checks that the platform user is a member of the team
// identified by the :teamId path parameter, or is org_admin.
// System admins (is_admin=true) are implicitly team members.
func RequireTeamMember(next fasthttp.RequestHandler) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		claims := GetPlatformClaimsFromContext(ctx)
		if claims == nil {
			SendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Unauthorized")
			return
		}

		// System admins are implicitly team members
		if claims.IsAdmin {
			next(ctx)
			return
		}

		teamID, _ := ctx.UserValue("teamId").(string)
		if teamID == "" {
			SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID is required")
			return
		}

		// org_admin implies team_member
		for _, org := range claims.Orgs {
			if model.IsOrgAdminRole(org.Role) {
				next(ctx)
				return
			}
		}

		// Direct team membership
		for _, team := range claims.Teams {
			if team.ID == teamID {
				next(ctx)
				return
			}
		}

		SendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Team membership required")
	}
}

// RequireVKOwner checks that the platform user owns the virtual key identified
// by the :vkId path parameter. Loads the VK from the DB and sets it on context.
// Returns 403 (not 404) if not the owner to avoid information leakage.
func RequireVKOwner(db *gorm.DB) schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			claims := GetPlatformClaimsFromContext(ctx)
			if claims == nil {
				SendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Unauthorized")
				return
			}

			vkID, _ := ctx.UserValue("vkId").(string)
			if vkID == "" {
				SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Virtual key ID is required")
				return
			}

			var vk tables.TableVirtualKey
			if err := db.Where("id = ?", vkID).First(&vk).Error; err != nil {
				// Intentionally return 403, not 404 — avoid info leakage
				SendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Virtual key access denied")
				return
			}

			// Check ownership
			if vk.UserID == nil || *vk.UserID != claims.UserID {
				SendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Virtual key access denied")
				return
			}

			// Set VK on context for handler use
			ctx.SetUserValue(platformVKKey{}, &vk)
			next(ctx)
		}
	}
}
