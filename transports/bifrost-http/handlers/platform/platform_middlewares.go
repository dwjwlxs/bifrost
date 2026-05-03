package handlers

import (
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/model"
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

// RequireAdmin checks that the platform user is a system administrator.
// Returns 403 if claims.IsAdmin is false.
func RequireAdmin(next fasthttp.RequestHandler) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		claims := GetPlatformClaimsFromContext(ctx)
		if claims == nil || !claims.IsAdmin {
			sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Admin access required")
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
			sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Unauthorized")
			return
		}

		orgID, _ := ctx.UserValue("orgId").(string)
		if orgID == "" {
			sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Organization ID is required")
			return
		}

		if !claims.IsOrgAdmin(orgID) {
			sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Organization admin access required")
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
			sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Unauthorized")
			return
		}

		orgID, _ := ctx.UserValue("orgId").(string)
		if orgID == "" {
			sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Organization ID is required")
			return
		}

		if !claims.IsOrgMember(orgID) {
			sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Organization membership required")
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
				sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Unauthorized")
				return
			}

			teamID, _ := ctx.UserValue("teamId").(string)
			if teamID == "" {
				sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID is required")
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

			sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Team admin access required")
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
			sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Unauthorized")
			return
		}

		// System admins are implicitly team members
		if claims.IsAdmin {
			next(ctx)
			return
		}

		teamID, _ := ctx.UserValue("teamId").(string)
		if teamID == "" {
			sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID is required")
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

		sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Team membership required")
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
				sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Unauthorized")
				return
			}

			vkID, _ := ctx.UserValue("vkId").(string)
			if vkID == "" {
				sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Virtual key ID is required")
				return
			}

			var vk tables.TableVirtualKey
			if err := db.Where("id = ?", vkID).First(&vk).Error; err != nil {
				// Intentionally return 403, not 404 — avoid info leakage
				sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Virtual key access denied")
				return
			}

			// Check ownership
			if vk.UserID == nil || *vk.UserID != claims.UserID {
				sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Virtual key access denied")
				return
			}

			// Set VK on context for handler use
			ctx.SetUserValue(platformVKKey{}, &vk)
			next(ctx)
		}
	}
}
