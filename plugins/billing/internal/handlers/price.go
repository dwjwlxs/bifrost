package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/bytedance/sonic"
	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/modelcatalog"
	bconfig "github.com/maximhq/bifrost/plugins/billing/internal/config"
	"github.com/maximhq/bifrost/plugins/billing/pkg/fhttp"
	"github.com/maximhq/bifrost/transports/bifrost-http/handlers"
	"github.com/valyala/fasthttp"
)

// PlatformPriceHandler handles billing pricing override endpoints.
// It implements CRUD for pricing overrides stored in the DB.
// Note: unlike the governance handler, this does NOT sync overrides to the
// in-memory pricing catalog — billing does not need runtime pricing decisions.
type PlatformPriceHandler struct {
	configStore configstore.ConfigStore
}

// NewPlatformPriceHandler creates a new PlatformPriceHandler.
func NewPlatformPriceHandler(config *bconfig.BillingPluginConfig) *PlatformPriceHandler {
	return &PlatformPriceHandler{
		configStore: config.Config.ConfigStore,
	}
}

// RegisterRoutes registers all pricing override routes.
func (h *PlatformPriceHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	adminMw := make([]schemas.BifrostHTTPMiddleware, len(middlewares), len(middlewares)+1)
	copy(adminMw, middlewares)
	adminMw = append(adminMw, RequireAdmin)

	r.GET("/api/billing/admin/model-prices", fhttp.ChainMiddlewares(h.getPricingOverrides, adminMw...))
	r.POST("/api/billing/admin/model-prices", fhttp.ChainMiddlewares(h.createPricingOverride, adminMw...))
	r.PUT("/api/billing/admin/model-prices/{id}", fhttp.ChainMiddlewares(h.updatePricingOverride, adminMw...))
	r.DELETE("/api/billing/admin/model-prices/{id}", fhttp.ChainMiddlewares(h.deletePricingOverride, adminMw...))
}

// ---- Pricing override request types ----

// nullableString tracks whether a JSON string field was explicitly present in
// the request body (even as null), so the merge logic can distinguish "omitted"
// (leave existing value) from "set to null" (clear the value).
type nullableString struct {
	Value *string
	Set   bool
}

func (n *nullableString) UnmarshalJSON(b []byte) error {
	n.Set = true
	if string(b) == "null" {
		n.Value = nil
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	n.Value = &s
	return nil
}

type createPricingOverrideRequest struct {
	Name          string                      `json:"name"`
	ScopeKind     modelcatalog.ScopeKind      `json:"scope_kind"`
	VirtualKeyID  *string                     `json:"virtual_key_id,omitempty"`
	ProviderID    *string                     `json:"provider_id,omitempty"`
	ProviderKeyID *string                     `json:"provider_key_id,omitempty"`
	MatchType     modelcatalog.MatchType      `json:"match_type"`
	Pattern       string                      `json:"pattern"`
	RequestTypes  []schemas.RequestType       `json:"request_types,omitempty"`
	Patch         modelcatalog.PricingOptions `json:"patch,omitempty"`
}

type updatePricingOverrideRequest struct {
	Name          *string                      `json:"name,omitempty"`
	ScopeKind     *modelcatalog.ScopeKind      `json:"scope_kind,omitempty"`
	VirtualKeyID  nullableString               `json:"virtual_key_id"`
	ProviderID    nullableString               `json:"provider_id"`
	ProviderKeyID nullableString               `json:"provider_key_id"`
	MatchType     *modelcatalog.MatchType      `json:"match_type,omitempty"`
	Pattern       *string                      `json:"pattern,omitempty"`
	RequestTypes  []schemas.RequestType        `json:"request_types,omitempty"`
	Patch         *modelcatalog.PricingOptions `json:"patch,omitempty"`
}

// ---- Handlers ----

func (h *PlatformPriceHandler) getPricingOverrides(ctx *fasthttp.RequestCtx) {
	var scopeKind, virtualKeyID, providerID, providerKeyID *string
	if v := strings.TrimSpace(string(ctx.QueryArgs().Peek("scope_kind"))); v != "" {
		scopeKind = &v
	}
	if v := strings.TrimSpace(string(ctx.QueryArgs().Peek("virtual_key_id"))); v != "" {
		virtualKeyID = &v
	}
	if v := strings.TrimSpace(string(ctx.QueryArgs().Peek("provider_id"))); v != "" {
		providerID = &v
	}
	if v := strings.TrimSpace(string(ctx.QueryArgs().Peek("provider_key_id"))); v != "" {
		providerKeyID = &v
	}

	limitStr := string(ctx.QueryArgs().Peek("limit"))
	offsetStr := string(ctx.QueryArgs().Peek("offset"))
	search := string(ctx.QueryArgs().Peek("search"))

	if limitStr != "" || offsetStr != "" || search != "" {
		params := configstore.PricingOverridesQueryParams{
			Search:        search,
			ScopeKind:     scopeKind,
			VirtualKeyID:  virtualKeyID,
			ProviderID:    providerID,
			ProviderKeyID: providerKeyID,
		}
		if limitStr != "" {
			n, err := strconv.Atoi(limitStr)
			if err != nil {
				SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid limit parameter: must be a number")
				return
			}
			if n < 0 {
				SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid limit parameter: must be non-negative")
				return
			}
			params.Limit = n
		}
		if offsetStr != "" {
			n, err := strconv.Atoi(offsetStr)
			if err != nil {
				SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid offset parameter: must be a number")
				return
			}
			if n < 0 {
				SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid offset parameter: must be non-negative")
				return
			}
			params.Offset = n
		}

		params.Limit, params.Offset = handlers.ClampPaginationParams(params.Limit, params.Offset)
		overrides, totalCount, err := h.configStore.GetPricingOverridesPaginated(ctx, params)
		if err != nil {
			SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to retrieve pricing overrides")
			return
		}
		SendJSON(ctx, map[string]interface{}{
			"pricing_overrides": overrides,
			"count":             len(overrides),
			"total_count":       totalCount,
			"limit":             params.Limit,
			"offset":            params.Offset,
		})
		return
	}

	filters := configstore.PricingOverrideFilters{
		ScopeKind:     scopeKind,
		VirtualKeyID:  virtualKeyID,
		ProviderID:    providerID,
		ProviderKeyID: providerKeyID,
	}
	overrides, err := h.configStore.GetPricingOverrides(ctx, filters)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to retrieve pricing overrides")
		return
	}

	SendJSON(ctx, map[string]interface{}{
		"pricing_overrides": overrides,
		"count":             len(overrides),
		"total_count":       len(overrides),
		"limit":             len(overrides),
		"offset":            0,
	})
}

func (h *PlatformPriceHandler) createPricingOverride(ctx *fasthttp.RequestCtx) {
	var req createPricingOverrideRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid JSON")
		return
	}

	name, err := normalizeAndValidatePricingOverrideName(req.Name)
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	shape := modelcatalog.PricingOverride{
		ScopeKind:     req.ScopeKind,
		VirtualKeyID:  req.VirtualKeyID,
		ProviderID:    req.ProviderID,
		ProviderKeyID: req.ProviderKeyID,
		MatchType:     req.MatchType,
		Pattern:       req.Pattern,
		RequestTypes:  req.RequestTypes,
	}
	if err := shape.IsValid(); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	patchJSON, err := sonic.Marshal(req.Patch)
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid patch")
		return
	}

	now := time.Now()
	override := configstoreTables.TablePricingOverride{
		ID:               schemas.NewID(),
		Name:             name,
		ScopeKind:        string(req.ScopeKind),
		VirtualKeyID:     normalizeOptionalString(req.VirtualKeyID),
		ProviderID:       normalizeOptionalString(req.ProviderID),
		ProviderKeyID:    normalizeOptionalString(req.ProviderKeyID),
		MatchType:        string(req.MatchType),
		Pattern:          strings.TrimSpace(req.Pattern),
		RequestTypes:     req.RequestTypes,
		PricingPatchJSON: string(patchJSON),
		ConfigHash:       "",
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	if err := h.configStore.CreatePricingOverride(ctx, &override); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to create pricing override")
		return
	}
	SendJSONWithStatus(ctx, map[string]interface{}{
		"message":          "Pricing override created successfully",
		"pricing_override": override,
	}, fasthttp.StatusCreated)
}

func (h *PlatformPriceHandler) updatePricingOverride(ctx *fasthttp.RequestCtx) {
	id := ctx.UserValue("id").(string)

	var req updatePricingOverrideRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid JSON")
		return
	}

	existing, err := h.configStore.GetPricingOverrideByID(ctx, id)
	if err != nil {
		if errors.Is(err, configstore.ErrNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "BAD_REQUEST", "Pricing override not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_SERVER_ERROR", fmt.Sprintf("Failed to retrieve pricing override: %v", err))
		return
	}

	// Merge request fields onto the existing record; omitted fields keep their current values.
	merged := modelcatalog.PricingOverride{
		ScopeKind:     modelcatalog.ScopeKind(existing.ScopeKind),
		VirtualKeyID:  existing.VirtualKeyID,
		ProviderID:    existing.ProviderID,
		ProviderKeyID: existing.ProviderKeyID,
		MatchType:     modelcatalog.MatchType(existing.MatchType),
		Pattern:       existing.Pattern,
		RequestTypes:  existing.RequestTypes,
	}
	if req.ScopeKind != nil {
		merged.ScopeKind = *req.ScopeKind
		merged.VirtualKeyID = nil
		merged.ProviderID = nil
		merged.ProviderKeyID = nil
	}
	if req.VirtualKeyID.Set {
		merged.VirtualKeyID = req.VirtualKeyID.Value
	}
	if req.ProviderID.Set {
		merged.ProviderID = req.ProviderID.Value
	}
	if req.ProviderKeyID.Set {
		merged.ProviderKeyID = req.ProviderKeyID.Value
	}
	if req.MatchType != nil {
		merged.MatchType = *req.MatchType
	}
	if req.Pattern != nil {
		merged.Pattern = *req.Pattern
	}
	if req.RequestTypes != nil {
		merged.RequestTypes = req.RequestTypes
	}

	if err := merged.IsValid(); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	// Resolve name: use provided value or fall back to existing.
	nameStr := existing.Name
	if req.Name != nil {
		nameStr, err = normalizeAndValidatePricingOverrideName(*req.Name)
		if err != nil {
			SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
			return
		}
	}

	// Patch JSON: always replace in full with whatever is provided (or keep existing if omitted).
	pricingPatchJSON := existing.PricingPatchJSON
	if req.Patch != nil {
		b, err := sonic.Marshal(req.Patch)
		if err != nil {
			SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid patch")
			return
		}
		pricingPatchJSON = string(b)
	}

	override := configstoreTables.TablePricingOverride{
		ID:               id,
		Name:             nameStr,
		ScopeKind:        string(merged.ScopeKind),
		VirtualKeyID:     normalizeOptionalString(merged.VirtualKeyID),
		ProviderID:       normalizeOptionalString(merged.ProviderID),
		ProviderKeyID:    normalizeOptionalString(merged.ProviderKeyID),
		MatchType:        string(merged.MatchType),
		Pattern:          strings.TrimSpace(merged.Pattern),
		RequestTypes:     merged.RequestTypes,
		PricingPatchJSON: pricingPatchJSON,
		ConfigHash:       existing.ConfigHash,
		CreatedAt:        existing.CreatedAt,
		UpdatedAt:        time.Now(),
	}

	if err := h.configStore.UpdatePricingOverride(ctx, &override); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to update pricing override")
		return
	}
	SendJSON(ctx, map[string]interface{}{
		"message":          "Pricing override updated successfully",
		"pricing_override": override,
	})
}

func (h *PlatformPriceHandler) deletePricingOverride(ctx *fasthttp.RequestCtx) {
	id := ctx.UserValue("id").(string)
	if err := h.configStore.DeletePricingOverride(ctx, id); err != nil {
		if errors.Is(err, configstore.ErrNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "BAD_REQUEST", "Pricing override not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to delete pricing override")
		return
	}
	SendJSON(ctx, map[string]interface{}{
		"message": "Pricing override deleted successfully",
	})
}

// ---- Helpers ----

func normalizeAndValidatePricingOverrideName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", errors.New("name is required")
	}
	return trimmed, nil
}

func normalizeOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
