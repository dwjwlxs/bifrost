package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// PlatformVKHandler handles platform virtual key CRUD operations.
type PlatformVKHandler struct {
	db          *gorm.DB
	configStore configstore.ConfigStore // unused but kept for future extensibility
}

// NewPlatformVKHandler creates a new PlatformVKHandler.
func NewPlatformVKHandler(config *lib.Config) *PlatformVKHandler {
	return &PlatformVKHandler{
		db:          config.ConfigStore.DB(),
		configStore: config.ConfigStore,
	}
}

// RegisterRoutes registers all platform virtual key routes.
func (h *PlatformVKHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	// User VK routes (filtered by authenticated user's user_id)
	// Registered directly on the router (not via group) to avoid trailing-slash issues.
	r.GET("/api/platform/virtual-keys", lib.ChainMiddlewares(h.listMyVKs, middlewares...))
	r.POST("/api/platform/virtual-keys", lib.ChainMiddlewares(h.createVK, middlewares...))
	r.GET("/api/platform/virtual-keys/{vkId}", lib.ChainMiddlewares(h.getVK, middlewares...))
	r.PUT("/api/platform/virtual-keys/{vkId}", lib.ChainMiddlewares(h.updateVK, middlewares...))
	r.DELETE("/api/platform/virtual-keys/{vkId}", lib.ChainMiddlewares(h.deleteVK, middlewares...))

	// Team VK routes — my keys (RequireTeamMember: member sees own keys, admin sees all)
	teamMemberMw := make([]schemas.BifrostHTTPMiddleware, len(middlewares), len(middlewares)+1)
	copy(teamMemberMw, middlewares)
	teamMemberMw = append(teamMemberMw, RequireTeamMember)
	r.GET("/api/platform/teams/{teamId}/my-virtual-keys", lib.ChainMiddlewares(h.listTeamMyVKs, teamMemberMw...))

	// Team VK routes — all keys (RequireTeamAdmin)
	teamAdminMw := make([]schemas.BifrostHTTPMiddleware, len(middlewares), len(middlewares)+1)
	copy(teamAdminMw, middlewares)
	teamAdminMw = append(teamAdminMw, RequireTeamAdmin(h.db))
	r.GET("/api/platform/teams/{teamId}/virtual-keys", lib.ChainMiddlewares(h.listTeamVKs, teamAdminMw...))
	r.PUT("/api/platform/teams/{teamId}/virtual-keys/{vkId}", lib.ChainMiddlewares(h.updateTeamVK, teamAdminMw...))
}

// listMyVKs handles GET /api/platform/virtual-keys — list virtual keys owned by the authenticated user.
func (h *PlatformVKHandler) listMyVKs(ctx *fasthttp.RequestCtx) {
	userID := GetPlatformUserIDFromContext(ctx)
	if userID == "" {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "user_id is required")
		return
	}

	offset, _ := strconv.ParseUint(string(ctx.QueryArgs().Peek("offset")), 10, 64)
	limit, _ := strconv.ParseUint(string(ctx.QueryArgs().Peek("limit")), 10, 64)
	if limit == 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	var total int64
	h.db.Model(&tables.TableVirtualKey{}).Where("user_id = ?", userID).Count(&total)

	var vks []tables.TableVirtualKey
	if err := h.db.Where("user_id = ?", userID).
		Order("created_at DESC").
		Offset(int(offset)).
		Limit(int(limit)).
		Preload("Budgets").
		Find(&vks).Error; err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to list virtual keys", err.Error())
		return
	}

	items := make([]map[string]any, len(vks))
	for i, vk := range vks {
		items[i] = marshalVK(&vk)
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"items": items,
			"total": total,
		},
	})
}

// createVKRequest represents the POST /api/platform/virtual-keys request body.
type createVKRequest struct {
	Name                string   `json:"name"`
	Description         string   `json:"description"`
	UserID              *string  `json:"user_id,omitempty"`               // optional: specify VK owner (team_admin only)
	TeamID              *string  `json:"team_id,omitempty"`               // optional: team association
	BudgetLimit         *float64 `json:"budget_limit,omitempty"`          // optional: max budget in dollars
	BudgetResetDuration *string  `json:"budget_reset_duration,omitempty"` // optional: e.g. "1d", "1w", "1M"
}

// createVK handles POST /api/platform/virtual-keys — create a virtual key.
func (h *PlatformVKHandler) createVK(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "user_id is required")
		return
	}

	var req createVKRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}

	if req.Name == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Virtual key name is required")
		return
	}

	// Determine the VK owner:
	// - If user_id is not specified, the VK belongs to the authenticated user.
	// - If user_id is specified and matches the authenticated user, use the authenticated user.
	// - If user_id is specified and differs from the authenticated user, require team admin or org admin.
	vkOwnerID := claims.UserID
	if req.UserID != nil && *req.UserID != "" {
		if *req.UserID != claims.UserID {
			// Cross-user VK creation: require team admin of the target team (if team_id provided)
			// or org admin of the target org (if team belongs to an org).
			if req.TeamID != nil && *req.TeamID != "" {
				if !claims.IsTeamAdmin(*req.TeamID) {
					sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Team admin access required to create VK for another user")
					return
				}
			} else {
				// No team_id specified — require the user to be system admin.
				if !claims.IsAdmin {
					sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Admin access required to create VK for another user without a team")
					return
				}
			}
		}
		vkOwnerID = *req.UserID
	}

	vkID := schemas.NewID()
	vkValue := generatePlatformVKValue()

	vk := tables.TableVirtualKey{
		ID:          vkID,
		Name:        req.Name,
		Description: req.Description,
		Value:       vkValue,
		IsActive:    true,
		UserID:      &vkOwnerID,
		TeamID:      req.TeamID,
	}

	// Use transaction to ensure atomicity of VK and budget creation
	err := h.db.Transaction(func(tx *gorm.DB) error {
		// Create VK
		if err := tx.Create(&vk).Error; err != nil {
			return err
		}

		// Create budget record if budget_limit is specified.
		if req.BudgetLimit != nil {
			budgetID := schemas.NewID()
			resetDuration := "1M" // default monthly reset
			if req.BudgetResetDuration != nil && *req.BudgetResetDuration != "" {
				resetDuration = *req.BudgetResetDuration
			}
			// Validate reset duration format
			if _, err := tables.ParseDuration(resetDuration); err != nil {
				return fmt.Errorf("invalid budget_reset_duration format: %w", err)
			}
			budget := tables.TableBudget{
				ID:              budgetID,
				MaxLimit:        *req.BudgetLimit,
				ResetDuration:   resetDuration,
				LastReset:       time.Now(),
				VirtualKeyID:    &vkID,
				CalendarAligned: false, // Default to false
			}
			if err := tx.Create(&budget).Error; err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		// Check if error is a validation error
		if strings.Contains(err.Error(), "invalid budget_reset_duration format") {
			sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
		} else {
			sendError(ctx, fasthttp.StatusInternalServerError, "Failed to create virtual key", err.Error())
		}
		return
	}

	// Reload VK with budgets.
	h.db.Preload("Budgets").First(&vk, "id = ?", vkID)

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalVK(&vk),
	})
}

// getVK handles GET /api/platform/virtual-keys/{vkId} — get a specific virtual key owned by the user.
func (h *PlatformVKHandler) getVK(ctx *fasthttp.RequestCtx) {
	userID := GetPlatformUserIDFromContext(ctx)
	if userID == "" {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "user_id is required")
		return
	}

	vkID, _ := ctx.UserValue("vkId").(string)
	if vkID == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Virtual key ID is required")
		return
	}

	var vk tables.TableVirtualKey
	if err := h.db.Preload("Budgets").Where("id = ? AND user_id = ?", vkID, userID).First(&vk).Error; err != nil {
		sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Virtual key not found")
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalVK(&vk),
	})
}

// updateVKRequest represents the PUT /api/platform/virtual-keys/{vkId} request body.
type updateVKRequest struct {
	Name                *string          `json:"name"`
	Description         *string          `json:"description"`
	IsActive            *bool            `json:"is_active"`
	ProviderConfigs     *json.RawMessage `json:"provider_configs"`
	BudgetLimit         *float64         `json:"budget_limit,omitempty"`
	BudgetResetDuration *string          `json:"budget_reset_duration,omitempty"`
}

// updateVK handles PUT /api/platform/virtual-keys/{vkId} — update a virtual key owned by the user.
func (h *PlatformVKHandler) updateVK(ctx *fasthttp.RequestCtx) {
	userID := GetPlatformUserIDFromContext(ctx)
	if userID == "" {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "user_id is required")
		return
	}

	vkID, _ := ctx.UserValue("vkId").(string)
	if vkID == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Virtual key ID is required")
		return
	}

	var req updateVKRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}

	var vk tables.TableVirtualKey
	if err := h.db.Where("id = ? AND user_id = ?", vkID, userID).First(&vk).Error; err != nil {
		sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Virtual key not found")
		return
	}

	if req.Name != nil {
		vk.Name = *req.Name
	}
	if req.Description != nil {
		vk.Description = *req.Description
	}
	if req.IsActive != nil {
		vk.IsActive = *req.IsActive
	}
	if req.ProviderConfigs != nil {
		var configs []tables.TableVirtualKeyProviderConfig
		if err := json.Unmarshal(*req.ProviderConfigs, &configs); err == nil {
			vk.ProviderConfigs = configs
		}
	}

	if err := h.db.Save(&vk).Error; err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to update virtual key", err.Error())
		return
	}

	// Upsert budget record.
	if req.BudgetLimit != nil {
		resetDuration := ptrStr(req.BudgetResetDuration, "1M")
		// Validate reset duration format
		if _, err := tables.ParseDuration(resetDuration); err != nil {
			sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", fmt.Sprintf("Invalid budget_reset_duration format: %s", err.Error()))
			return
		}
		if err := h.upsertVKBudget(vkID, *req.BudgetLimit, resetDuration); err != nil {
			sendError(ctx, fasthttp.StatusInternalServerError, "Failed to update budget", err.Error())
			return
		}
	}

	// Reload VK with budgets.
	h.db.Preload("Budgets").First(&vk, "id = ?", vkID)

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalVK(&vk),
	})
}

// deleteVK handles DELETE /api/platform/virtual-keys/{vkId} — delete a virtual key owned by the user.
func (h *PlatformVKHandler) deleteVK(ctx *fasthttp.RequestCtx) {
	userID := GetPlatformUserIDFromContext(ctx)
	if userID == "" {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "user_id is required")
		return
	}

	vkID, _ := ctx.UserValue("vkId").(string)
	if vkID == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Virtual key ID is required")
		return
	}

	result := h.db.Where("id = ? AND user_id = ?", vkID, userID).Delete(&tables.TableVirtualKey{})
	if result.Error != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to delete virtual key", result.Error.Error())
		return
	}
	if result.RowsAffected == 0 {
		sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Virtual key not found")
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "deleted",
	})
}

// listTeamVKs handles GET /api/platform/teams/{teamId}/virtual-keys — list virtual keys for a team.
func (h *PlatformVKHandler) listTeamVKs(ctx *fasthttp.RequestCtx) {
	teamID, _ := ctx.UserValue("teamId").(string)
	if teamID == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID is required")
		return
	}

	offset, _ := strconv.ParseUint(string(ctx.QueryArgs().Peek("offset")), 10, 64)
	limit, _ := strconv.ParseUint(string(ctx.QueryArgs().Peek("limit")), 10, 64)
	if limit == 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	var total int64
	h.db.Model(&tables.TableVirtualKey{}).Where("team_id = ?", teamID).Count(&total)

	var vks []tables.TableVirtualKey
	if err := h.db.Where("team_id = ?", teamID).
		Order("created_at DESC").
		Offset(int(offset)).
		Limit(int(limit)).
		Preload("Budgets").
		Find(&vks).Error; err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to list team virtual keys", err.Error())
		return
	}

	items := make([]map[string]any, len(vks))
	for i, vk := range vks {
		items[i] = marshalVK(&vk)
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"items": items,
			"total": total,
		},
	})
}

// listTeamMyVKs handles GET /api/platform/teams/{teamId}/my-virtual-keys —
// list virtual keys belonging to the authenticated user within a team.
func (h *PlatformVKHandler) listTeamMyVKs(ctx *fasthttp.RequestCtx) {
	userID := GetPlatformUserIDFromContext(ctx)
	if userID == "" {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "user_id is required")
		return
	}

	teamID, _ := ctx.UserValue("teamId").(string)
	if teamID == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID is required")
		return
	}

	offset, _ := strconv.ParseUint(string(ctx.QueryArgs().Peek("offset")), 10, 64)
	limit, _ := strconv.ParseUint(string(ctx.QueryArgs().Peek("limit")), 10, 64)
	if limit == 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	var total int64
	h.db.Model(&tables.TableVirtualKey{}).Where("team_id = ? AND user_id = ?", teamID, userID).Count(&total)

	var vks []tables.TableVirtualKey
	if err := h.db.Where("team_id = ? AND user_id = ?", teamID, userID).
		Order("created_at DESC").
		Offset(int(offset)).
		Limit(int(limit)).
		Preload("Budgets").
		Find(&vks).Error; err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to list my virtual keys", err.Error())
		return
	}

	items := make([]map[string]any, len(vks))
	for i, vk := range vks {
		items[i] = marshalVK(&vk)
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"items": items,
			"total": total,
		},
	})
}

// updateTeamVKRequest represents the PUT /api/platform/teams/{teamId}/virtual-keys/{vkId} request body.
type updateTeamVKRequest struct {
	Name                *string  `json:"name"`
	Description         *string  `json:"description"`
	IsActive            *bool    `json:"is_active"`
	BudgetLimit         *float64 `json:"budget_limit,omitempty"`
	BudgetResetDuration *string  `json:"budget_reset_duration,omitempty"`
}

// updateTeamVK handles PUT /api/platform/teams/{teamId}/virtual-keys/{vkId} — update a team virtual key.
func (h *PlatformVKHandler) updateTeamVK(ctx *fasthttp.RequestCtx) {
	teamID, _ := ctx.UserValue("teamId").(string)
	vkID, _ := ctx.UserValue("vkId").(string)
	if teamID == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Team ID is required")
		return
	}
	if vkID == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Virtual key ID is required")
		return
	}

	var req updateTeamVKRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}

	var vk tables.TableVirtualKey
	if err := h.db.Where("id = ? AND team_id = ?", vkID, teamID).First(&vk).Error; err != nil {
		sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Virtual key not found in this team")
		return
	}

	if req.Name != nil {
		vk.Name = *req.Name
	}
	if req.Description != nil {
		vk.Description = *req.Description
	}
	if req.IsActive != nil {
		vk.IsActive = *req.IsActive
	}

	if err := h.db.Save(&vk).Error; err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "Failed to update virtual key", err.Error())
		return
	}

	// Upsert budget record.
	if req.BudgetLimit != nil {
		resetDuration := ptrStr(req.BudgetResetDuration, "1M")
		// Validate reset duration format
		if _, err := tables.ParseDuration(resetDuration); err != nil {
			sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", fmt.Sprintf("Invalid budget_reset_duration format: %s", err.Error()))
			return
		}
		if err := h.upsertVKBudget(vkID, *req.BudgetLimit, resetDuration); err != nil {
			sendError(ctx, fasthttp.StatusInternalServerError, "Failed to update budget", err.Error())
			return
		}
	}

	// Reload VK with budgets.
	h.db.Preload("Budgets").First(&vk, "id = ?", vkID)

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalVK(&vk),
	})
}

// upsertVKBudget creates or replaces the first budget record for a VK.
func (h *PlatformVKHandler) upsertVKBudget(vkID string, budgetLimit float64, resetDuration string) error {
	// Delete existing budgets for this VK.
	if err := h.db.Where("virtual_key_id = ?", vkID).Delete(&tables.TableBudget{}).Error; err != nil {
		return err
	}
	// Create new budget.
	budgetID := schemas.NewID()
	budget := tables.TableBudget{
		ID:              budgetID,
		MaxLimit:        budgetLimit,
		ResetDuration:   resetDuration,
		LastReset:       time.Now(),
		VirtualKeyID:    &vkID,
		CalendarAligned: false, // Default to false
	}
	return h.db.Create(&budget).Error
}

// ptrStr returns the string value if non-nil, otherwise returns the default.
func ptrStr(s *string, defaultVal string) string {
	if s != nil && *s != "" {
		return *s
	}
	return defaultVal
}

// generatePlatformVKValue generates a virtual key value with "sk-bf-" prefix followed by a random hex string.
func generatePlatformVKValue() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("failed to generate random bytes: " + err.Error())
	}
	return "sk-bf-" + hex.EncodeToString(b)
}

// marshalVK converts a TableVirtualKey to a JSON-friendly map.
func marshalVK(vk *tables.TableVirtualKey) map[string]any {
	item := map[string]any{
		"id":          vk.ID,
		"name":        vk.Name,
		"value":       vk.Value,
		"description": vk.Description,
		"is_active":   vk.IsActive,
		"user_id":     vk.UserID,
		"team_id":     vk.TeamID,
		"created_at":  vk.CreatedAt,
		"updated_at":  vk.UpdatedAt,
	}
	if vk.CustomerID != nil {
		item["customer_id"] = vk.CustomerID
	}
	// Flatten first budget record for convenience.
	if len(vk.Budgets) > 0 {
		b := vk.Budgets[0]
		item["budget_limit"] = b.MaxLimit
		item["budget_reset_duration"] = b.ResetDuration
		item["current_usage"] = b.CurrentUsage
	}
	return item
}
