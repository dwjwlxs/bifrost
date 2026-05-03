package handlers

import (
	"encoding/json"
	"log"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/messenger"
	"github.com/maximhq/bifrost/framework/model"
	"github.com/maximhq/bifrost/framework/platform"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// PlatformTeamHandler handles team management API operations.
type PlatformTeamHandler struct {
	db            *gorm.DB
	configStore   configstore.ConfigStore
	invitationSvc platform.InvitationService
}

// NewPlatformTeamHandler creates a new PlatformTeamHandler.
func NewPlatformTeamHandler(db *gorm.DB, configStore configstore.ConfigStore, logger schemas.Logger,
	messenger messenger.Sender, platformURL string,
) *PlatformTeamHandler {
	invitationSvc := platform.NewInvitationService(db, messenger, platformURL, logger)
	return &PlatformTeamHandler{
		db:            db,
		configStore:   configStore,
		invitationSvc: invitationSvc,
	}
}

// RegisterRoutes registers all platform team routes.
func (h *PlatformTeamHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	// Registered directly on the router to avoid trailing-slash issues with group.GET("/").
	teamMemberMw := make([]schemas.BifrostHTTPMiddleware, len(middlewares), len(middlewares)+1)
	copy(teamMemberMw, middlewares)
	teamMemberMw = append(teamMemberMw, RequireTeamMember)

	teamAdminMw := make([]schemas.BifrostHTTPMiddleware, len(middlewares), len(middlewares)+1)
	copy(teamAdminMw, middlewares)
	teamAdminMw = append(teamAdminMw, RequireTeamAdmin(h.db))

	r.GET("/api/platform/teams", lib.ChainMiddlewares(h.listMyTeams, middlewares...))
	r.GET("/api/platform/teams/{teamId}", lib.ChainMiddlewares(h.getTeam, teamMemberMw...))
	r.PUT("/api/platform/teams/{teamId}", lib.ChainMiddlewares(h.updateTeam, teamAdminMw...))
	r.GET("/api/platform/teams/{teamId}/members", lib.ChainMiddlewares(h.listTeamMembers, teamMemberMw...))
	r.POST("/api/platform/teams/{teamId}/members", lib.ChainMiddlewares(h.inviteMember, teamAdminMw...))
	r.DELETE("/api/platform/teams/{teamId}/members/{uid}", lib.ChainMiddlewares(h.removeMember, teamAdminMw...))
	r.PUT("/api/platform/teams/{teamId}/members/{uid}", lib.ChainMiddlewares(h.updateMemberRole, teamAdminMw...))
	r.DELETE("/api/platform/teams/{teamId}", lib.ChainMiddlewares(h.deleteTeam, teamAdminMw...))
}

// listMyTeams handles GET /api/platform/teams — list teams the current user belongs to.
// For system admins (is_admin=true), returns all teams.
func (h *PlatformTeamHandler) listMyTeams(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Unauthorized")
		return
	}

	// System admins see all teams
	if claims.IsAdmin {
		var teams []tables.TableTeam
		if err := h.db.Find(&teams).Error; err != nil {
			sendError(ctx, fasthttp.StatusInternalServerError, "Failed to list teams", err.Error())
			return
		}
		items := make([]map[string]any, len(teams))
		for i, t := range teams {
			items[i] = map[string]any{
				"id":          t.ID,
				"name":        t.Name,
				"customer_id": t.CustomerID,
				"role":        model.TeamRoleAdmin,
				"created_at":  t.CreatedAt,
				"updated_at":  t.UpdatedAt,
			}
		}
		sendJSON(ctx, map[string]any{
			"code":    "0",
			"message": "success",
			"data": map[string]any{
				"items": items,
				"total": len(items),
			},
		})
		return
	}

	// Non-admin users: list teams from their JWT claims (populated from platform_team_members)
	teamIDs := make([]string, 0, len(claims.Teams))
	for _, team := range claims.Teams {
		teamIDs = append(teamIDs, team.ID)
	}

	if len(teamIDs) == 0 {
		sendJSON(ctx, map[string]any{
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
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to list teams", err.Error())
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

	sendJSON(ctx, map[string]any{
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
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID is required")
		return
	}

	var team tables.TableTeam
	if err := h.db.Where("id = ?", teamID).First(&team).Error; err != nil {
		sendError(ctx, fasthttp.StatusNotFound, "Team not found", err.Error())
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

	sendJSON(ctx, map[string]any{
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
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID is required")
		return
	}

	var req struct {
		Name *string `json:"name"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}

	var team tables.TableTeam
	if err := h.db.Where("id = ?", teamID).First(&team).Error; err != nil {
		sendError(ctx, fasthttp.StatusNotFound, "Team not found", err.Error())
		return
	}

	if req.Name != nil && *req.Name != "" {
		team.Name = *req.Name
	}

	if err := h.db.Save(&team).Error; err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to update team", err.Error())
		return
	}

	sendJSON(ctx, map[string]any{
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
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID is required")
		return
	}

	var members []tables.TablePlatformTeamMember
	if err := h.db.Where("team_id = ?", teamID).Find(&members).Error; err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to list team members", err.Error())
		return
	}

	// Collect user IDs to batch-query email/username from auth_users
	userIDs := make([]string, len(members))
	for i, m := range members {
		userIDs[i] = m.UserID
	}

	type authUserInfo struct {
		ID       string `gorm:"column:id"`
		Email    string `gorm:"column:email"`
		Username string `gorm:"column:username"`
	}
	var userInfos []authUserInfo
	if len(userIDs) > 0 {
		if err := h.db.Table("auth_users").Select("id, email, username").Where("id IN ? AND deleted_at IS NULL", userIDs).Find(&userInfos).Error; err != nil {
			// Non-fatal: proceed without user info
			log.Printf("WARN: failed to query auth_users for team members: %v", err)
		}
	}

	userInfoMap := make(map[string]authUserInfo, len(userInfos))
	for _, u := range userInfos {
		userInfoMap[u.ID] = u
	}

	items := make([]map[string]any, len(members))
	for i, m := range members {
		item := map[string]any{
			"team_id":   m.TeamID,
			"user_id":   m.UserID,
			"role":      m.Role,
			"joined_at": m.JoinedAt,
		}
		if info, ok := userInfoMap[m.UserID]; ok {
			item["email"] = info.Email
			item["username"] = info.Username
		}
		items[i] = item
	}

	sendJSON(ctx, map[string]any{
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
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID is required")
		return
	}

	var req struct {
		UserID string `json:"user_id"`
		Email  string `json:"email"`
		Role   string `json:"role"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}

	if req.UserID == "" && req.Email == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "user_id or email is required")
		return
	}

	// Default role to TeamRoleMember
	if req.Role == "" {
		req.Role = model.TeamRoleMember
	}

	if !model.IsValidTeamRole(req.Role) {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid role: must be member or admin")
		return
	}

	// Get the team to find its parent org
	var team tables.TableTeam
	if err := h.db.Where("id = ?", teamID).First(&team).Error; err != nil {
		sendError(ctx, fasthttp.StatusNotFound, "Team not found", err.Error())
		return
	}

	// If user_id is provided, try to add them directly
	if req.UserID != "" {
		h.addMemberDirectly(ctx, teamID, req.UserID, req.Role, team.CustomerID)
		return
	}

	// If email is provided, create an invitation via InvitationService
	if req.Email != "" {
		claims := GetPlatformClaimsFromContext(ctx)
		inviterName := ""
		if claims != nil {
			inviterName = claims.UserName
		}
		if err := h.invitationSvc.CreateInvitation(teamID, team.CustomerID, req.Email, req.Role, inviterName, team.Name, ""); err != nil {
			sendError(ctx, fasthttp.StatusInternalServerError, "Failed to create invitation", err.Error())
			return
		}
		sendJSON(ctx, map[string]any{
			"code":    "0",
			"message": "Invitation created successfully",
		})
		return
	}
}

// addMemberDirectly adds an existing user to a team (and optionally their org).
func (h *PlatformTeamHandler) addMemberDirectly(ctx *fasthttp.RequestCtx, teamID, userID, role string, customerID *string) {
	// Check if already a team member
	var existing tables.TablePlatformTeamMember
	if err := h.db.Where("team_id = ? AND user_id = ?", teamID, userID).First(&existing).Error; err == nil {
		sendError(ctx, fasthttp.StatusConflict, "User is already a team member", err.Error())
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
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to start transaction", tx.Error.Error())
		return
	}

	if err := tx.Create(&teamMember).Error; err != nil {
		tx.Rollback()
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to add team member", err.Error())
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
				Role:     model.OrgRoleMember,
				JoinedAt: now,
			}
			if err := tx.Create(&orgMember).Error; err != nil {
				tx.Rollback()
				sendError(ctx, fasthttp.StatusInternalServerError, "Failed to add org membership", err.Error())
				return
			}
		}
	}

	if err := tx.Commit().Error; err != nil {
		log.Printf("ERROR: failed to commit transaction in addMemberDirectly: %v", err)
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to add team member", err.Error())
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"user_id": userID,
			"team_id": teamID,
			"role":    role,
		},
	})
}

// removeMember handles DELETE /api/platform/teams/{teamId}/members/{uid} — remove a member from a team.
func (h *PlatformTeamHandler) removeMember(ctx *fasthttp.RequestCtx) {
	teamID, _ := ctx.UserValue("teamId").(string)
	uid, _ := ctx.UserValue("uid").(string)
	if teamID == "" || uid == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID and user ID are required")
		return
	}

	result := h.db.Where("team_id = ? AND user_id = ?", teamID, uid).Delete(&tables.TablePlatformTeamMember{})
	if result.Error != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to remove team member", result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Team member not found")
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "Team member removed successfully",
	})
}

// updateMemberRole handles PUT /api/platform/teams/{teamId}/members/{uid} — update a team member's role.
func (h *PlatformTeamHandler) updateMemberRole(ctx *fasthttp.RequestCtx) {
	teamID, _ := ctx.UserValue("teamId").(string)
	uid, _ := ctx.UserValue("uid").(string)
	if teamID == "" || uid == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID and user ID are required")
		return
	}

	var req struct {
		Role string `json:"role"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}

	if req.Role == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Role is required")
		return
	}

	if !model.IsValidTeamRole(req.Role) {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid role: must be member or admin")
		return
	}

	var member tables.TablePlatformTeamMember
	if err := h.db.Where("team_id = ? AND user_id = ?", teamID, uid).First(&member).Error; err != nil {
		sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Team member not found")
		return
	}

	member.Role = req.Role
	if err := h.db.Save(&member).Error; err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to update team member role", err.Error())
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"user_id": member.UserID,
			"team_id": member.TeamID,
			"role":    member.Role,
		},
	})
}

// deleteTeam handles DELETE /api/platform/teams/{teamId} — delete a team.
// Only team admins (or org admins / system admins) can delete a team.
func (h *PlatformTeamHandler) deleteTeam(ctx *fasthttp.RequestCtx) {
	teamID, _ := ctx.UserValue("teamId").(string)
	if teamID == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID is required")
		return
	}

	tx := h.db.Begin()
	if tx.Error != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to start transaction", tx.Error.Error())
		return
	}

	// Check team exists
	var team tables.TableTeam
	if err := tx.Where("id = ?", teamID).First(&team).Error; err != nil {
		tx.Rollback()
		sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Team not found")
		return
	}

	// Remove team members first
	if err := tx.Where("team_id = ?", teamID).Delete(&tables.TablePlatformTeamMember{}).Error; err != nil {
		tx.Rollback()
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to remove team members", err.Error())
		return
	}

	// Delete the team
	if err := tx.Delete(&team).Error; err != nil {
		tx.Rollback()
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to delete team", err.Error())
		return
	}

	if err := tx.Commit().Error; err != nil {
		log.Printf("ERROR: failed to commit transaction in deleteTeam: %v", err)
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to delete team", err.Error())
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "Team deleted successfully",
	})
}
