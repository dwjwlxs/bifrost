package handlers

import (
	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// PlatformOrgHandler handles organization management API operations.
type PlatformOrgHandler struct {
	db          *gorm.DB
	configStore configstore.ConfigStore
}

// NewPlatformOrgHandler creates a new PlatformOrgHandler.
func NewPlatformOrgHandler(db *gorm.DB, configStore configstore.ConfigStore) *PlatformOrgHandler {
	return &PlatformOrgHandler{
		db:          db,
		configStore: configStore,
	}
}

// RegisterRoutes registers all platform org routes.
func (h *PlatformOrgHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	group := r.Group("/api/platform/orgs")
	orgAdminMw := append([]schemas.BifrostHTTPMiddleware{RequireOrgAdmin}, middlewares...)
	orgMemberMw := append([]schemas.BifrostHTTPMiddleware{RequireOrgMember}, middlewares...)

	group.GET("/", lib.ChainMiddlewares(h.listMyOrgs, middlewares...))
	group.GET("/{orgId}", lib.ChainMiddlewares(h.getOrg, orgMemberMw...))
	group.GET("/{orgId}/teams", lib.ChainMiddlewares(h.listOrgTeams, orgAdminMw...))
	group.GET("/{orgId}/members", lib.ChainMiddlewares(h.listOrgMembers, orgAdminMw...))
}

// listMyOrgs handles GET /api/platform/orgs — list organizations the current user belongs to.
func (h *PlatformOrgHandler) listMyOrgs(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "Unauthorized")
		return
	}

	// Get the list of org IDs from the user's claims
	orgIDs := make([]string, 0, len(claims.Orgs))
	for _, org := range claims.Orgs {
		orgIDs = append(orgIDs, org.ID)
	}

	if len(orgIDs) == 0 {
		SendJSON(ctx, map[string]any{
			"code":    "0",
			"message": "success",
			"data": map[string]any{
				"items": []any{},
				"total": 0,
			},
		})
		return
	}

	// Query governance_customers for org details
	var customers []tables.TableCustomer
	if err := h.db.Where("id IN ?", orgIDs).Find(&customers).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list organizations")
		return
	}

	// Build response with role from claims
	customersByID := make(map[string]tables.TableCustomer, len(customers))
	for _, c := range customers {
		customersByID[c.ID] = c
	}

	items := make([]map[string]any, 0, len(claims.Orgs))
	for _, org := range claims.Orgs {
		c, exists := customersByID[org.ID]
		item := map[string]any{
			"id":   org.ID,
			"role": org.Role,
		}
		if exists {
			item["name"] = c.Name
			item["created_at"] = c.CreatedAt
			item["updated_at"] = c.UpdatedAt
		}
		items = append(items, item)
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"items": items,
			"total": len(items),
		},
	})
}

// getOrg handles GET /api/platform/orgs/{orgId} — get organization details.
func (h *PlatformOrgHandler) getOrg(ctx *fasthttp.RequestCtx) {
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

	// Get user's role in this org
	claims := GetPlatformClaimsFromContext(ctx)
	role := ""
	if claims != nil {
		for _, org := range claims.Orgs {
			if org.ID == orgID {
				role = org.Role
				break
			}
		}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"id":         customer.ID,
			"name":       customer.Name,
			"budget_id":  customer.BudgetID,
			"role":       role,
			"created_at": customer.CreatedAt,
			"updated_at": customer.UpdatedAt,
		},
	})
}

// listOrgTeams handles GET /api/platform/orgs/{orgId}/teams — list teams in an organization.
func (h *PlatformOrgHandler) listOrgTeams(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	if orgID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Organization ID is required")
		return
	}

	var teams []tables.TableTeam
	if err := h.db.Where("customer_id = ?", orgID).Find(&teams).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list teams")
		return
	}

	items := make([]map[string]any, len(teams))
	for i, t := range teams {
		items[i] = map[string]any{
			"id":          t.ID,
			"name":        t.Name,
			"customer_id": t.CustomerID,
			"created_at":  t.CreatedAt,
			"updated_at":  t.UpdatedAt,
		}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"items": items,
			"total": len(items),
		},
	})
}

// listOrgMembers handles GET /api/platform/orgs/{orgId}/members — list members of an organization.
func (h *PlatformOrgHandler) listOrgMembers(ctx *fasthttp.RequestCtx) {
	orgID, _ := ctx.UserValue("orgId").(string)
	if orgID == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Organization ID is required")
		return
	}

	var members []tables.TablePlatformOrgMember
	if err := h.db.Where("org_id = ?", orgID).Find(&members).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to list org members")
		return
	}

	items := make([]map[string]any, len(members))
	for i, m := range members {
		items[i] = map[string]any{
			"org_id":    m.OrgID,
			"user_id":   m.UserID,
			"role":      m.Role,
			"joined_at": m.JoinedAt,
		}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"items": items,
			"total": len(items),
		},
	})
}
