package handlers

import (
	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
)

type PlatformPriceHandler struct {
	governanceHandler *handlers.GovernanceHandler
}

func NewPlatformPriceHandler(governanceHandler *handlers.GovernanceHandler) *PlatformPriceHandler {
	return &PlatformPriceHandler{
		governanceHandler: governanceHandler,
	}
}

func (h *PlatformPriceHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {

	// Model Prices — proxy to Governance pricing override handlers
	r.GET("/api/billing/admin/model-prices", lib.ChainMiddlewares(h.governanceHandler.GetPricingOverrides, append(middlewares, RequireAdmin)...))
	r.POST("/api/billing/admin/model-prices", lib.ChainMiddlewares(h.governanceHandler.CreatePricingOverride, append(middlewares, RequireAdmin)...))
	r.PUT("/api/billing/admin/model-prices/{id}", lib.ChainMiddlewares(h.governanceHandler.UpdatePricingOverride, append(middlewares, RequireAdmin)...))
	r.DELETE("/api/billing/admin/model-prices/{id}", lib.ChainMiddlewares(h.governanceHandler.DeletePricingOverride, append(middlewares, RequireAdmin)...))

}
