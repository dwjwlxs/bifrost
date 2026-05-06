package handlers

import (
	"encoding/json"
	"strconv"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	fpayment "github.com/maximhq/bifrost/framework/payment"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// BillingHandler handles billing API endpoints.
type BillingHandler struct {
	db      *gorm.DB
	service *fpayment.BillingService
}

// NewBillingHandler creates a new BillingHandler.
func NewBillingHandler(db *gorm.DB, configStore interface{}) *BillingHandler {
	return &BillingHandler{
		db:      db,
		service: fpayment.NewBillingService(db, fpayment.NewManualGateway()),
	}
}

// RegisterRoutes registers all billing routes.
func (h *BillingHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	r.POST("/api/billing/recharge", lib.ChainMiddlewares(h.createRecharge, middlewares...))
	r.POST("/api/billing/admin/recharge", lib.ChainMiddlewares(h.adminRecharge, append(middlewares, RequireAdmin)...))
	r.GET("/api/billing/orders", lib.ChainMiddlewares(h.listOrders, middlewares...))
	r.GET("/api/billing/orders/{orderId}", lib.ChainMiddlewares(h.getOrder, middlewares...))
	r.GET("/api/billing/health", lib.ChainMiddlewares(h.healthCheck, middlewares...))
}

// ---- Request types ----

type createRechargeRequest struct {
	Amount     float64 `json:"amount"`      // USD
	Credits    float64 `json:"credits"`     // 1 credit = $0.01
	CustomerID *string `json:"customer_id"` // optional: recharge a customer
}

type adminRechargeRequest struct {
	UserID     *string `json:"user_id"`
	CustomerID *string `json:"customer_id"`
	Amount     float64 `json:"amount"`  // USD (for record only)
	Credits    float64 `json:"credits"` // 1 credit = $0.01
}

// ---- Handlers ----

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

	userID := claims.UserID
	order, payResult, err := h.service.CreateRechargeOrder(
		ctx, &userID, req.CustomerID, req.Amount, req.Credits, fpayment.PaymentOptions{},
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
	if req.Credits <= 0 {
		sendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "Credits must be greater than 0")
		return
	}

	order, err := h.service.AdminRecharge(ctx, req.UserID, req.CustomerID, req.Amount, req.Credits)
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

	userID := claims.UserID
	orders, total, err := h.service.ListOrders(ctx, &userID, nil, orderType, status, int(offset), int(limit))
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

	// Ensure the user can only see their own orders
	if order.UserID == nil || *order.UserID != claims.UserID {
		sendError(ctx, fasthttp.StatusNotFound, "NOT_FOUND", "Order not found")
		return
	}

	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    marshalOrder(order),
	})
}

// healthCheck handles GET /api/billing/health.
func (h *BillingHandler) healthCheck(ctx *fasthttp.RequestCtx) {
	sendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "billing module is healthy",
	})
}

// ---- Helpers ----

func marshalOrder(o *tables.TablePlatformOrder) map[string]any {
	return map[string]any{
		"id":             o.ID,
		"order_no":       o.OrderNo,
		"type":           o.Type,
		"amount":         o.Amount,
		"credits":        o.Credits,
		"status":         o.Status,
		"payment_method": o.PaymentMethod,
		"payment_id":     o.PaymentID,
		"paid_at":        o.PaidAt,
		"package_id":     o.PackageID,
		"created_at":     o.CreatedAt,
		"updated_at":     o.UpdatedAt,
	}
}
