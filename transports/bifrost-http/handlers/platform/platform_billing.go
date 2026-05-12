package handlers

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	fpayment "github.com/maximhq/bifrost/framework/payment"
	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/maximhq/bifrost/transports/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// BillingHandler handles billing API endpoints.
type BillingHandler struct {
	service           *fpayment.BillingService
	registry          *fpayment.GatewayRegistry
	configStore       configstore.ConfigStore
	governanceHandler *handlers.GovernanceHandler
}

// NewBillingHandler creates a new BillingHandler.
// The registry provides all configured payment gateways.
// If registry is nil, a default Manual-only registry is used.
// governanceStore is used to sync newly-created billing budgets into the in-memory map.
func NewBillingHandler(configStore configstore.ConfigStore, registry *fpayment.GatewayRegistry,
	governanceStore governance.GovernanceStore, governanceHandler *handlers.GovernanceHandler) *BillingHandler {
	return &BillingHandler{
		service:           fpayment.NewBillingService(configStore.DB(), registry, governanceStore),
		registry:          registry,
		configStore:       configStore,
		governanceHandler: governanceHandler,
	}
}

// RegisterRoutes registers all billing routes.
func (h *BillingHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	// Balance
	r.GET("/api/billing/balance", lib.ChainMiddlewares(h.handleBalance, middlewares...))

	// Recharge
	r.POST("/api/billing/recharge", lib.ChainMiddlewares(h.createRecharge, middlewares...))
	r.POST("/api/billing/admin/recharge", lib.ChainMiddlewares(h.adminRecharge, append(middlewares, RequireAdmin)...))

	// Package CRUD
	r.GET("/api/billing/packages", lib.ChainMiddlewares(h.listPackages, middlewares...))
	r.GET("/api/billing/packages/{packageId}", lib.ChainMiddlewares(h.getPackage, middlewares...))
	r.POST("/api/billing/packages", lib.ChainMiddlewares(h.createPackage, append(middlewares, RequireAdmin)...))
	r.PUT("/api/billing/packages/{packageId}", lib.ChainMiddlewares(h.updatePackage, append(middlewares, RequireAdmin)...))
	r.DELETE("/api/billing/packages/{packageId}", lib.ChainMiddlewares(h.deletePackage, append(middlewares, RequireAdmin)...))

	// Purchase
	r.POST("/api/billing/purchases", lib.ChainMiddlewares(h.createPurchase, middlewares...))
	r.POST("/api/billing/admin/purchase", lib.ChainMiddlewares(h.adminPurchase, append(middlewares, RequireAdmin)...))

	// Entity Packages
	r.GET("/api/billing/entity-packages", lib.ChainMiddlewares(h.listEntityPackages, middlewares...))
	r.GET("/api/billing/entity-packages/{epId}", lib.ChainMiddlewares(h.getEntityPackage, middlewares...))

	// User Packages (computed view of entity packages with usage)
	r.GET("/api/billing/user/packages", lib.ChainMiddlewares(h.listUserPackages, middlewares...))

	// Orders
	r.GET("/api/billing/orders", lib.ChainMiddlewares(h.listOrders, middlewares...))
	r.GET("/api/billing/orders/{orderId}", lib.ChainMiddlewares(h.getOrder, middlewares...))

	// Generic gateway webhook — routes based on URL path
	r.POST("/api/billing/webhook/{gateway}", h.handleWebhook)

	// Order cancellation
	r.POST("/api/billing/orders/{orderId}/cancel", lib.ChainMiddlewares(h.cancelOrder, middlewares...))

	// Order retry payment
	r.POST("/api/billing/orders/{orderId}/retry-pay", lib.ChainMiddlewares(h.retryPay, middlewares...))

	// List available payment gateways
	r.GET("/api/billing/gateways", lib.ChainMiddlewares(h.listGateways, middlewares...))

	// Order confirmation (Admin only — marks pending order as success and triggers fulfillment)
	r.POST("/api/billing/orders/{orderId}/confirm", lib.ChainMiddlewares(h.confirmOrder, append(middlewares, RequireAdmin)...))
}

// handleBalance handles GET /api/billing/balance.
// Returns the user's wallet balance in USD, package credits in credits, and total credits in credits.
// wallet balance (USD) is converted to credits (USD * 100) before summing into total_credits.
func (h *BillingHandler) handleBalance(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "user_id is required")
		return
	}

	balanceUSD, packageBalanceUSD, err := h.service.GetBalance(ctx, claims.UserID)
	if err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to get balance")
		return
	}

	// balanceUSD is already in credits (converted by service layer)
	// total_credits = wallet credits (balanceUSD) + package credits
	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"balance":         balanceUSD,       // wallet balance in USD
			"balance_credits": balanceUSD * 100, // wallet balance in credits (USD * 100)
			"package_credits": packageBalanceUSD * 100,
			"total_credits":   (balanceUSD + packageBalanceUSD) * 100,
		},
	})
}

// ---- Request types ----

type createRechargeRequest struct {
	Amount            float64 `json:"amount"`             // USD
	Credits           float64 `json:"credits"`            // 1 credit = $0.01
	PreferredCurrency string  `json:"preferred_currency"` // optional: display currency (e.g. "jpy")
	ReturnURL         string  `json:"return_url"`         // optional: URL to redirect after payment
	TenantType        string  `json:"tenant_type"`        // "personal" or "organization"
	TenantId          string  `json:"tenant_id"`          // user_id for personal, org_id for organization
	Gateway           string  `json:"gateway"`            // optional: gateway ID (uses default if empty)
}

type adminRechargeRequest struct {
	UserID     *string `json:"user_id"`
	CustomerID *string `json:"customer_id"`
	Amount     float64 `json:"amount"`  // USD (for record only)
	Credits    float64 `json:"credits"` // 1 credit = $0.01
	TenantType string  `json:"tenant_type"`
	TenantId   string  `json:"tenant_id"`
}

type createPackageRequest struct {
	Name               string  `json:"name"`
	Description        string  `json:"description"`
	Price              float64 `json:"price"`
	Quota              float64 `json:"quota"`
	Duration           int     `json:"duration"`
	RateLimitConfig    string  `json:"rate_limit_config"`
	AllowedModels      string  `json:"allowed_models"`
	OffPeakDiscount    string  `json:"off_peak_discount"`
	AutoRenew          bool    `json:"auto_renew"`
	TargetType         string  `json:"target_type"`
	MaxPurchasePerUser int     `json:"max_purchase_per_user"`
	SortOrder          int     `json:"sort_order"`
	StripePriceID      *string `json:"stripe_price_id"`
}

type updatePackageRequest struct {
	Name               *string  `json:"name"`
	Description        *string  `json:"description"`
	Price              *float64 `json:"price"`
	Quota              *float64 `json:"quota"`
	Duration           *int     `json:"duration"`
	RateLimitConfig    *string  `json:"rate_limit_config"`
	AllowedModels      *string  `json:"allowed_models"`
	OffPeakDiscount    *string  `json:"off_peak_discount"`
	AutoRenew          *bool    `json:"auto_renew"`
	TargetType         *string  `json:"target_type"`
	MaxPurchasePerUser *int     `json:"max_purchase_per_user"`
	IsActive           *bool    `json:"is_active"`
	SortOrder          *int     `json:"sort_order"`
	StripePriceID      *string  `json:"stripe_price_id"`
}

type createPurchaseRequest struct {
	PackageID         string `json:"package_id"`
	PreferredCurrency string `json:"preferred_currency"` // optional: display currency (e.g. "jpy")
	ReturnURL         string `json:"return_url"`         // optional: URL to redirect after payment
	TenantType        string `json:"tenant_type"`        // "personal" or "organization"
	TenantId          string `json:"tenant_id"`          // user_id for personal, org_id for organization
	Gateway           string `json:"gateway"`            // optional: gateway ID (uses default if empty)
}

type adminPurchaseRequest struct {
	UserID     *string `json:"user_id"`
	CustomerID *string `json:"customer_id"`
	PackageID  string  `json:"package_id"`
	TenantType string  `json:"tenant_type"`
	TenantId   string  `json:"tenant_id"`
}

// ---- Handlers: Recharge ----

// createRecharge handles POST /api/billing/recharge.
func (h *BillingHandler) createRecharge(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "user_id is required")
		return
	}

	var req createRechargeRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}
	if req.Amount <= 0 {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Amount must be greater than 0")
		return
	}
	if req.Credits <= 0 {
		req.Credits = req.Amount * 100
	}

	// Validate tenant_type and tenant_id
	tenantType := tables.TenantTypePersonal
	var userID *string

	switch req.TenantType {
	case string(tables.TenantTypePersonal):
		req.TenantId = claims.UserID
		uid := claims.UserID
		userID = &uid
	case string(tables.TenantTypeOrganization):
		tenantType = tables.TenantTypeOrganization
		if req.TenantId == "" {
			sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "tenant_id is required for organization orders")
			return
		}
		// Verify user is owner of this org
		isOwner := false
		for _, org := range claims.Orgs {
			if org.ID == req.TenantId && (org.Role == "owner" || org.Role == "admin") {
				isOwner = true
				break
			}
		}
		if !isOwner {
			sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Only organization owner or admin can create organization orders")
			return
		}
		uid := claims.UserID
		userID = &uid
	default:
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "tenant_type must be 'personal' or 'organization'")
		return
	}

	order, payResult, err := h.service.CreateRechargeOrder(
		ctx, userID, req.Amount, req.Credits, fpayment.PaymentOptions{
			PreferredCurrency: req.PreferredCurrency,
			ReturnURL:         req.ReturnURL,
		}, tenantType, req.TenantId, req.Gateway,
	)
	if err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create order")
		return
	}

	data := marshalOrder(order)
	if payResult != nil && payResult.CheckoutURL != "" {
		data["checkout_url"] = payResult.CheckoutURL
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    data,
	})
}

// adminRecharge handles POST /api/billing/admin/recharge.
func (h *BillingHandler) adminRecharge(ctx *fasthttp.RequestCtx) {
	var req adminRechargeRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}
	if (req.UserID == nil || *req.UserID == "") && (req.CustomerID == nil || *req.CustomerID == "") {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Either user_id or customer_id is required")
		return
	}
	if req.Credits <= 0 && req.Amount <= 0 {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Credits or amount must be greater than 0")
		return
	}
	// Convert amount to credits if credits not provided (1 USD = 100 credits)
	if req.Credits <= 0 {
		req.Credits = req.Amount * 100
	}

	// Derive tenantType and tenantID from the target identity
	var tenantType tables.TenantType
	var tenantID string
	var userID *string
	if req.CustomerID != nil && *req.CustomerID != "" {
		// Organization recharge via customer_id
		tenantType = tables.TenantTypeOrganization
		tenantID = *req.CustomerID
		userID = nil
	} else {
		// Personal recharge via user_id
		tenantType = tables.TenantTypePersonal
		userID = req.UserID
		if req.UserID != nil {
			tenantID = *req.UserID
		}
	}

	order, err := h.service.AdminRecharge(ctx, userID, req.CustomerID, req.Amount, req.Credits, tenantType, tenantID)
	if err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to process recharge: "+err.Error())
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "Recharge successful",
		"data":    marshalOrder(order),
	})
}

// ---- Handlers: Package CRUD (II-B-1) ----

// listPackages handles GET /api/billing/packages.
func (h *BillingHandler) listPackages(ctx *fasthttp.RequestCtx) {
	offset, _ := strconv.ParseUint(string(ctx.QueryArgs().Peek("offset")), 10, 64)
	limit, _ := strconv.ParseUint(string(ctx.QueryArgs().Peek("limit")), 10, 64)
	if limit == 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	var isActive *bool
	if v := string(ctx.QueryArgs().Peek("is_active")); v == "true" {
		b := true
		isActive = &b
	} else if v == "false" {
		b := false
		isActive = &b
	}
	var targetType *string
	if v := string(ctx.QueryArgs().Peek("target_type")); v != "" {
		targetType = &v
	}

	pkgs, total, err := h.service.ListPackages(ctx, isActive, targetType, int(offset), int(limit))
	if err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to list packages")
		return
	}

	items := make([]map[string]any, len(pkgs))
	for i, p := range pkgs {
		items[i] = marshalPackage(&p)
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    map[string]any{"items": items, "total": total},
	})
}

// getPackage handles GET /api/billing/packages/{packageId}.
func (h *BillingHandler) getPackage(ctx *fasthttp.RequestCtx) {
	packageID := ctx.UserValue("packageId").(string)
	pkg, err := h.service.GetPackage(ctx, packageID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Package not found")
		} else {
			sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to get package")
		}
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalPackage(pkg),
	})
}

// createPackage handles POST /api/billing/packages.
func (h *BillingHandler) createPackage(ctx *fasthttp.RequestCtx) {
	var req createPackageRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}

	pkg := tables.TablePlatformPackage{
		Name:               req.Name,
		Description:        req.Description,
		Price:              req.Price,
		Quota:              req.Quota,
		Duration:           req.Duration,
		RateLimitConfig:    req.RateLimitConfig,
		AllowedModels:      req.AllowedModels,
		OffPeakDiscount:    req.OffPeakDiscount,
		AutoRenew:          req.AutoRenew,
		TargetType:         req.TargetType,
		MaxPurchasePerUser: req.MaxPurchasePerUser,
		SortOrder:          req.SortOrder,
		IsActive:           true,
		StripePriceID:      req.StripePriceID,
	}
	if pkg.TargetType == "" {
		pkg.TargetType = "both"
	}

	if err := h.service.CreatePackage(ctx, &pkg); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalPackage(&pkg),
	})
}

// updatePackage handles PUT /api/billing/packages/{packageId}.
func (h *BillingHandler) updatePackage(ctx *fasthttp.RequestCtx) {
	packageID := ctx.UserValue("packageId").(string)

	var req updatePackageRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}

	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.Price != nil {
		updates["price"] = *req.Price
	}
	if req.Quota != nil {
		updates["quota"] = *req.Quota
	}
	if req.Duration != nil {
		updates["duration"] = *req.Duration
	}
	if req.RateLimitConfig != nil {
		updates["rate_limit_config"] = *req.RateLimitConfig
	}
	if req.AllowedModels != nil {
		updates["allowed_models"] = *req.AllowedModels
	}
	if req.OffPeakDiscount != nil {
		updates["off_peak_discount"] = *req.OffPeakDiscount
	}
	if req.AutoRenew != nil {
		updates["auto_renew"] = *req.AutoRenew
	}
	if req.TargetType != nil {
		updates["target_type"] = *req.TargetType
	}
	if req.MaxPurchasePerUser != nil {
		updates["max_purchase_per_user"] = *req.MaxPurchasePerUser
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}
	if req.SortOrder != nil {
		updates["sort_order"] = *req.SortOrder
	}
	if req.StripePriceID != nil {
		updates["stripe_price_id"] = *req.StripePriceID
	}

	if len(updates) == 0 {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "No fields to update")
		return
	}

	if err := h.service.UpdatePackage(ctx, packageID, updates); err != nil {
		if err == gorm.ErrRecordNotFound {
			sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Package not found")
		} else {
			sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
		}
		return
	}

	// Return updated package
	pkg, _ := h.service.GetPackage(ctx, packageID)
	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalPackage(pkg),
	})
}

// deletePackage handles DELETE /api/billing/packages/{packageId}.
func (h *BillingHandler) deletePackage(ctx *fasthttp.RequestCtx) {
	packageID := ctx.UserValue("packageId").(string)

	if err := h.service.DeletePackage(ctx, packageID); err != nil {
		if err == gorm.ErrRecordNotFound {
			sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Package not found")
		} else {
			sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to delete package")
		}
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "Package deleted",
	})
}

// ---- Handlers: Purchase (II-B-3) ----

// createPurchase handles POST /api/billing/purchases.
func (h *BillingHandler) createPurchase(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	var req createPurchaseRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}
	if req.PackageID == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "package_id is required")
		return
	}

	// Validate tenant_type and tenant_id
	tenantType := tables.TenantTypePersonal
	var userID *string
	var customerID *string

	switch req.TenantType {
	case "personal":
		tenantType = tables.TenantTypePersonal
		if req.TenantId == "" || req.TenantId != claims.UserID {
			sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Personal order must have tenant_id equal to your own user_id")
			return
		}
		uid := claims.UserID
		userID = &uid
		customerID = nil
	case "organization":
		tenantType = tables.TenantTypeOrganization
		if req.TenantId == "" {
			sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "tenant_id is required for organization orders")
			return
		}
		// Verify user is owner of this org
		isOwner := false
		for _, org := range claims.Orgs {
			if org.ID == req.TenantId && (org.Role == "owner" || org.Role == "admin") {
				isOwner = true
				break
			}
		}
		if !isOwner {
			sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Only organization owner or admin can create organization orders")
			return
		}
		uid := claims.UserID
		userID = &uid
		customerID = &req.TenantId
	default:
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "tenant_type must be 'personal' or 'organization'")
		return
	}

	order, pkg, payResult, err := h.service.CreatePurchaseOrder(
		ctx, userID, customerID, req.PackageID, fpayment.PaymentOptions{
			PreferredCurrency: req.PreferredCurrency,
			ReturnURL:         req.ReturnURL,
		}, tenantType, req.TenantId, req.Gateway,
	)
	if err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	data := marshalOrder(order)
	data["package"] = marshalPackage(pkg)
	if payResult != nil && payResult.CheckoutURL != "" {
		data["checkout_url"] = payResult.CheckoutURL
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    data,
	})
}

// adminPurchase handles POST /api/billing/admin/purchase.
func (h *BillingHandler) adminPurchase(ctx *fasthttp.RequestCtx) {
	var req adminPurchaseRequest
	if err := json.Unmarshal(ctx.PostBody(), &req); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid request format")
		return
	}
	if req.PackageID == "" {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "package_id is required")
		return
	}
	if (req.UserID == nil || *req.UserID == "") && (req.CustomerID == nil || *req.CustomerID == "") {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Either user_id or customer_id is required")
		return
	}

	// Derive tenantType and tenantID from the target identity
	var tenantType tables.TenantType
	var tenantID string
	var userID *string
	var customerID *string
	if req.CustomerID != nil && *req.CustomerID != "" {
		// Organization purchase via customer_id
		tenantType = tables.TenantTypeOrganization
		tenantID = *req.CustomerID
		customerID = req.CustomerID
		userID = nil
	} else {
		// Personal purchase via user_id
		tenantType = tables.TenantTypePersonal
		userID = req.UserID
		customerID = nil
		if req.UserID != nil {
			tenantID = *req.UserID
		}
	}

	order, ep, err := h.service.AdminPurchase(ctx, userID, customerID, req.PackageID, tenantType, tenantID)
	if err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to process purchase: "+err.Error())
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "Purchase successful",
		"data": map[string]any{
			"order":          marshalOrder(order),
			"entity_package": marshalEntityPackage(ep),
		},
	})
}

// ---- Handlers: Entity Packages ----

// listEntityPackages handles GET /api/billing/entity-packages.
func (h *BillingHandler) listEntityPackages(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
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

	// Admins see all entity packages (with optional filter); regular users see only their own
	var userID *string
	var tenantType *tables.TenantType
	var tenantID *string
	if !claims.IsAdmin {
		uid := claims.UserID
		userID = &uid
	} else {
		// Admin can filter by tenant_type + tenant_id
		if v := string(ctx.QueryArgs().Peek("tenant_type")); v != "" {
			tt := tables.TenantType(v)
			tenantType = &tt
		}
		if v := string(ctx.QueryArgs().Peek("tenant_id")); v != "" {
			tenantID = &v
		}
	}
	var status *tables.EntityPackageStatus
	if v := string(ctx.QueryArgs().Peek("status")); v != "" {
		s := tables.EntityPackageStatus(v)
		status = &s
	}
	eps, total, err := h.service.ListEntityPackages(ctx, userID, tenantType, tenantID, status, int(offset), int(limit))
	if err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to list entity packages")
		return
	}

	items := make([]map[string]any, len(eps))
	for i, ep := range eps {
		items[i] = marshalEntityPackage(&ep)
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    map[string]any{"items": items, "total": total},
	})
}

// listUserPackages handles GET /api/billing/user/packages.
// Returns a computed view of entity packages with remaining credits for the current user.
// Uses batch budget loading to avoid N+1 queries.
func (h *BillingHandler) listUserPackages(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	eps, _, err := h.service.ListEntityPackages(ctx, &claims.UserID, nil, nil, nil, 0, 100)
	if err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to list user packages")
		return
	}

	// Batch load all budgets in one query to avoid N+1
	budgetIDSet := make(map[string]struct{})
	for _, ep := range eps {
		if ep.BudgetID != nil {
			budgetIDSet[*ep.BudgetID] = struct{}{}
		}
	}
	budgetMap := make(map[string]tables.TableBudget, len(budgetIDSet))
	if len(budgetIDSet) > 0 {
		var budgetIDs []string
		for id := range budgetIDSet {
			budgetIDs = append(budgetIDs, id)
		}
		var budgets []tables.TableBudget
		if err := h.configStore.DB().WithContext(ctx).Where("id IN ?", budgetIDs).Find(&budgets).Error; err == nil {
			for _, b := range budgets {
				budgetMap[b.ID] = b
			}
		}
	}

	items := make([]map[string]any, 0, len(eps))
	for _, ep := range eps {
		if ep.Status != "active" {
			continue
		}
		remainingCredits := 0.0
		if ep.BudgetID != nil {
			if budget, ok := budgetMap[*ep.BudgetID]; ok {
				remainingCredits = budget.MaxLimit - budget.CurrentUsage
				if remainingCredits < 0 {
					remainingCredits = 0
				}
			}
		}
		item := map[string]any{
			"id":                ep.ID,
			"package_id":        ep.PackageID,
			"package_name":      ep.Package.Name,
			"remaining_credits": remainingCredits,
			"remaining_tokens":  0, // tokens tracked separately in token usage API
			"remaining_calls":   0, // calls tracked separately
			"expires_at":        ep.ExpiresAt,
			"status":            ep.Status,
			"created_at":        ep.CreatedAt,
		}
		items = append(items, item)
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    map[string]any{"items": items},
	})
}

// getEntityPackage handles GET /api/billing/entity-packages/{epId}.
func (h *BillingHandler) getEntityPackage(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	epID := ctx.UserValue("epId").(string)
	ep, err := h.service.GetEntityPackage(ctx, epID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Entity package not found")
		} else {
			sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to get entity package")
		}
		return
	}

	// Ownership check: admins can see all; users can only see their own
	if !claims.IsAdmin && ep.UserID != nil && *ep.UserID != claims.UserID {
		sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Entity package not found")
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalEntityPackage(ep),
	})
}

// ---- Handlers: Orders ----

// listOrders handles GET /api/billing/orders.
func (h *BillingHandler) listOrders(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
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

	var orderType *tables.OrderType
	if v := string(ctx.QueryArgs().Peek("type")); v != "" {
		t := tables.OrderType(v)
		orderType = &t
	}
	var status *tables.OrderStatus
	if v := string(ctx.QueryArgs().Peek("status")); v != "" {
		s := tables.OrderStatus(v)
		status = &s
	}

	// Admins see all orders; regular users see only their own
	var userID *string
	if !claims.IsAdmin {
		uid := claims.UserID
		userID = &uid
	}
	orders, total, err := h.service.ListOrders(ctx, userID, nil, orderType, status, int(offset), int(limit))
	if err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to list orders")
		return
	}

	items := make([]map[string]any, len(orders))
	for i, o := range orders {
		items[i] = marshalOrder(&o)
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    map[string]any{"items": items, "total": total},
	})
}

// getOrder handles GET /api/billing/orders/{orderId}.
func (h *BillingHandler) getOrder(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "user_id is required")
		return
	}

	orderID, err := strconv.ParseUint(ctx.UserValue("orderId").(string), 10, 64)
	if err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid order ID")
		return
	}

	order, err := h.service.GetOrder(ctx, uint(orderID))
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Order not found")
		} else {
			sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to get order")
		}
		return
	}

	// Admins can view any order; regular users can only see their own
	if !claims.IsAdmin && (order.UserID == nil || *order.UserID != claims.UserID) {
		sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Order not found")
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalOrder(order),
	})
}

// ---- Handlers: Webhook (III-B-1) ----

// handleWebhook handles POST /api/billing/webhook/{gateway}.
// Routes to the appropriate gateway's HandleWebhook based on the URL path.
// No auth middleware — gateway-specific signature verification is done internally.
func (h *BillingHandler) handleWebhook(ctx *fasthttp.RequestCtx) {
	gatewayParam := ctx.UserValue("gateway")
	if gatewayParam == nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Missing gateway URL parameter")
		return
	}
	gatewayID := gatewayParam.(string)

	// DEBUG: log the gateway IDs from registry
	fmt.Printf("[DEBUG] handleWebhook: gatewayID=%s, registry IDs=%v\n", gatewayID, h.registry.IDs())

	gw, err := h.registry.Get(gatewayID)
	if err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "UNKNOWN_GATEWAY", "Unknown gateway: "+gatewayID)
		return
	}

	// Read raw body
	payload := ctx.PostBody()
	if len(payload) == 0 {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Empty payload")
		return
	}

	// Gateway-specific signature header
	var sigHeader string
	switch gatewayID {
	case "stripe":
		sigHeader = string(ctx.Request.Header.Peek("Stripe-Signature"))
		if sigHeader == "" {
			sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Missing Stripe-Signature header")
			return
		}
	case "alipay":
		// Alipay uses a different header
		sigHeader = string(ctx.Request.Header.Peek("Alipay-Signature"))
	}

	result, err := gw.HandleWebhook(ctx, payload, sigHeader)
	if err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "WEBHOOK_ERROR", err.Error())
		return
	}

	// nil result means unhandled event type — acknowledge but skip
	if result == nil {
		sendJSON(ctx, map[string]any{
			"code":    "0",
			"message": "event ignored",
		})
		return
	}

	// Process the webhook result (match order, execute business logic)
	if err := h.service.HandleWebhookResult(ctx, result); err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to process webhook: "+err.Error())
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "webhook processed",
	})
}

// ---- Handlers: Order Cancellation (III-B-3) ----

// cancelOrder handles POST /api/billing/orders/{orderId}/cancel.
func (h *BillingHandler) cancelOrder(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	orderID, err := strconv.ParseUint(ctx.UserValue("orderId").(string), 10, 64)
	if err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid order ID")
		return
	}

	// Verify ownership before cancelling
	order, err := h.service.GetOrder(ctx, uint(orderID))
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Order not found")
		} else {
			sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to get order")
		}
		return
	}

	// Admins can cancel any order; regular users can only cancel their own
	if !claims.IsAdmin && (order.UserID == nil || *order.UserID != claims.UserID) {
		sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Order not found")
		return
	}

	if err := h.service.CancelOrder(ctx, uint(orderID)); err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "Order cancelled",
	})
}

// confirmOrder handles POST /api/billing/orders/{orderId}/confirm.
// Admin-only: confirms a pending order (recharge or purchase) and triggers fulfillment.
func (h *BillingHandler) confirmOrder(ctx *fasthttp.RequestCtx) {

	orderID, err := strconv.ParseUint(ctx.UserValue("orderId").(string), 10, 64)
	if err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid order ID")
		return
	}

	ep, err := h.service.ConfirmOrder(ctx, uint(orderID))
	if err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	// Fetch updated order
	order, _ := h.service.GetOrder(ctx, uint(orderID))

	resp := map[string]any{
		"code":    "0",
		"message": "Order confirmed",
		"data": map[string]any{
			"order": marshalOrder(order),
		},
	}
	if ep != nil {
		resp["data"].(map[string]any)["entity_package"] = marshalEntityPackage(ep)
	}

	sendJSON(ctx, resp)
}

// ---- Marshal helpers ----

func marshalOrder(o *tables.TablePlatformOrder) map[string]any {
	data := map[string]any{
		"id":                  o.ID,
		"order_no":            o.OrderNo,
		"type":                o.Type,
		"amount":              o.Amount,
		"credits":             o.Credits,
		"status":              o.Status,
		"gateway":             o.Gateway,
		"payment_method":      o.PaymentMethod,
		"payment_id":          o.PaymentID,
		"checkout_url":        o.CheckoutURL,
		"checkout_expires_at": o.CheckoutExpiresAt,
		"paid_at":             o.PaidAt,
		"package_id":          o.PackageID,
		"entity_package_id":   o.EntityPackageID,
		"created_at":          o.CreatedAt,
		"updated_at":          o.UpdatedAt,
		"tenant_type":         o.TenantType,
		"tenant_id":           o.TenantID, // can be customer_id
	}
	if o.UserID != nil {
		data["user_id"] = *o.UserID
	}

	return data
}

func marshalPackage(p *tables.TablePlatformPackage) map[string]any {
	data := map[string]any{
		"id":                    p.ID,
		"name":                  p.Name,
		"description":           p.Description,
		"price":                 p.Price,
		"quota":                 p.Quota,
		"duration":              p.Duration,
		"auto_renew":            p.AutoRenew,
		"target_type":           p.TargetType,
		"max_purchase_per_user": p.MaxPurchasePerUser,
		"is_active":             p.IsActive,
		"sort_order":            p.SortOrder,
		"created_at":            p.CreatedAt,
		"updated_at":            p.UpdatedAt,
	}
	// Only include JSON fields if non-empty to avoid returning empty strings
	if p.RateLimitConfig != "" {
		data["rate_limit_config"] = json.RawMessage(p.RateLimitConfig)
	}
	if p.AllowedModels != "" {
		data["allowed_models"] = json.RawMessage(p.AllowedModels)
	}
	if p.OffPeakDiscount != "" {
		data["off_peak_discount"] = json.RawMessage(p.OffPeakDiscount)
	}
	if p.StripePriceID != nil {
		data["stripe_price_id"] = *p.StripePriceID
	}
	return data
}

func marshalEntityPackage(ep *tables.TableEntityPackage) map[string]any {
	data := map[string]any{
		"id":                      ep.ID,
		"package_id":              ep.PackageID,
		"budget_id":               ep.BudgetID,
		"rate_limit_id":           ep.RateLimitID,
		"user_provider_config_id": ep.UserProviderConfigID,
		"auto_renew":              ep.AutoRenew,
		"renewed_from_id":         ep.RenewedFromID,
		"started_at":              ep.StartedAt,
		"expires_at":              ep.ExpiresAt,
		"source":                  ep.Source,
		"order_id":                ep.OrderID,
		"status":                  ep.Status,
		"created_at":              ep.CreatedAt,
		"updated_at":              ep.UpdatedAt,
		"tenant_type":             ep.TenantType,
		"tenant_id":               ep.TenantID, // can be customer_id
	}
	if ep.UserID != nil {
		data["user_id"] = *ep.UserID
	}
	if ep.OffPeakDiscount != "" {
		data["off_peak_discount"] = json.RawMessage(ep.OffPeakDiscount)
	}
	if ep.Package.ID != "" {
		data["package"] = marshalPackage(&ep.Package)
	}
	return data
}

// ---- Handlers: Retry Pay & Gateway List ----

// retryPay handles POST /api/billing/orders/{orderId}/retry-pay.
// Re-attempts payment for a pending order, returning a (potentially new) checkout URL.
func (h *BillingHandler) retryPay(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	orderIDStr := ctx.UserValue("orderId").(string)
	orderID, err := strconv.ParseUint(orderIDStr, 10, 64)
	if err != nil {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Invalid order ID")
		return
	}

	// Fetch order to verify ownership
	order, err := h.service.GetOrder(ctx, uint(orderID))
	if err != nil {
		sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Order not found")
		return
	}

	// Non-admin users can only retry their own orders
	if !claims.IsAdmin && order.UserID != nil && *order.UserID != claims.UserID {
		sendError(ctx, fasthttp.StatusForbidden, "FORBIDDEN", "Cannot retry another user's order")
		return
	}

	if order.Status != tables.OrderStatusPending {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Only pending orders can be retried")
		return
	}

	// Manual gateway orders cannot be retried via checkout
	updatedOrder, payResult, err := h.service.RetryOrder(ctx, uint(orderID))
	if err != nil {
		sendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to retry payment: "+err.Error())
		return
	}

	data := marshalOrder(updatedOrder)
	if payResult != nil && payResult.CheckoutURL != "" {
		data["checkout_url"] = payResult.CheckoutURL
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    data,
	})
}

// listGateways handles GET /api/billing/gateways.
// Returns the list of available payment gateways (gateway name + supported payment methods).
func (h *BillingHandler) listGateways(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		sendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	// Load gateway list from registry
	infos := h.registry.GatewayInfos()
	gateways := make([]map[string]any, 0, len(infos))
	for _, info := range infos {
		gateways = append(gateways, map[string]any{
			"gateway": info.ID,
			"name":    info.Name,
			"methods": info.Methods,
		})
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    map[string]any{"items": gateways},
	})
}
