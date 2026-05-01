package handlers

import (
	"encoding/json"
	"strconv"
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

// PlatformAdminHandler handles system admin API operations.
type PlatformAdminHandler struct {
	db          *gorm.DB
	configStore configstore.ConfigStore
}

// NewPlatformAdminHandler creates a new PlatformAdminHandler.
func NewPlatformAdminHandler(db *gorm.DB, configStore configstore.ConfigStore) *PlatformAdminHandler {
	return &PlatformAdminHandler{
		db:          db,
		configStore: configStore,
	}
}

// RegisterRoutes registers all platform admin routes.
func (h *PlatformAdminHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	group := r.Group("/api/platform/admin")
	adminMw := append([]schemas.BifrostHTTPMiddleware{RequireAdmin}, middlewares...)

	group.GET("/orgs", lib.ChainMiddlewares(h.listOrgs, adminMw...))
	group.POST("/orgs", lib.ChainMiddlewares(h.createOrg, adminMw...))
	group.GET("/orgs/{orgId}", lib.ChainMiddlewares(h.getOrg, adminMw...))
	group.PUT("/orgs/{orgId}", lib.ChainMiddlewares(h.updateOrg, adminMw...))
	group.DELETE("/orgs/{orgId}", lib.ChainMiddlewares(h.deleteOrg, adminMw...))
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
	h.db.Model(&tables.TableCustomer{}).Count(&total)

	var customers []tables.TableCustomer
	if err := h.db.Order("created_at DESC").Offset(int(offset)).Limit(int(limit)).Find(&customers).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list organizations")
		return
	}

	items := make([]map[string]any, len(customers))
	for i, c := range customers {
		items[i] = map[string]any{
			"id":         c.ID,
			"name":       c.Name,
			"budget_id":  c.BudgetID,
			"created_at": c.CreatedAt,
			"updated_at": c.UpdatedAt,
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
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format")
		return
	}

	if req.Name == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Organization name is required")
		return
	}

	orgID := uuid.NewString()
	now := time.Now()
	customer := tables.TableCustomer{
		ID:        orgID,
		Name:      req.Name,
		CreatedAt: now,
		UpdatedAt: now,
	}

	tx := h.db.Begin()
	if tx.Error != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to start transaction")
		return
	}

	if err := tx.Create(&customer).Error; err != nil {
		tx.Rollback()
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to create organization")
		return
	}

	// Optionally assign an admin user to this org
	if req.AdminUserID != nil && *req.AdminUserID != "" {
		orgMember := tables.TablePlatformOrgMember{
			OrgID:    orgID,
			UserID:   *req.AdminUserID,
			Role:     "admin",
			JoinedAt: now,
		}
		if err := tx.Create(&orgMember).Error; err != nil {
			tx.Rollback()
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to assign org admin")
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		log.Printf("ERROR: failed to commit transaction in createOrg: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to create organization")
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
		SendError(ctx, fasthttp.StatusBadRequest, "Organization ID is required")
		return
	}

	var customer tables.TableCustomer
	if err := h.db.Where("id = ?", orgID).First(&customer).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "Organization not found")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"id":         customer.ID,
			"name":       customer.Name,
			"budget_id":  customer.BudgetID,
			"created_at": customer.CreatedAt,
			"updated_at": customer.UpdatedAt,
		},
	})
}

// updateOrg handles PUT /api/platform/admin/orgs/{orgId} — update organization details.
func (h *PlatformAdminHandler) updateOrg(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	if orgID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Organization ID is required")
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format")
		return
	}

	if req.Name == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Organization name is required")
		return
	}

	var customer tables.TableCustomer
	if err := h.db.Where("id = ?", orgID).First(&customer).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "Organization not found")
		return
	}

	customer.Name = req.Name
	if err := h.db.Save(&customer).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to update organization")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"id":         customer.ID,
			"name":       customer.Name,
			"updated_at": customer.UpdatedAt,
		},
	})
}

// deleteOrg handles DELETE /api/platform/admin/orgs/{orgId} — delete an organization.
func (h *PlatformAdminHandler) deleteOrg(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	if orgID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Organization ID is required")
		return
	}

	tx := h.db.Begin()
	if tx.Error != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to start transaction")
		return
	}

	// Remove org memberships
	if err := tx.Where("org_id = ?", orgID).Delete(&tables.TablePlatformOrgMember{}).Error; err != nil {
		tx.Rollback()
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to delete organization memberships")
		return
	}

	// Delete the customer
	if err := tx.Where("id = ?", orgID).Delete(&tables.TableCustomer{}).Error; err != nil {
		tx.Rollback()
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to delete organization")
		return
	}

	if err := tx.Commit().Error; err != nil {
		log.Printf("ERROR: failed to commit transaction in deleteOrg: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to delete organization")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "Organization deleted successfully",
	})
}
