// Package handlers provides HTTP handlers for the Bifrost gateway.
package handlers

import (
	"time"

	bconfig "github.com/dwjwlxs/bifrost/plugins/billing/internal/config"
	"github.com/dwjwlxs/bifrost/plugins/billing/internal/repos/billingstore/tables"
	"github.com/dwjwlxs/bifrost/plugins/billing/internal/services/console"
	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// PlatformInvitationHandler handles public invitation API endpoints.
type PlatformInvitationHandler struct {
	db  *gorm.DB
	svc console.InvitationService
}

// NewPlatformInvitationHandler creates a new PlatformInvitationHandler.
func NewPlatformInvitationHandler(config *bconfig.BillingPluginConfig) *PlatformInvitationHandler {
	svc := console.NewInvitationService(config.Config.ConfigStore.DB(), config.Messenger, config.PlatformURL, config.Config.Logger)
	return &PlatformInvitationHandler{db: config.Config.ConfigStore.DB(), svc: svc}
}

// RegisterRoutes
func (h *PlatformInvitationHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {

	// registers public invitation routes (no platform auth middleware)
	r.GET("/api/platform/invitations/{token}", lib.ChainMiddlewares(h.getInvitationDetails))

	r.POST("/api/platform/invitations/{token}/accept", lib.ChainMiddlewares(h.acceptInvitation, middlewares...))
}

// getInvitationDetails handles GET /api/platform/invitations/:token — public, no auth required.
func (h *PlatformInvitationHandler) getInvitationDetails(ctx *fasthttp.RequestCtx) {
	token, _ := ctx.UserValue("token").(string)
	if token == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Token is required")
		return
	}

	var invitation tables.TablePlatformInvitation
	if err := h.db.Where("token = ?", token).First(&invitation).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Invitation not found")
		return
	}

	if invitation.Accepted {
		SendError(ctx, fasthttp.StatusGone, "GONE", "Invitation has already been accepted")
		return
	}
	if time.Now().After(invitation.ExpiresAt) {
		SendError(ctx, fasthttp.StatusGone, "EXPIRED", "Invitation has expired")
		return
	}

	// Resolve org/team names for the UI
	orgName := "Unknown Organization"
	teamName := "Unknown Team"
	if invitation.OrgID != nil && *invitation.OrgID != "" {
		var org configstoreTables.TableCustomer
		if err := h.db.Where("id = ?", *invitation.OrgID).First(&org).Error; err == nil {
			orgName = org.Name
		}
	}
	if invitation.TeamID != nil && *invitation.TeamID != "" {
		var team configstoreTables.TableTeam
		if err := h.db.Where("id = ?", *invitation.TeamID).First(&team).Error; err == nil {
			teamName = team.Name
		}
	}

	SendJSON(ctx, map[string]any{
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
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Token is required")
		return
	}

	// Get the current user's email from the platform session
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Must be logged in to accept invitation")
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
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Your account has no email on file; please contact support")
		return
	}

	if err := h.svc.AcceptInvitation(token, userID, userEmail); err != nil {
		switch err.Error() {
		case "invitation not found":
			SendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Invitation not found")
		case "invitation already accepted":
			SendError(ctx, fasthttp.StatusGone, "GONE", "Invitation already accepted")
		case "invitation has expired":
			SendError(ctx, fasthttp.StatusGone, "EXPIRED", "Invitation has expired")
		case "invitation was sent to a different email address":
			SendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "This invitation was sent to a different email address")
		default:
			SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to accept invitation")
		}
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "Invitation accepted successfully",
	})
}
