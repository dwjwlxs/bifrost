package handlers

import (
	"encoding/json"
	"log"
	"time"

	"github.com/fasthttp/router"
	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// PlatformTeamHandler handles team management API operations.
type PlatformTeamHandler struct {
	db          *gorm.DB
	configStore configstore.ConfigStore
}

// NewPlatformTeamHandler creates a new PlatformTeamHandler.
func NewPlatformTeamHandler(db *gorm.DB, configStore configstore.ConfigStore) *PlatformTeamHandler {
	return &PlatformTeamHandler{
		db:          db,
		configStore: configStore,
	}
}

// RegisterRoutes registers all platform team routes.
func (h *PlatformTeamHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	group := r.Group("/api/platform/teams")
	teamMemberMw := append([]schemas.BifrostHTTPMiddleware{RequireTeamMember}, middlewares...)
	teamAdminMw := append([]schemas.BifrostHTTPMiddleware{RequireTeamAdmin(h.db)}, middlewares...)

	group.GET("/", lib.ChainMiddlewares(h.listMyTeams, middlewares...))
	group.GET("/{teamId}", lib.ChainMiddlewares(h.getTeam, teamMemberMw...))
	group.PUT("/{teamId}", lib.ChainMiddlewares(h.updateTeam, teamAdminMw...))
	group.GET("/{teamId}/members", lib.ChainMiddlewares(h.listTeamMembers, teamMemberMw...))
	group.POST("/{teamId}/members", lib.ChainMiddlewares(h.inviteMember, teamAdminMw...))
	group.DELETE("/{teamId}/members/{uid}", lib.ChainMiddlewares(h.removeMember, teamAdminMw...))
	group.PUT("/{teamId}/members/{uid}", lib.ChainMiddlewares(h.updateMemberRole, teamAdminMw...))
}

// listMyTeams handles GET /api/platform/teams — list teams the current user belongs to.
func (h *PlatformTeamHandler) listMyTeams(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
		return
	}

	teamIDs := make([]string, 0, len(claims.Teams))
	for _, team := range claims.Teams {
		teamIDs = append(teamIDs, team.ID)
	}

	if len(teamIDs) == 0 {
		SendJSON(ctx, map[string]any{
			"code":    "0",
			"message": "success",
			"data": map[string]any{
				"items": []any{},
				"total": 0,
			},
		})
		return
	}

	var teams []tables.TableTeam
	if err := h.db.Where("id IN ?", teamIDs).Find(&teams).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list teams")
		return
	}

	teamsByID := make(map[string]tables.TableTeam, len(teams))
	for _, t := range teams {
		teamsByID[t.ID] = t
	}

	items := make([]map[string]any, 0, len(claims.Teams))
	for _, team := range claims.Teams {
		t, exists := teamsByID[team.ID]
		item := map[string]any{
			"id":   team.ID,
			"role": team.Role,
		}
		if exists {
			item["name"] = t.Name
			item["customer_id"] = t.CustomerID
			item["created_at"] = t.CreatedAt
			item["updated_at"] = t.UpdatedAt
		}
		items = append(items, item)
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"items": items,
			"total": len(items),
		},
	})
}

// getTeam handles GET /api/platform/teams/{teamId} — get team details.
func (h *PlatformTeamHandler) getTeam(ctx *fasthttp.RequestCtx) {
	teamID, _ := ctx.UserValue("teamId").(string)
	if teamID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Team ID is required")
		return
	}

	var team tables.TableTeam
	if err := h.db.Where("id = ?", teamID).First(&team).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "Team not found")
		return
	}

	// Get user's role in this team
	claims := GetPlatformClaimsFromContext(ctx)
	role := ""
	if claims != nil {
		for _, t := range claims.Teams {
			if t.ID == teamID {
				role = t.Role
				break
			}
		}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"id":          team.ID,
			"name":        team.Name,
			"customer_id": team.CustomerID,
			"role":        role,
			"created_at":  team.CreatedAt,
			"updated_at":  team.UpdatedAt,
		},
	})
}

// updateTeam handles PUT /api/platform/teams/{teamId} — update team details.
func (h *PlatformTeamHandler) updateTeam(ctx *fasthttp.RequestCtx) {
	teamID, _ := ctx.UserValue("teamId").(string)
	if teamID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Team ID is required")
		return
	}

	var req struct {
		Name *string `json:"name"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format")
		return
	}

	var team tables.TableTeam
	if err := h.db.Where("id = ?", teamID).First(&team).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "Team not found")
		return
	}

	if req.Name != nil && *req.Name != "" {
		team.Name = *req.Name
	}

	if err := h.db.Save(&team).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to update team")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"id":          team.ID,
			"name":        team.Name,
			"customer_id": team.CustomerID,
			"updated_at":  team.UpdatedAt,
		},
	})
}

// listTeamMembers handles GET /api/platform/teams/{teamId}/members — list team members.
func (h *PlatformTeamHandler) listTeamMembers(ctx *fasthttp.RequestCtx) {
	teamID, _ := ctx.UserValue("teamId").(string)
	if teamID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Team ID is required")
		return
	}

	var members []tables.TablePlatformTeamMember
	if err := h.db.Where("team_id = ?", teamID).Find(&members).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list team members")
		return
	}

	items := make([]map[string]any, len(members))
	for i, m := range members {
		items[i] = map[string]any{
			"team_id":   m.TeamID,
			"user_id":   m.UserID,
			"role":      m.Role,
			"joined_at": m.JoinedAt,
		}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"items": items,
			"total": len(items),
		},
	})
}

// inviteMember handles POST /api/platform/teams/{teamId}/members — invite a user to a team.
func (h *PlatformTeamHandler) inviteMember(ctx *fasthttp.RequestCtx) {
	teamID, _ := ctx.UserValue("teamId").(string)
	if teamID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Team ID is required")
		return
	}

	var req struct {
		UserID string `json:"user_id"`
		Email  string `json:"email"`
		Role   string `json:"role"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format")
		return
	}

	if req.UserID == "" && req.Email == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "user_id or email is required")
		return
	}

	// Default role to "member"
	if req.Role == "" {
		req.Role = "member"
	}

	if !isValidRole(req.Role) {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid role: must be member, admin, or owner")
		return
	}

	// Get the team to find its parent org
	var team tables.TableTeam
	if err := h.db.Where("id = ?", teamID).First(&team).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "Team not found")
		return
	}

	// If user_id is provided, try to add them directly
	if req.UserID != "" {
		h.addMemberDirectly(ctx, teamID, req.UserID, req.Role, team.CustomerID)
		return
	}

	// If email is provided, create an invitation
	// The old user table lookup was removed — user IDs now come from the auth system (UUID strings)
	if req.Email != "" {
		h.createInvitation(ctx, teamID, &req.Email, req.Role, team.CustomerID)
		return
	}
}

// addMemberDirectly adds an existing user to a team (and optionally their org).
func (h *PlatformTeamHandler) addMemberDirectly(ctx *fasthttp.RequestCtx, teamID, userID, role string, customerID *string) {
	// Check if already a team member
	var existing tables.TablePlatformTeamMember
	if err := h.db.Where("team_id = ? AND user_id = ?", teamID, userID).First(&existing).Error; err == nil {
		SendError(ctx, fasthttp.StatusConflict, "User is already a team member")
		return
	}

	now := time.Now()
	teamMember := tables.TablePlatformTeamMember{
		TeamID:   teamID,
		UserID:   userID,
		Role:     role,
		JoinedAt: now,
	}

	tx := h.db.Begin()
	if tx.Error != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to start transaction")
		return
	}

	if err := tx.Create(&teamMember).Error; err != nil {
		tx.Rollback()
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to add team member")
		return
	}

	// Also add to org if the team has a parent org
	if customerID != nil && *customerID != "" {
		var existingOrgMember tables.TablePlatformOrgMember
		if err := tx.Where("org_id = ? AND user_id = ?", *customerID, userID).First(&existingOrgMember).Error; err != nil {
			// Not yet an org member — add as org member
			orgMember := tables.TablePlatformOrgMember{
				OrgID:    *customerID,
				UserID:   userID,
				Role:     "member",
				JoinedAt: now,
			}
			if err := tx.Create(&orgMember).Error; err != nil {
				tx.Rollback()
				SendError(ctx, fasthttp.StatusInternalServerError, "Failed to add org membership")
				return
			}
		}
	}

	if err := tx.Commit().Error; err != nil {
		log.Printf("ERROR: failed to commit transaction in addMemberDirectly: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to add team member")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"user_id": userID,
			"team_id": teamID,
			"role":    role,
		},
	})
}

// createInvitation creates a pending invitation for a user to join a team.
func (h *PlatformTeamHandler) createInvitation(ctx *fasthttp.RequestCtx, teamID string, email *string, role string, customerID *string) {
	invitation := tables.TablePlatformInvitation{
		ID:        uuid.NewString(),
		TeamID:    &teamID,
		OrgID:     customerID,
		Email:     *email,
		Role:      role,
		Token:     uuid.NewString(),
		ExpiresAt: time.Now().Add(7 * 24 * time.Hour), // 7 days
		Accepted:  false,
	}

	if err := h.db.Create(&invitation).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to create invitation")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "Invitation created successfully",
		"data": map[string]any{
			"id":         invitation.ID,
			"email":      invitation.Email,
			"role":       invitation.Role,
			"expires_at": invitation.ExpiresAt,
		},
	})
}

// removeMember handles DELETE /api/platform/teams/{teamId}/members/{uid} — remove a member from a team.
func (h *PlatformTeamHandler) removeMember(ctx *fasthttp.RequestCtx) {
	teamID, _ := ctx.UserValue("teamId").(string)
	uid, _ := ctx.UserValue("uid").(string)
	if teamID == "" || uid == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Team ID and user ID are required")
		return
	}

	result := h.db.Where("team_id = ? AND user_id = ?", teamID, uid).Delete(&tables.TablePlatformTeamMember{})
	if result.Error != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to remove team member")
		return
	}
	if result.RowsAffected == 0 {
		SendError(ctx, fasthttp.StatusNotFound, "Team member not found")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "Team member removed successfully",
	})
}

// updateMemberRole handles PUT /api/platform/teams/{teamId}/members/{uid} — update a team member's role.
func (h *PlatformTeamHandler) updateMemberRole(ctx *fasthttp.RequestCtx) {
	teamID, _ := ctx.UserValue("teamId").(string)
	uid, _ := ctx.UserValue("uid").(string)
	if teamID == "" || uid == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Team ID and user ID are required")
		return
	}

	var req struct {
		Role string `json:"role"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format")
		return
	}

	if req.Role == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Role is required")
		return
	}

	if !isValidRole(req.Role) {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid role: must be member, admin, or owner")
		return
	}

	var member tables.TablePlatformTeamMember
	if err := h.db.Where("team_id = ? AND user_id = ?", teamID, uid).First(&member).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "Team member not found")
		return
	}

	member.Role = req.Role
	if err := h.db.Save(&member).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to update team member role")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"user_id": member.UserID,
			"team_id": member.TeamID,
			"role":    member.Role,
		},
	})
}

// isValidRole checks whether the given role string is one of the allowed roles.
func isValidRole(role string) bool {
	switch role {
	case "member", "admin", "owner":
		return true
	default:
		return false
	}
}
