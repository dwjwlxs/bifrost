package handlers

import (
	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
)

type ProviderHandler struct {
	governanceHandler *handlers.GovernanceHandler
	providerHandler   *handlers.ProviderHandler
}

// creates a new provider handler.
func NewProviderHandler(
	governanceHandler *handlers.GovernanceHandler,
	providerHandler *handlers.ProviderHandler,
) *ProviderHandler {
	return &ProviderHandler{
		governanceHandler: governanceHandler,
		providerHandler:   providerHandler,
	}
}

// Provider management routes
func (h *ProviderHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	group := r.Group("/api/platform/admin")
	adminMw := make([]schemas.BifrostHTTPMiddleware, len(middlewares), len(middlewares)+1)
	copy(adminMw, middlewares)
	adminMw = append(adminMw, RequireAdmin)

	group.GET("/providers", lib.ChainMiddlewares(h.providerHandler.ListProviders, adminMw...))
	group.POST("/providers", lib.ChainMiddlewares(h.providerHandler.AddProvider, adminMw...))
	group.PUT("/providers/{provider}", lib.ChainMiddlewares(h.providerHandler.UpdateProvider, adminMw...))
	group.DELETE("/providers/{provider}", lib.ChainMiddlewares(h.providerHandler.DeleteProvider, adminMw...))

	group.GET("/providers/{provider}/models", lib.ChainMiddlewares(h.providerHandler.ListProviderModels, adminMw...))
	group.POST("/providers/{provider}/models", lib.ChainMiddlewares(h.governanceHandler.CreateModelConfig, adminMw...))

	group.GET("/providers/{provider}/keys", lib.ChainMiddlewares(h.providerHandler.ListProviderKeys, adminMw...))
	group.POST("/providers/{provider}/keys", lib.ChainMiddlewares(h.providerHandler.CreateProviderKey, adminMw...))
	group.PUT("/providers/{provider}/keys/{key_id}", lib.ChainMiddlewares(h.providerHandler.UpdateProviderKey, adminMw...))
	group.DELETE("/providers/{provider}/keys/{key_id}", lib.ChainMiddlewares(h.providerHandler.DeleteProviderKey, adminMw...))
}
