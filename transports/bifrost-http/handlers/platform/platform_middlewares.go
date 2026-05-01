package handlers

import (
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// Context key for storing the resolved role string.
type platformResolvedRoleKey struct{}

// Context key for storing the loaded VK record.
type platformVKKey struct{}

// Context key for storing the loaded team record (for org ID lookup in team middlewares).
type platformTeamKey struct{}

// GetPlatformResolvedRoleFromContext returns the resolved role string set by
// role middlewares (e.g., "org_admin", "team_admin"). Returns empty string if not set.
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

// RequireAdmin checks that the platform user is a system administrator.
// Returns 403 if claims.IsAdmin is false.
func RequireAdmin(next fasthttp.RequestHandler) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		claims := GetPlatformClaimsFromContext(ctx)
		if claims == nil || !claims.IsAdmin {
			SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
			return
		}
		next(ctx)
	}
}

// RequireOrgAdmin checks that the platform user is an admin for the organization
// identified by the :orgId path parameter.
// Sets platform_resolved_role to "org_admin" on success.
func RequireOrgAdmin(next fasthttp.RequestHandler) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		claims := GetPlatformClaimsFromContext(ctx)
		if claims == nil {
			SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
			return
		}

		orgID, _ := ctx.UserValue("orgId").(string)
		if orgID == "" {
			SendError(ctx, fasthttp.StatusBadRequest, "Organization ID is required")
			return
		}

		if !claims.IsOrgAdmin(orgID) {
			SendError(ctx, fasthttp.StatusForbidden, "Organization admin access required")
			return
		}

		ctx.SetUserValue(platformResolvedRoleKey{}, "org_admin")
		next(ctx)
	}
}

// RequireOrgMember checks that the platform user is a member of the organization
// identified by the :orgId path parameter.
func RequireOrgMember(next fasthttp.RequestHandler) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		claims := GetPlatformClaimsFromContext(ctx)
		if claims == nil {
			SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
			return
		}

		orgID, _ := ctx.UserValue("orgId").(string)
		if orgID == "" {
			SendError(ctx, fasthttp.StatusBadRequest, "Organization ID is required")
			return
		}

		isMember := false
		for _, org := range claims.Orgs {
			if org.ID == orgID {
				isMember = true
				break
			}
		}
		if !isMember {
			SendError(ctx, fasthttp.StatusForbidden, "Organization membership required")
			return
		}

		next(ctx)
	}
}

// RequireTeamAdmin checks that the platform user is an admin for the team
// identified by the :teamId path parameter.
// First checks if the user is org_admin for the team's parent org (org_admin implies team_admin).
// Then checks claims.IsTeamAdmin(teamID).
// Sets platform_resolved_role to "org_admin" or "team_admin" on success.
func RequireTeamAdmin(db *gorm.DB) schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			claims := GetPlatformClaimsFromContext(ctx)
			if claims == nil {
				SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
				return
			}

			teamID, _ := ctx.UserValue("teamId").(string)
			if teamID == "" {
				SendError(ctx, fasthttp.StatusBadRequest, "Team ID is required")
				return
			}

			// Check if user is org_admin for the specific org this team belongs to.
			// Query the team to find its customer_id, then check org_admin for that org.
			var team tables.TableTeam
			if err := db.Where("id = ?", teamID).First(&team).Error; err == nil && team.CustomerID != nil {
				if claims.IsOrgAdmin(*team.CustomerID) {
					ctx.SetUserValue(platformResolvedRoleKey{}, "org_admin")
					next(ctx)
					return
				}
			}

			// Check direct team admin
			if claims.IsTeamAdmin(teamID) {
				ctx.SetUserValue(platformResolvedRoleKey{}, "team_admin")
				next(ctx)
				return
			}

			SendError(ctx, fasthttp.StatusForbidden, "Team admin access required")
		}
	}
}

// RequireTeamMember checks that the platform user is a member of the team
// identified by the :teamId path parameter, or is org_admin.
func RequireTeamMember(next fasthttp.RequestHandler) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		claims := GetPlatformClaimsFromContext(ctx)
		if claims == nil {
			SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
			return
		}

		teamID, _ := ctx.UserValue("teamId").(string)
		if teamID == "" {
			SendError(ctx, fasthttp.StatusBadRequest, "Team ID is required")
			return
		}

		// org_admin implies team_member
		for _, org := range claims.Orgs {
			if org.Role == "admin" || org.Role == "owner" {
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

		SendError(ctx, fasthttp.StatusForbidden, "Team membership required")
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
				SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
				return
			}

			vkID, _ := ctx.UserValue("vkId").(string)
			if vkID == "" {
				SendError(ctx, fasthttp.StatusBadRequest, "Virtual key ID is required")
				return
			}

			var vk tables.TableVirtualKey
			if err := db.Where("id = ?", vkID).First(&vk).Error; err != nil {
				// Intentionally return 403, not 404 — avoid info leakage
				SendError(ctx, fasthttp.StatusForbidden, "Virtual key access denied")
				return
			}

			// Check ownership
			if vk.UserID == nil || *vk.UserID != claims.UserID {
				SendError(ctx, fasthttp.StatusForbidden, "Virtual key access denied")
				return
			}

			// Set VK on context for handler use
			ctx.SetUserValue(platformVKKey{}, &vk)
			next(ctx)
		}
	}
}
