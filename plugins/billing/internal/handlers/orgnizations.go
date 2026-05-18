package handlers

import (
	"encoding/json"
	"log"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	bconfig "github.com/maximhq/bifrost/plugins/billing/internal/config"
	"github.com/maximhq/bifrost/plugins/billing/internal/model"
	"github.com/maximhq/bifrost/plugins/billing/internal/repos/billingstore/tables"
	"github.com/maximhq/bifrost/plugins/billing/internal/services/console"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// PlatformOrgHandler handles organization management API operations.
type PlatformOrgHandler struct {
	db            *gorm.DB
	configStore   configstore.ConfigStore
	invitationSvc console.InvitationService
}

// NewPlatformOrgHandler creates a new PlatformOrgHandler.
func NewPlatformOrgHandler(config *bconfig.BillingPluginConfig) *PlatformOrgHandler {
	invitationSvc := console.NewInvitationService(config.Config.ConfigStore.DB(), config.Messenger, config.PlatformURL, config.Config.Logger)
	return &PlatformOrgHandler{
		db:            config.Config.ConfigStore.DB(),
		configStore:   config.Config.ConfigStore,
		invitationSvc: invitationSvc,
	}
}

// RegisterRoutes registers all console org routes.
func (h *PlatformOrgHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	// Registered directly on the router to avoid trailing-slash issues with group.GET("/").
	orgAdminMw := make([]schemas.BifrostHTTPMiddleware, len(middlewares), len(middlewares)+1)
	copy(orgAdminMw, middlewares)
	orgAdminMw = append(orgAdminMw, RequireOrgAdmin)

	orgMemberMw := make([]schemas.BifrostHTTPMiddleware, len(middlewares), len(middlewares)+1)
	copy(orgMemberMw, middlewares)
	orgMemberMw = append(orgMemberMw, RequireOrgMember)

	r.GET("/api/platform/orgs", lib.ChainMiddlewares(h.listMyOrgs, middlewares...))
	r.GET("/api/platform/orgs/{orgId}", lib.ChainMiddlewares(h.getOrg, orgMemberMw...))
	r.PUT("/api/platform/orgs/{orgId}", lib.ChainMiddlewares(h.updateOrg, orgAdminMw...))
	r.GET("/api/platform/orgs/{orgId}/teams", lib.ChainMiddlewares(h.listOrgTeams, orgAdminMw...))
	r.POST("/api/platform/orgs/{orgId}/teams", lib.ChainMiddlewares(h.createOrgTeam, orgAdminMw...))
	r.GET("/api/platform/orgs/{orgId}/members", lib.ChainMiddlewares(h.listOrgMembers, orgAdminMw...))
	r.POST("/api/platform/orgs/{orgId}/members/invite", lib.ChainMiddlewares(h.inviteOrgMember, orgAdminMw...))
	r.DELETE("/api/platform/orgs/{orgId}/members/{uid}", lib.ChainMiddlewares(h.removeOrgMember, orgAdminMw...))
	r.PUT("/api/platform/orgs/{orgId}/members/{uid}", lib.ChainMiddlewares(h.updateOrgMemberRole, orgAdminMw...))
}

// listMyOrgs handles GET /api/platform/orgs — list organizations the current user belongs to.
// For system admins (is_admin=true), returns all organizations.
func (h *PlatformOrgHandler) listMyOrgs(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Unauthorized")
		return
	}

	// System admins see all organizations
	if claims.IsAdmin {
		var customers []configstoreTables.TableCustomer
		if err := h.db.Find(&customers).Error; err != nil {
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list organizations", err.Error())
			return
		}

		ownerUserIDs := make([]string, 0, len(customers))
		for _, c := range customers {
			if c.OwnerUserID != nil && *c.OwnerUserID != "" {
				ownerUserIDs = append(ownerUserIDs, *c.OwnerUserID)
			}
		}
		ownerNames := h.batchGetUsernames(ownerUserIDs)

		items := make([]map[string]any, len(customers))
		for i, c := range customers {
			item := map[string]any{
				"id":         c.ID,
				"name":       c.Name,
				"role":       model.OrgRoleAdmin,
				"created_at": c.CreatedAt,
				"updated_at": c.UpdatedAt,
			}
			if c.OwnerUserID != nil {
				item["owner_user_id"] = *c.OwnerUserID
				if username, ok := ownerNames[*c.OwnerUserID]; ok {
					item["owner_username"] = username
				}
			}
			items[i] = item
		}
		SendJSON(ctx, map[string]any{
			"code":    "0",
			"message": "success",
			"data": map[string]any{
				"items": items,
				"total": len(items),
			},
		})
		return
	}

	// Non-admin users: list orgs from their JWT claims (populated from console_org_members)
	orgIDs := make([]string, 0, len(claims.Orgs))
	for _, org := range claims.Orgs {
		orgIDs = append(orgIDs, org.ID)
	}

	if len(orgIDs) == 0 {
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

	// Query governance_customers for org details
	var customers []configstoreTables.TableCustomer
	if err := h.db.Where("id IN ?", orgIDs).Find(&customers).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list organizations", err.Error())
		return
	}

	// Build response with role from claims
	customersByID := make(map[string]configstoreTables.TableCustomer, len(customers))
	for _, c := range customers {
		customersByID[c.ID] = c
	}

	// Batch query owner usernames
	ownerUserIDs := make([]string, 0)
	for _, c := range customers {
		if c.OwnerUserID != nil && *c.OwnerUserID != "" {
			ownerUserIDs = append(ownerUserIDs, *c.OwnerUserID)
		}
	}
	ownerNames := h.batchGetUsernames(ownerUserIDs)

	items := make([]map[string]any, 0, len(claims.Orgs))
	for _, org := range claims.Orgs {
		c, exists := customersByID[org.ID]
		item := map[string]any{
			"id":   org.ID,
			"role": org.Role,
		}
		if exists {
			item["name"] = c.Name
			item["created_at"] = c.CreatedAt
			item["updated_at"] = c.UpdatedAt
			if c.OwnerUserID != nil {
				item["owner_user_id"] = *c.OwnerUserID
				if username, ok := ownerNames[*c.OwnerUserID]; ok {
					item["owner_username"] = username
				}
			}
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

// getOrg handles GET /api/platform/orgs/{orgId} — get organization details.
func (h *PlatformOrgHandler) getOrg(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	if orgID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Organization ID is required")
		return
	}

	var customer configstoreTables.TableCustomer
	if err := h.db.Where("id = ?", orgID).First(&customer).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Organization not found")
		return
	}

	// Get user's role in this org
	claims := GetPlatformClaimsFromContext(ctx)
	role := ""
	if claims != nil {
		if claims.IsAdmin {
			role = model.OrgRoleAdmin
		} else {
			for _, org := range claims.Orgs {
				if org.ID == orgID {
					role = org.Role
					break
				}
			}
		}
	}

	// Resolve owner username
	ownerUsername := ""
	if customer.OwnerUserID != nil && *customer.OwnerUserID != "" {
		names := h.batchGetUsernames([]string{*customer.OwnerUserID})
		if u, ok := names[*customer.OwnerUserID]; ok {
			ownerUsername = u
		}
	}

	data := map[string]any{
		"id":         customer.ID,
		"name":       customer.Name,
		"budgets":    customer.Budgets,
		"role":       role,
		"created_at": customer.CreatedAt,
		"updated_at": customer.UpdatedAt,
	}
	if customer.OwnerUserID != nil {
		data["owner_user_id"] = *customer.OwnerUserID
	}
	if ownerUsername != "" {
		data["owner_username"] = ownerUsername
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    data,
	})
}

// listOrgTeams handles GET /api/platform/orgs/{orgId}/teams — list teams in an organization.
func (h *PlatformOrgHandler) listOrgTeams(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	if orgID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Organization ID is required")
		return
	}

	var teams []configstoreTables.TableTeam
	if err := h.db.Where("customer_id = ?", orgID).Find(&teams).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list teams", err.Error())
		return
	}

	items := make([]map[string]any, len(teams))
	for i, t := range teams {
		items[i] = map[string]any{
			"id":          t.ID,
			"name":        t.Name,
			"customer_id": t.CustomerID,
			"created_at":  t.CreatedAt,
			"updated_at":  t.UpdatedAt,
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

// listOrgMembers handles GET /api/platform/orgs/{orgId}/members — list members of an organization.
func (h *PlatformOrgHandler) listOrgMembers(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	if orgID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Organization ID is required")
		return
	}

	var members []tables.TablePlatformOrgMember
	if err := h.db.Where("org_id = ?", orgID).Find(&members).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list org members", err.Error())
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
		Username string `gorm:"column:user_name"`
	}
	var userInfos []authUserInfo
	if len(userIDs) > 0 {
		if err := h.db.Table("auth_users").Select("id, email, user_name").Where("id IN ? AND deleted_at IS NULL", userIDs).Find(&userInfos).Error; err != nil {
			// Non-fatal: proceed without user info
			log.Printf("WARN: failed to query auth_users for org members: %v", err)
		}
	}

	userInfoMap := make(map[string]authUserInfo, len(userInfos))
	for _, u := range userInfos {
		userInfoMap[u.ID] = u
	}

	items := make([]map[string]any, len(members))
	for i, m := range members {
		item := map[string]any{
			"org_id":    m.OrgID,
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

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"items": items,
			"total": len(items),
		},
	})
}

// updateOrg handles PUT /api/platform/orgs/{orgId} — update organization details.
func (h *PlatformOrgHandler) updateOrg(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	if orgID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Organization ID is required")
		return
	}

	var req struct {
		Name        string  `json:"name"`
		OwnerUserID *string `json:"owner_user_id,omitempty"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}

	var customer configstoreTables.TableCustomer
	if err := h.db.Where("id = ?", orgID).First(&customer).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Organization not found")
		return
	}

	if req.Name != "" {
		customer.Name = req.Name
	}
	if req.OwnerUserID != nil {
		customer.OwnerUserID = req.OwnerUserID
	}
	if err := h.db.Save(&customer).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to update organization", err.Error())
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"id":            customer.ID,
			"name":          customer.Name,
			"owner_user_id": customer.OwnerUserID,
			"updated_at":    customer.UpdatedAt,
		},
	})
}

// createOrgTeam handles POST /api/platform/orgs/{orgId}/teams — create a team under an organization.
func (h *PlatformOrgHandler) createOrgTeam(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	if orgID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Organization ID is required")
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}
	if req.Name == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team name is required")
		return
	}

	// Verify org exists
	var customer configstoreTables.TableCustomer
	if err := h.db.Where("id = ?", orgID).First(&customer).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Organization not found")
		return
	}

	now := time.Now()
	team := configstoreTables.TableTeam{
		ID:         schemas.NewID(),
		Name:       req.Name,
		CustomerID: &orgID,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	if err := h.db.Create(&team).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to create team", err.Error())
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"id":          team.ID,
			"name":        team.Name,
			"customer_id": team.CustomerID,
			"created_at":  team.CreatedAt,
		},
	})
}

// inviteOrgMember handles POST /api/platform/orgs/{orgId}/members/invite — invite a user to an org.
func (h *PlatformOrgHandler) inviteOrgMember(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	if orgID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Organization ID is required")
		return
	}

	var req struct {
		UserID string `json:"user_id"`
		Email  string `json:"email"`
		Role   string `json:"role"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}

	if req.UserID == "" && req.Email == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "user_id or email is required")
		return
	}

	// Default role to OrgRoleMember
	if req.Role == "" {
		req.Role = model.OrgRoleMember
	}
	if !model.IsValidOrgRole(req.Role) {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid role: must be member, admin, or owner")
		return
	}

	// Verify org exists
	var customer configstoreTables.TableCustomer
	if err := h.db.Where("id = ?", orgID).First(&customer).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Organization not found")
		return
	}

	// If user_id is provided, add them directly
	if req.UserID != "" {
		h.addOrgMemberDirectly(ctx, orgID, req.UserID, req.Role)
		return
	}

	// If email is provided, create an invitation via InvitationService
	claims := GetPlatformClaimsFromContext(ctx)
	inviterName := ""
	if claims != nil {
		inviterName = claims.UserName
	}
	if err := h.invitationSvc.CreateInvitation("", &orgID, req.Email, req.Role, inviterName, "", customer.Name); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to create invitation", err.Error())
		return
	}
	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "Invitation created successfully",
	})
}

// addOrgMemberDirectly adds an existing user to an organization.
func (h *PlatformOrgHandler) addOrgMemberDirectly(ctx *fasthttp.RequestCtx, orgID, userID, role string) {
	// Check if already an org member
	var existing tables.TablePlatformOrgMember
	if err := h.db.Where("org_id = ? AND user_id = ?", orgID, userID).First(&existing).Error; err == nil {
		SendError(ctx, fasthttp.StatusConflict, "ALREADY_MEMBER", "User is already an org member")
		return
	}

	now := time.Now()
	orgMember := tables.TablePlatformOrgMember{
		OrgID:    orgID,
		UserID:   userID,
		Role:     role,
		JoinedAt: now,
	}
	if err := h.db.Create(&orgMember).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to add org member", err.Error())
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"org_id":  orgID,
			"user_id": userID,
			"role":    role,
		},
	})
}

// removeOrgMember handles DELETE /api/platform/orgs/{orgId}/members/{uid} — remove a member from an org.
func (h *PlatformOrgHandler) removeOrgMember(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	uid, _ := ctx.UserValue("uid").(string)
	if orgID == "" || uid == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Organization ID and user ID are required")
		return
	}

	// Prevent removing the org owner
	var customer configstoreTables.TableCustomer
	if err := h.db.Where("id = ?", orgID).First(&customer).Error; err == nil {
		if customer.OwnerUserID != nil && *customer.OwnerUserID == uid {
			SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Cannot remove the organization owner")
			return
		}
	}

	tx := h.db.Begin()
	if tx.Error != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to start transaction", tx.Error.Error())
		return
	}

	// Remove from all teams under this org first
	if err := tx.Where("user_id = ? AND team_id IN (SELECT id FROM governance_teams WHERE customer_id = ?)", uid, orgID).Delete(&tables.TablePlatformTeamMember{}).Error; err != nil {
		tx.Rollback()
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to remove team memberships", err.Error())
		return
	}

	// Remove from org
	result := tx.Where("org_id = ? AND user_id = ?", orgID, uid).Delete(&tables.TablePlatformOrgMember{})
	if result.Error != nil {
		tx.Rollback()
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to remove org member", result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		tx.Rollback()
		SendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Org member not found")
		return
	}

	if err := tx.Commit().Error; err != nil {
		log.Printf("ERROR: failed to commit transaction in removeOrgMember: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to remove org member", err.Error())
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "Org member removed successfully",
	})
}

// updateOrgMemberRole handles PUT /api/platform/orgs/{orgId}/members/{uid} — update an org member's role.
func (h *PlatformOrgHandler) updateOrgMemberRole(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	uid, _ := ctx.UserValue("uid").(string)
	if orgID == "" || uid == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Organization ID and user ID are required")
		return
	}

	var req struct {
		Role string `json:"role"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}
	if req.Role == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Role is required")
		return
	}
	if !model.IsValidOrgRole(req.Role) {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid role: must be member, admin, or owner")
		return
	}

	var member tables.TablePlatformOrgMember
	if err := h.db.Where("org_id = ? AND user_id = ?", orgID, uid).First(&member).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Org member not found")
		return
	}

	member.Role = req.Role
	if err := h.db.Save(&member).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to update org member role", err.Error())
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"org_id":  member.OrgID,
			"user_id": member.UserID,
			"role":    member.Role,
		},
	})
}

// batchGetUsernames resolves user IDs to usernames by querying auth_users.
// Returns a map of user_id → username. Missing users are silently omitted.
func (h *PlatformOrgHandler) batchGetUsernames(userIDs []string) map[string]string {
	result := make(map[string]string, len(userIDs))
	if len(userIDs) == 0 {
		return result
	}

	type userInfo struct {
		ID       string `gorm:"column:id"`
		Username string `gorm:"column:user_name"`
	}
	var users []userInfo
	if err := h.db.Table("auth_users").Select("id, user_name").Where("id IN ? AND deleted_at IS NULL", userIDs).Find(&users).Error; err != nil {
		log.Printf("WARN: failed to query auth_users for owner usernames: %v", err)
		return result
	}
	for _, u := range users {
		result[u.ID] = u.Username
	}
	return result
}
