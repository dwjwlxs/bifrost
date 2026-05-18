package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	bconfig "github.com/maximhq/bifrost/plugins/billing/internal/config"
	"github.com/maximhq/bifrost/plugins/billing/internal/model"
	"github.com/maximhq/bifrost/plugins/billing/internal/repos/billingstore/tables"
	authsvc "github.com/maximhq/bifrost/plugins/billing/internal/services/authn"
	"github.com/maximhq/bifrost/plugins/billing/pkg/fhttp"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PlatformAdminHandler handles system admin API operations.
type PlatformAdminHandler struct {
	db            *gorm.DB
	configStore   configstore.ConfigStore
	consumerAuth  authsvc.AuthService
	inMemoryStore *bconfig.BillingPluginConfig
}

// NewPlatformAdminHandler creates a new PlatformAdminHandler.
func NewPlatformAdminHandler(config *bconfig.BillingPluginConfig) *PlatformAdminHandler {
	return &PlatformAdminHandler{
		db:            config.Config.ConfigStore.DB(),
		configStore:   config.Config.ConfigStore,
		consumerAuth:  config.ConsumerAuthService,
		inMemoryStore: config,
	}
}

// RegisterRoutes registers all platform admin routes.
func (h *PlatformAdminHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	group := r.Group("/api/platform/admin")
	adminMw := make([]schemas.BifrostHTTPMiddleware, len(middlewares), len(middlewares)+1)
	copy(adminMw, middlewares)
	adminMw = append(adminMw, RequireAdmin)

	group.GET("/orgs", fhttp.ChainMiddlewares(h.listOrgs, adminMw...))
	group.POST("/orgs", fhttp.ChainMiddlewares(h.createOrg, adminMw...))
	group.GET("/orgs/{orgId}", fhttp.ChainMiddlewares(h.getOrg, adminMw...))
	group.PUT("/orgs/{orgId}", fhttp.ChainMiddlewares(h.updateOrg, adminMw...))
	group.DELETE("/orgs/{orgId}", fhttp.ChainMiddlewares(h.deleteOrg, adminMw...))
	group.GET("/users", fhttp.ChainMiddlewares(h.listUsers, adminMw...))
	group.PUT("/users/{userId}/status", fhttp.ChainMiddlewares(h.updateUserStatus, adminMw...))
	group.PUT("/users/{userId}/admin", fhttp.ChainMiddlewares(h.updateUserAdmin, adminMw...))
}

// listOrgs handles GET /api/platform/admin/orgs — list all organizations (customers).
func (h *PlatformAdminHandler) listOrgs(ctx *fasthttp.RequestCtx) {
	offset, _ := strconv.ParseUint(string(ctx.QueryArgs().Peek("offset")), 10, 64)
	limit, _ := strconv.ParseUint(string(ctx.QueryArgs().Peek("limit")), 10, 64)
	if limit == 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	var total int64
	h.db.Model(&configstoreTables.TableCustomer{}).Count(&total)

	var customers []configstoreTables.TableCustomer
	if err := h.db.Order("created_at DESC").Offset(int(offset)).Limit(int(limit)).Find(&customers).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list organizations", err.Error())
		return
	}

	items := make([]map[string]any, len(customers))
	for i, c := range customers {
		items[i] = map[string]any{
			"id":            c.ID,
			"name":          c.Name,
			"owner_user_id": c.OwnerUserID,
			"budgets":       c.Budgets,
			"created_at":    c.CreatedAt,
			"updated_at":    c.UpdatedAt,
		}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"items": items,
			"total": total,
		},
	})
}

// createOrgRequest is the request body for creating an organization.
type createOrgRequest struct {
	Name        string  `json:"name"`
	AdminUserID *string `json:"admin_user_id,omitempty"` // Optional: assign admin to this org
}

// createOrg handles POST /api/platform/admin/orgs — create a new organization.
func (h *PlatformAdminHandler) createOrg(ctx *fasthttp.RequestCtx) {
	var req createOrgRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format", err.Error())
		return
	}

	if req.Name == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Organization name is required", "")
		return
	}

	orgID := schemas.NewID()
	now := time.Now()
	customer := configstoreTables.TableCustomer{
		ID:        orgID,
		Name:      req.Name,
		CreatedAt: now,
		UpdatedAt: now,
	}

	tx := h.db.Begin()
	if tx.Error != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to start transaction", tx.Error.Error())
		return
	}

	if err := tx.Create(&customer).Error; err != nil {
		tx.Rollback()
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to create organization", err.Error())
		return
	}

	// Optionally assign an admin user to this org
	if req.AdminUserID != nil && *req.AdminUserID != "" {
		orgMember := tables.TablePlatformOrgMember{
			OrgID:    orgID,
			UserID:   *req.AdminUserID,
			Role:     model.OrgRoleAdmin,
			JoinedAt: now,
		}
		if err := tx.Create(&orgMember).Error; err != nil {
			tx.Rollback()
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to assign org admin", err.Error())
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		log.Printf("ERROR: failed to commit transaction in createOrg: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to create organization", err.Error())
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"id":   orgID,
			"name": req.Name,
		},
	})
}

// getOrg handles GET /api/platform/admin/orgs/{orgId} — get organization details.
func (h *PlatformAdminHandler) getOrg(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	if orgID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Organization ID is required", "")
		return
	}

	var customer configstoreTables.TableCustomer
	if err := h.db.Where("id = ?", orgID).First(&customer).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "Organization not found", err.Error())
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"id":            customer.ID,
			"name":          customer.Name,
			"owner_user_id": customer.OwnerUserID,
			"budgets":       customer.Budgets,
			"created_at":    customer.CreatedAt,
			"updated_at":    customer.UpdatedAt,
		},
	})
}

// updateOrg handles PUT /api/platform/admin/orgs/{orgId} — update organization details.
func (h *PlatformAdminHandler) updateOrg(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	if orgID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Organization ID is required", "")
		return
	}

	var req struct {
		Name        string  `json:"name"`
		OwnerUserID *string `json:"owner_user_id,omitempty"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format", err.Error())
		return
	}

	if req.Name == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Organization name is required", "")
		return
	}

	var customer configstoreTables.TableCustomer
	if err := h.db.Where("id = ?", orgID).First(&customer).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "Organization not found", err.Error())
		return
	}

	// Check if owner is actually changing
	ownerChanged := req.OwnerUserID != nil && (customer.OwnerUserID == nil || *req.OwnerUserID != *customer.OwnerUserID)

	if ownerChanged {
		// Use transaction to atomically update customer + sync platform_org_members
		tx := h.db.Begin()
		if tx.Error != nil {
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to start transaction", tx.Error.Error())
			return
		}

		// 1. Update customer record
		customer.Name = req.Name
		customer.OwnerUserID = req.OwnerUserID
		if err := tx.Save(&customer).Error; err != nil {
			tx.Rollback()
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to update organization", err.Error())
			return
		}

		newOwnerID := *req.OwnerUserID

		// 2. Upsert new owner into platform_org_members with role='owner'
		var newOwnerMember tables.TablePlatformOrgMember
		if err := tx.Where("org_id = ? AND user_id = ?", orgID, newOwnerID).FirstOrInit(&newOwnerMember).Error; err != nil {
			tx.Rollback()
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to lookup org member", err.Error())
			return
		}
		newOwnerMember.OrgID = orgID
		newOwnerMember.UserID = newOwnerID
		newOwnerMember.Role = model.OrgRoleOwner
		newOwnerMember.JoinedAt = time.Now()
		if err := tx.Save(&newOwnerMember).Error; err != nil {
			tx.Rollback()
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to add new owner to org members", err.Error())
			return
		}

		// 3. Remove old owner from platform_org_members (if existed and different from new)
		if customer.OwnerUserID != nil && *customer.OwnerUserID != newOwnerID {
			if err := tx.Where("org_id = ? AND user_id = ?", orgID, *customer.OwnerUserID).Delete(&tables.TablePlatformOrgMember{}).Error; err != nil {
				tx.Rollback()
				SendError(ctx, fasthttp.StatusInternalServerError, "Failed to remove old owner from org members", err.Error())
				return
			}
		}

		if err := tx.Commit().Error; err != nil {
			tx.Rollback()
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to commit transaction", err.Error())
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
		return
	}

	// No owner change — simple update (original logic)
	customer.Name = req.Name
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

// deleteOrg handles DELETE /api/platform/admin/orgs/{orgId} — delete an organization.
func (h *PlatformAdminHandler) deleteOrg(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	if orgID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Organization ID is required", "")
		return
	}

	tx := h.db.Begin()
	if tx.Error != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to start transaction", tx.Error.Error())
		return
	}

	// Remove org memberships
	if err := tx.Where("org_id = ?", orgID).Delete(&tables.TablePlatformOrgMember{}).Error; err != nil {
		tx.Rollback()
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to delete organization memberships", err.Error())
		return
	}

	// Delete the customer
	if err := tx.Where("id = ?", orgID).Delete(&configstoreTables.TableCustomer{}).Error; err != nil {
		tx.Rollback()
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to delete organization", err.Error())
		return
	}

	if err := tx.Commit().Error; err != nil {
		log.Printf("ERROR: failed to commit transaction in deleteOrg: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to delete organization", err.Error())
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "",
		"message": "Organization deleted successfully",
	})
}

// listUsers handles GET /api/platform/admin/users — list all users with platform info.
func (h *PlatformAdminHandler) listUsers(ctx *fasthttp.RequestCtx) {
	if h.consumerAuth == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "500", "Auth service not configured")
		return
	}

	offset, _ := strconv.ParseUint(string(ctx.QueryArgs().Peek("offset")), 10, 64)
	limit, _ := strconv.ParseUint(string(ctx.QueryArgs().Peek("limit")), 10, 64)
	if limit == 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	search := string(ctx.QueryArgs().Peek("search"))

	users, total, err := h.consumerAuth.ListUsers(context.Background(), int(offset), int(limit), search)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("%d", fasthttp.StatusInternalServerError), fmt.Sprintf("Failed to list users: %s", err.Error()))
		return
	}

	// Collect user IDs for batch queries
	userIDs := make([]string, len(users))
	for i, u := range users {
		userIDs[i] = u.ID
	}

	// Batch load platform_admins
	adminSet := make(map[string]bool, len(userIDs))
	if len(userIDs) > 0 {
		var admins []tables.TablePlatformAdmin
		h.db.Where("user_id IN ?", userIDs).Find(&admins)
		for _, a := range admins {
			adminSet[a.UserID] = true
		}
	}

	// Batch load platform_org_members
	orgMemberMap := make(map[string][]map[string]any)
	if len(userIDs) > 0 {
		var orgMembers []tables.TablePlatformOrgMember
		h.db.Where("user_id IN ?", userIDs).Find(&orgMembers)
		for _, m := range orgMembers {
			orgMemberMap[m.UserID] = append(orgMemberMap[m.UserID], map[string]any{
				"org_id": m.OrgID,
				"role":   m.Role,
			})
		}
	}

	// Batch load platform_team_members
	teamMemberMap := make(map[string][]map[string]any)
	if len(userIDs) > 0 {
		var teamMembers []tables.TablePlatformTeamMember
		h.db.Where("user_id IN ?", userIDs).Find(&teamMembers)
		for _, m := range teamMembers {
			teamMemberMap[m.UserID] = append(teamMemberMap[m.UserID], map[string]any{
				"team_id": m.TeamID,
				"role":    m.Role,
			})
		}
	}

	// Build response items with platform info
	items := make([]map[string]any, len(users))
	for i, u := range users {
		isAdmin := adminSet[u.ID]
		orgs := orgMemberMap[u.ID]
		teams := teamMemberMap[u.ID]

		// Derive display role: admin > org_admin > team_admin > team_member > user
		role := "user"
		if isAdmin {
			role = model.RoleAdmin
		} else {
			for _, o := range orgs {
				if r, ok := o["role"].(string); ok && model.IsOrgAdminRole(r) {
					role = model.ResolvedRoleOrgAdmin
					break
				}
			}
			if role == "user" {
				for _, t := range teams {
					if r, ok := t["role"].(string); ok && model.IsTeamAdminRole(r) {
						role = model.ResolvedRoleTeamAdmin
						break
					}
				}
			}
			if role == "user" && (len(orgs) > 0 || len(teams) > 0) {
				role = model.ResolvedRoleTeamMember
			}
		}

		if orgs == nil {
			orgs = []map[string]any{}
		}
		if teams == nil {
			teams = []map[string]any{}
		}

		items[i] = map[string]any{
			"id":           u.ID,
			"email":        u.Email,
			"display_name": u.DisplayName,
			"phone":        u.Phone,
			"status":       u.Status,
			"is_admin":     isAdmin,
			"role":         role,
			"orgs":         orgs,
			"teams":        teams,
			"created_at":   u.CreatedAt,
			"updated_at":   u.UpdatedAt,
		}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"items": items,
			"total": total,
		},
	})
}

// updateUserStatus handles PUT /api/platform/admin/users/{userId}/status — update user status.
func (h *PlatformAdminHandler) updateUserStatus(ctx *fasthttp.RequestCtx) {
	userID, _ := ctx.UserValue("userId").(string)
	if userID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "User ID is required")
		return
	}

	var req struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format", err.Error())
		return
	}

	// Validate status — only allow active, suspended, pending_verification
	validStatuses := map[string]bool{
		"active":               true,
		"suspended":            true,
		"pending_verification": true,
	}
	if !validStatuses[req.Status] {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid status", "Allowed values: active, suspended, pending_verification")
		return
	}

	// Check user exists
	var count int64
	h.db.Table("auth_users").Where("id = ? AND deleted_at IS NULL", userID).Count(&count)
	if count == 0 {
		SendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "User not found")
		return
	}

	now := time.Now()
	if err := h.db.Table("auth_users").Where("id = ?", userID).Updates(map[string]any{
		"status":     req.Status,
		"updated_at": now,
	}).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to update user status", err.Error())
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"id":         userID,
			"status":     req.Status,
			"updated_at": now,
		},
	})
}

// updateUserAdmin handles PUT /api/platform/admin/users/{userId}/admin — set or remove admin status.
func (h *PlatformAdminHandler) updateUserAdmin(ctx *fasthttp.RequestCtx) {
	userID, _ := ctx.UserValue("userId").(string)
	if userID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "User ID is required")
		return
	}

	var req struct {
		IsAdmin bool `json:"is_admin"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format", err.Error())
		return
	}

	// Safety: prevent admin from removing their own admin status
	claims := GetPlatformClaimsFromContext(ctx)
	if claims != nil && claims.UserID == userID && !req.IsAdmin {
		SendError(ctx, fasthttp.StatusBadRequest, "CANNOT_REMOVE_SELF", "Cannot remove your own admin status")
		return
	}

	// Check user exists
	var user struct {
		ID    string `gorm:"column:id"`
		Email string `gorm:"column:email"`
	}
	if err := h.db.Table("auth_users").Select("id, email").Where("id = ? AND deleted_at IS NULL", userID).First(&user).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "User not found")
		return
	}

	now := time.Now()
	if req.IsAdmin {
		// INSERT IGNORE — idempotent if already admin
		admin := tables.TablePlatformAdmin{
			UserID:    userID,
			Email:     user.Email,
			CreatedAt: now,
		}
		if err := h.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&admin).Error; err != nil {
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to set admin", err.Error())
			return
		}
	} else {
		if err := h.db.Where("user_id = ?", userID).Delete(&tables.TablePlatformAdmin{}).Error; err != nil {
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to remove admin", err.Error())
			return
		}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"id":       userID,
			"is_admin": req.IsAdmin,
		},
	})
}
