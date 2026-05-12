// Package handlers provides HTTP handlers for the Bifrost gateway.
package handlers

import (
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/platform"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// PlatformInvitationHandler handles public invitation API endpoints.
type PlatformInvitationHandler struct {
	db  *gorm.DB
	svc platform.InvitationService
}

// NewPlatformInvitationHandler creates a new PlatformInvitationHandler.
func NewPlatformInvitationHandler(config *lib.Config) *PlatformInvitationHandler {
	svc := platform.NewInvitationService(config.ConfigStore.DB(), config.Messenger, config.PlatformURL, config.Logger)
	return &PlatformInvitationHandler{db: config.ConfigStore.DB(), svc: svc}
}

// RegisterRoutes registers public invitation routes (no platform auth middleware).
func (h *PlatformInvitationHandler) RegisterRoutes(r *router.Router) {
	r.GET("/api/platform/invitations/{token}", lib.ChainMiddlewares(h.getInvitationDetails))
}

// RegisterAcceptRoute registers the accept invitation route on the given router group.
// The accept route requires platform auth middleware.
func (h *PlatformInvitationHandler) RegisterAcceptRoute(r *router.Router, mw ...schemas.BifrostHTTPMiddleware) {
	r.POST("/api/platform/invitations/{token}/accept", lib.ChainMiddlewares(h.acceptInvitation, mw...))
}

// getInvitationDetails handles GET /api/platform/invitations/:token — public, no auth required.
func (h *PlatformInvitationHandler) getInvitationDetails(ctx *fasthttp.RequestCtx) {
	token, _ := ctx.UserValue("token").(string)
	if token == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Token is required")
		return
	}

	var invitation tables.TablePlatformInvitation
	if err := h.db.Where("token = ?", token).First(&invitation).Error; err != nil {
		sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Invitation not found")
		return
	}

	if invitation.Accepted {
		sendError(ctx, fasthttp.StatusGone, "GONE", "Invitation has already been accepted")
		return
	}
	if time.Now().After(invitation.ExpiresAt) {
		sendError(ctx, fasthttp.StatusGone, "EXPIRED", "Invitation has expired")
		return
	}

	// Resolve org/team names for the UI
	orgName := "Unknown Organization"
	teamName := "Unknown Team"
	if invitation.OrgID != nil && *invitation.OrgID != "" {
		var org tables.TableCustomer
		if err := h.db.Where("id = ?", *invitation.OrgID).First(&org).Error; err == nil {
			orgName = org.Name
		}
	}
	if invitation.TeamID != nil && *invitation.TeamID != "" {
		var team tables.TableTeam
		if err := h.db.Where("id = ?", *invitation.TeamID).First(&team).Error; err == nil {
			teamName = team.Name
		}
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"id":         invitation.ID,
			"email":      invitation.Email,
			"role":       invitation.Role,
			"org_name":   orgName,
			"team_name":  teamName,
			"expires_at": invitation.ExpiresAt,
			"team_id":    invitation.TeamID,
			"org_id":     invitation.OrgID,
		},
	})
}

// acceptInvitation handles POST /api/platform/invitations/:token/accept.
// Requires platform auth — user's email is verified against the invitation.
func (h *PlatformInvitationHandler) acceptInvitation(ctx *fasthttp.RequestCtx) {
	token, _ := ctx.UserValue("token").(string)
	if token == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Token is required")
		return
	}

	// Get the current user's email from the platform session
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Must be logged in to accept invitation")
		return
	}

	userID := claims.UserID
	userEmail := claims.Email

	if userEmail == "" {
		// Try to get email from auth_users table
		var authUser struct {
			Email string `gorm:"column:email"`
		}
		if err := h.db.Table("auth_users").Select("email").Where("id = ?", userID).First(&authUser).Error; err == nil {
			userEmail = authUser.Email
		}
	}

	if userEmail == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Your account has no email on file; please contact support")
		return
	}

	if err := h.svc.AcceptInvitation(token, userID, userEmail); err != nil {
		switch err.Error() {
		case "invitation not found":
			sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Invitation not found")
		case "invitation already accepted":
			sendError(ctx, fasthttp.StatusGone, "GONE", "Invitation already accepted")
		case "invitation has expired":
			sendError(ctx, fasthttp.StatusGone, "EXPIRED", "Invitation has expired")
		case "invitation was sent to a different email address":
			sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "This invitation was sent to a different email address")
		default:
			sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to accept invitation")
		}
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "Invitation accepted successfully",
	})
}
