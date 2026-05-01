package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strconv"

	"github.com/fasthttp/router"
	"github.com/google/uuid"
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
	configStore configstore.ConfigStore
}

// NewPlatformVKHandler creates a new PlatformVKHandler.
func NewPlatformVKHandler(db *gorm.DB, configStore configstore.ConfigStore) *PlatformVKHandler {
	return &PlatformVKHandler{
		db:          db,
		configStore: configStore,
	}
}

// RegisterRoutes registers all platform virtual key routes.
func (h *PlatformVKHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	// User VK routes (filtered by authenticated user's user_id)
	vkGroup := r.Group("/api/platform/virtual-keys")
	vkGroup.GET("/", lib.ChainMiddlewares(h.listMyVKs, middlewares...))
	vkGroup.POST("/", lib.ChainMiddlewares(h.createVK, middlewares...))
	vkGroup.GET("/{vkId}", lib.ChainMiddlewares(h.getVK, middlewares...))
	vkGroup.PUT("/{vkId}", lib.ChainMiddlewares(h.updateVK, middlewares...))
	vkGroup.DELETE("/{vkId}", lib.ChainMiddlewares(h.deleteVK, middlewares...))

	// Team VK routes (RequireTeamAdmin)
	teamAdminMw := append([]schemas.BifrostHTTPMiddleware{RequireTeamAdmin(h.db)}, middlewares...)
	r.GET("/api/platform/teams/{teamId}/virtual-keys", lib.ChainMiddlewares(h.listTeamVKs, teamAdminMw...))
	r.PUT("/api/platform/teams/{teamId}/virtual-keys/{vkId}", lib.ChainMiddlewares(h.updateTeamVK, teamAdminMw...))
}

// listMyVKs handles GET /api/platform/virtual-keys — list virtual keys owned by the authenticated user.
func (h *PlatformVKHandler) listMyVKs(ctx *fasthttp.RequestCtx) {
	userID := GetPlatformUserIDFromContext(ctx)
	if userID == "" {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
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
		Find(&vks).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list virtual keys")
		return
	}

	items := make([]map[string]any, len(vks))
	for i, vk := range vks {
		items[i] = marshalVK(&vk)
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

// createVK handles POST /api/platform/virtual-keys — create a virtual key for the authenticated user.
func (h *PlatformVKHandler) createVK(ctx *fasthttp.RequestCtx) {
	userID := GetPlatformUserIDFromContext(ctx)
	if userID == "" {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
		return
	}

	var req struct {
		Name        string  `json:"name"`
		Description string  `json:"description"`
		TeamID      *string `json:"team_id,omitempty"`
	}

	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format")
		return
	}

	if req.Name == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Virtual key name is required")
		return
	}

	vkID := uuid.NewString()
	vkValue := generatePlatformVKValue()

	vk := tables.TableVirtualKey{
		ID:          vkID,
		Name:        req.Name,
		Description: req.Description,
		Value:       vkValue,
		IsActive:    true,
		UserID:      &userID,
		TeamID:      req.TeamID,
	}

	if err := h.db.Create(&vk).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to create virtual key")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalVK(&vk),
	})
}

// getVK handles GET /api/platform/virtual-keys/{vkId} — get a specific virtual key owned by the user.
func (h *PlatformVKHandler) getVK(ctx *fasthttp.RequestCtx) {
	userID := GetPlatformUserIDFromContext(ctx)
	if userID == "" {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
		return
	}

	vkID, _ := ctx.UserValue("vkId").(string)
	if vkID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Virtual key ID is required")
		return
	}

	var vk tables.TableVirtualKey
	if err := h.db.Where("id = ? AND user_id = ?", vkID, userID).First(&vk).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "Virtual key not found")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalVK(&vk),
	})
}

// updateVK handles PUT /api/platform/virtual-keys/{vkId} — update a virtual key owned by the user.
func (h *PlatformVKHandler) updateVK(ctx *fasthttp.RequestCtx) {
	userID := GetPlatformUserIDFromContext(ctx)
	if userID == "" {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
		return
	}

	vkID, _ := ctx.UserValue("vkId").(string)
	if vkID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Virtual key ID is required")
		return
	}

	var req struct {
		Name            *string          `json:"name"`
		Description     *string          `json:"description"`
		IsActive        *bool            `json:"is_active"`
		ProviderConfigs *json.RawMessage `json:"provider_configs"`
	}

	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format")
		return
	}

	var vk tables.TableVirtualKey
	if err := h.db.Where("id = ? AND user_id = ?", vkID, userID).First(&vk).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "Virtual key not found")
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
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to update virtual key")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalVK(&vk),
	})
}

// deleteVK handles DELETE /api/platform/virtual-keys/{vkId} — delete a virtual key owned by the user.
func (h *PlatformVKHandler) deleteVK(ctx *fasthttp.RequestCtx) {
	userID := GetPlatformUserIDFromContext(ctx)
	if userID == "" {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
		return
	}

	vkID, _ := ctx.UserValue("vkId").(string)
	if vkID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Virtual key ID is required")
		return
	}

	result := h.db.Where("id = ? AND user_id = ?", vkID, userID).Delete(&tables.TableVirtualKey{})
	if result.Error != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to delete virtual key")
		return
	}
	if result.RowsAffected == 0 {
		SendError(ctx, fasthttp.StatusNotFound, "Virtual key not found")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "deleted",
	})
}

// listTeamVKs handles GET /api/platform/teams/{teamId}/virtual-keys — list virtual keys for a team.
func (h *PlatformVKHandler) listTeamVKs(ctx *fasthttp.RequestCtx) {
	teamID, _ := ctx.UserValue("teamId").(string)
	if teamID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Team ID is required")
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
		Find(&vks).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list team virtual keys")
		return
	}

	items := make([]map[string]any, len(vks))
	for i, vk := range vks {
		items[i] = marshalVK(&vk)
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

// updateTeamVK handles PUT /api/platform/teams/{teamId}/virtual-keys/{vkId} — update a team virtual key.
func (h *PlatformVKHandler) updateTeamVK(ctx *fasthttp.RequestCtx) {
	teamID, _ := ctx.UserValue("teamId").(string)
	vkID, _ := ctx.UserValue("vkId").(string)
	if teamID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Team ID is required")
		return
	}
	if vkID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Virtual key ID is required")
		return
	}

	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		IsActive    *bool   `json:"is_active"`
	}

	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request format")
		return
	}

	var vk tables.TableVirtualKey
	if err := h.db.Where("id = ? AND team_id = ?", vkID, teamID).First(&vk).Error; err != nil {
		SendError(ctx, fasthttp.StatusNotFound, "Virtual key not found in this team")
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
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to update virtual key")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalVK(&vk),
	})
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
	return item
}
