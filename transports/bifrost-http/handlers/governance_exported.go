package handlers

import (
	"github.com/valyala/fasthttp"
)

// createModelConfig handles POST /api/governance/model-configs - Create a new model config
func (h *GovernanceHandler) CreateModelConfig(ctx *fasthttp.RequestCtx) {
	h.createModelConfig(ctx)
}

// GetPricingOverrides handles GET pricing overrides - list with pagination/filters
func (h *GovernanceHandler) GetPricingOverrides(ctx *fasthttp.RequestCtx) {
	h.getPricingOverrides(ctx)
}

// CreatePricingOverride handles POST pricing overrides - create a new override
func (h *GovernanceHandler) CreatePricingOverride(ctx *fasthttp.RequestCtx) {
	h.createPricingOverride(ctx)
}

// UpdatePricingOverride handles PUT pricing overrides - update an existing override
func (h *GovernanceHandler) UpdatePricingOverride(ctx *fasthttp.RequestCtx) {
	h.updatePricingOverride(ctx)
}

// DeletePricingOverride handles DELETE pricing overrides - delete an override
func (h *GovernanceHandler) DeletePricingOverride(ctx *fasthttp.RequestCtx) {
	h.deletePricingOverride(ctx)
}
