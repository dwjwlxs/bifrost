// Package handlers provides HTTP request handlers for the Bifrost HTTP transport.
package handlers

import (
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/valyala/fasthttp"
)

// ================ provider ================

// AddProvider exports addProvider as an exported function.
func (h *ProviderHandler) AddProvider(ctx *fasthttp.RequestCtx) {
	h.addProvider(ctx)
}

// UpdateProvider exports updateProvider as an exported function.
func (h *ProviderHandler) UpdateProvider(ctx *fasthttp.RequestCtx) {
	h.updateProvider(ctx)
}

// DeleteProvider exports deleteProvider as an exported function.
func (h *ProviderHandler) DeleteProvider(ctx *fasthttp.RequestCtx) {
	h.deleteProvider(ctx)
}

// ListProviders exports listProviders as an exported function.
func (h *ProviderHandler) ListProviders(ctx *fasthttp.RequestCtx) {
	h.listProviders(ctx)
}

// GetProvider exports getProvider as an exported function.
func (h *ProviderHandler) GetProvider(ctx *fasthttp.RequestCtx) {
	h.getProvider(ctx)
}

// GetProviderResponseFromConfig exports getProviderResponseFromConfig as an exported function.
func (h *ProviderHandler) GetProviderResponseFromConfig(provider schemas.ModelProvider, config configstore.ProviderConfig, status ProviderStatus) ProviderResponse {
	return h.getProviderResponseFromConfig(provider, config, status)
}

// ================ model ================

// ListBaseModels exports listBaseModels as an exported function.
func (h *ProviderHandler) ListBaseModels(ctx *fasthttp.RequestCtx) {
	h.listBaseModels(ctx)
}

// ListModels exports listModels as an exported function.
func (h *ProviderHandler) ListModels(ctx *fasthttp.RequestCtx) {
	h.listModels(ctx)
}

// ListProviderModels exports listProviderModels as an exported function (no limit, for admin use).
func (h *ProviderHandler) ListProviderModels(ctx *fasthttp.RequestCtx) {
	h.listProviderModels(ctx)
}

// ListModelDetails exports listModelDetails as an exported function.
func (h *ProviderHandler) ListModelDetails(ctx *fasthttp.RequestCtx) {
	h.listModelDetails(ctx)
}

// GetModelParameters exports getModelParameters as an exported function.
func (h *ProviderHandler) GetModelParameters(ctx *fasthttp.RequestCtx) {
	h.getModelParameters(ctx)
}

// ================ api key ================

// CreateProviderKey exports createProviderKey as an exported function.
func (h *ProviderHandler) CreateProviderKey(ctx *fasthttp.RequestCtx) {
	h.createProviderKey(ctx)
}

// UpdateProviderKey exports updateProviderKey as an exported function.
func (h *ProviderHandler) UpdateProviderKey(ctx *fasthttp.RequestCtx) {
	h.updateProviderKey(ctx)
}

// DeleteProviderKey exports deleteProviderKey as an exported function.
func (h *ProviderHandler) DeleteProviderKey(ctx *fasthttp.RequestCtx) {
	h.deleteProviderKey(ctx)
}

// ListProviderKeys exports listProviderKeys as an exported function.
func (h *ProviderHandler) ListProviderKeys(ctx *fasthttp.RequestCtx) {
	h.listProviderKeys(ctx)
}

// GetProviderKey exports getProviderKey as an exported function.
func (h *ProviderHandler) GetProviderKey(ctx *fasthttp.RequestCtx) {
	h.getProviderKey(ctx)
}

// ListKeys exports listKeys as an exported function.
func (h *ProviderHandler) ListKeys(ctx *fasthttp.RequestCtx) {
	h.listKeys(ctx)
}
