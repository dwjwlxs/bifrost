package handlers

import (
	"fmt"
	"hash/fnv"
	"strconv"
	"strings"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/maximhq/bifrost/transports/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Usage Stats (Epic I-1, I-2, I-3)
// ---------------------------------------------------------------------------

// PlatformUsageOrgHandler handles usage analytics for organizations and teams.
type PlatformUsageOrgHandler struct {
	db    *gorm.DB
	store logstore.LogStore
}

// NewPlatformUsageOrgHandler creates a new PlatformUsageOrgHandler.
func NewPlatformUsageOrgHandler(config *lib.Config) *PlatformUsageOrgHandler {
	return &PlatformUsageOrgHandler{
		db:    config.LogsStore.DB(),
		store: config.LogsStore,
	}
}

// RegisterRoutes registers all usage analytics routes.
// 8 routes pointing to 4 handler implementations:
//   - getUsageOverview: org overview + team overview
//   - getUsageBreakdown: org team/member breakdown + team member breakdown + team my-usage
//   - handleUsageStats: user usage stats (personal)
//   - getUsageStability: user stability (personal)
func (h *PlatformUsageOrgHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	// Org admin routes
	orgAdminMw := make([]schemas.BifrostHTTPMiddleware, len(middlewares), len(middlewares)+1)
	copy(orgAdminMw, middlewares)
	orgAdminMw = append(orgAdminMw, RequireOrgAdmin)

	// Team member routes (read-only access to team overview)
	teamMemberMw := make([]schemas.BifrostHTTPMiddleware, len(middlewares), len(middlewares)+1)
	copy(teamMemberMw, middlewares)
	teamMemberMw = append(teamMemberMw, RequireTeamMember)

	// Team admin routes (full breakdown access)
	teamAdminMw := make([]schemas.BifrostHTTPMiddleware, len(middlewares), len(middlewares)+1)
	copy(teamAdminMw, middlewares)
	teamAdminMw = append(teamAdminMw, RequireTeamAdmin(h.db))

	// Admin middleware
	adminMw := make([]schemas.BifrostHTTPMiddleware, len(middlewares), len(middlewares)+1)
	copy(adminMw, middlewares)
	adminMw = append(adminMw, RequireAdmin)

	usageGroup := r.Group("/api/platform/usage")

	// Overview routes
	usageGroup.GET("/orgs/{orgId}/overview", lib.ChainMiddlewares(h.getUsageOverview, orgAdminMw...))
	usageGroup.GET("/teams/{teamId}/overview", lib.ChainMiddlewares(h.getUsageOverview, teamMemberMw...))

	// Breakdown routes
	usageGroup.GET("/orgs/{orgId}/breakdown", lib.ChainMiddlewares(h.getUsageBreakdown, orgAdminMw...))
	usageGroup.GET("/teams/{teamId}/breakdown", lib.ChainMiddlewares(h.getUsageBreakdown, teamAdminMw...))

	// My-usage route: team_member can see only their own data
	usageGroup.GET("/teams/{teamId}/my-usage", lib.ChainMiddlewares(h.getUsageBreakdown, teamMemberMw...))

	// Admin usage stats
	usageGroup.GET("/admin/stats", lib.ChainMiddlewares(h.handleAdminUsageStats, adminMw...))

}

// ---------------------------------------------------------------------------
// Shared types for usage handlers
// ---------------------------------------------------------------------------

// usageRankingRow represents a single entry in the usage rankings.
type usageRankingRow struct {
	Key      string  `json:"key"`
	Name     string  `json:"name"`
	Requests int64   `json:"requests"`
	Tokens   int64   `json:"tokens"`
	Cost     float64 `json:"cost"`
}

// usageSummaryRow represents the aggregated usage summary.
type usageSummaryRow struct {
	Requests     int64   `json:"requests"`
	InputTokens  int64   `json:"input_tokens"`
	OutputTokens int64   `json:"output_tokens"`
	Tokens       int64   `json:"tokens"`
	Cost         float64 `json:"cost"`
}

// usageDailyRow represents a single day's usage data.
type usageDailyRow struct {
	Date         string  `json:"date"`
	Requests     int64   `json:"requests"`
	InputTokens  int64   `json:"input_tokens"`
	OutputTokens int64   `json:"output_tokens"`
	Tokens       int64   `json:"tokens"`
	Cost         float64 `json:"cost"`
}

// ---------------------------------------------------------------------------
// Handler: getUsageOverview
// ---------------------------------------------------------------------------

func (h *PlatformUsageOrgHandler) getUsageOverview(ctx *fasthttp.RequestCtx) {
	startDate, endDate, ok := parseDateRange(ctx)
	if !ok {
		return
	}

	scope, scopeID, ok := inferScopeFromPath(ctx)
	if !ok {
		return
	}

	// Build WHERE clause based on scope
	var whereClause string
	var args []interface{}
	switch scope {
	case "org":
		whereClause = "customer_id = ?"
		args = []interface{}{scopeID, startDate, endDate, startDate, endDate}
	case "team":
		whereClause = "team_id = ?"
		args = []interface{}{scopeID, startDate, endDate, startDate, endDate}
	default:
		SendError(ctx, 400, "BAD_REQUEST", "invalid scope")
		return
	}

	// Query daily time series
	dailyQuery := fmt.Sprintf(`
		SELECT DATE(timestamp) AS date,
		       COUNT(*) AS requests,
		       COALESCE(SUM(prompt_tokens), 0) AS input_tokens,
		       COALESCE(SUM(completion_tokens), 0) AS output_tokens,
		       COALESCE(SUM(total_tokens), 0) AS tokens,
		       COALESCE(SUM(cost), 0) AS cost
		FROM logs
		WHERE %s AND timestamp >= ? AND timestamp <= ? AND status = 'success'
		GROUP BY DATE(timestamp)
		ORDER BY date ASC`, whereClause)

	var daily []usageDailyRow

	err := h.db.WithContext(ctx).Raw(dailyQuery, args...).Scan(&daily).Error
	if err != nil && !isMissingTableError(err) {
		SendError(ctx, 500, "INTERNAL_ERROR", "failed to query daily usage")
		return
	}
	if daily == nil {
		daily = []usageDailyRow{}
	}

	// Query summary totals
	summaryQuery := fmt.Sprintf(`
		SELECT COUNT(*) AS requests,
		       COALESCE(SUM(prompt_tokens), 0) AS input_tokens,
		       COALESCE(SUM(completion_tokens), 0) AS output_tokens,
		       COALESCE(SUM(total_tokens), 0) AS tokens,
		       COALESCE(SUM(cost), 0) AS cost
		FROM logs
		WHERE %s AND timestamp >= ? AND timestamp <= ? AND status = 'success'`, whereClause)

	var summary usageSummaryRow

	err = h.db.WithContext(ctx).Raw(summaryQuery, args...).Scan(&summary).Error
	if err != nil && !isMissingTableError(err) {
		SendError(ctx, 500, "INTERNAL_ERROR", "failed to query usage summary")
		return
	}
	if isMissingTableError(err) {
		summary = usageSummaryRow{}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"start_date": startDate,
			"end_date":   endDate,
			"summary":    summary,
			"daily":      daily,
		},
	})
}

func CalculateBucketSize(start, end *time.Time) int64 {
	return handlers.CalculateBucketSize(start, end)
}

// ---------------------------------------------------------------------------
// Handler: getUsageBreakdown
// ---------------------------------------------------------------------------

func (h *PlatformUsageOrgHandler) getUsageBreakdown(ctx *fasthttp.RequestCtx) {
	startDate, endDate, ok := parseDateRange(ctx)
	if !ok {
		return
	}

	scope, scopeID, ok := inferScopeFromPath(ctx)
	if !ok {
		return
	}

	dimension := string(ctx.QueryArgs().Peek("dimension"))
	if dimension == "" {
		SendError(ctx, 400, "BAD_REQUEST", "dimension is required (team, member)")
		return
	}

	topN := parseIntQuery(ctx, "top_n", 10)
	if topN < 1 {
		topN = 10
	}
	if topN > 50 {
		topN = 50
	}

	// Validate scope × dimension combination
	if scope == "org" && dimension != "team" && dimension != "member" {
		SendError(ctx, 400, "BAD_REQUEST", "org scope only supports dimension=team or dimension=member")
		return
	}
	if scope == "team" && dimension != "member" {
		SendError(ctx, 400, "BAD_REQUEST", "team scope only supports dimension=member")
		return
	}

	// Determine GROUP BY column based on dimension
	var groupCol string
	switch dimension {
	case "team":
		groupCol = "team_id"
	case "member":
		groupCol = "user_id"
	}

	// Build WHERE clause based on scope
	var whereClause string
	var whereArgs []interface{}
	switch scope {
	case "org":
		whereClause = "customer_id = ?"
		whereArgs = []interface{}{scopeID, startDate, endDate}
	case "team":
		whereClause = "team_id = ?"
		whereArgs = []interface{}{scopeID, startDate, endDate}
	}

	// For my-usage route: team_member can only see their own data
	isMyUsage := strings.Contains(string(ctx.URI().Path()), "/my-usage")
	if isMyUsage {
		userID := GetPlatformUserIDFromContext(ctx)
		if userID == "" {
			SendError(ctx, 401, "UNAUTHORIZED", "user not authenticated")
			return
		}
		whereClause += " AND user_id = ?"
		whereArgs = append(whereArgs, userID)
		// For my-usage, always set topN to 1 since there's only one user
		topN = 1
	}

	// Query rankings (top N + Other)
	rankingsQuery := fmt.Sprintf(`
		SELECT %s AS key,
		       COUNT(*) AS requests,
		       COALESCE(SUM(total_tokens), 0) AS tokens,
		       COALESCE(SUM(cost), 0) AS cost
		FROM logs
		WHERE %s AND timestamp >= ? AND timestamp <= ? AND status = 'success'
		  AND %s IS NOT NULL AND %s != ''
		GROUP BY %s
		ORDER BY requests DESC`, groupCol, whereClause, groupCol, groupCol, groupCol)

	var allRankings []usageRankingRow
	err := h.db.WithContext(ctx).Raw(rankingsQuery, whereArgs...).Scan(&allRankings).Error
	if err != nil && !isMissingTableError(err) {
		SendError(ctx, 500, "INTERNAL_ERROR", "failed to query rankings")
		return
	}
	if allRankings == nil {
		allRankings = []usageRankingRow{}
	}

	// Resolve names for rankings
	topRankings, otherRanking := computeTopNWithOther(allRankings, int(topN))
	h.resolveGroupNames(ctx, topRankings, dimension)

	rankings := make([]map[string]any, 0, len(topRankings)+1)
	for _, r := range topRankings {
		rankings = append(rankings, map[string]any{
			"key":      r.Key,
			"name":     r.Name,
			"requests": r.Requests,
			"tokens":   r.Tokens,
			"cost":     r.Cost,
		})
	}
	if otherRanking != nil {
		rankings = append(rankings, map[string]any{
			"key":      "other",
			"name":     "Other",
			"requests": otherRanking.Requests,
			"tokens":   otherRanking.Tokens,
			"cost":     otherRanking.Cost,
		})
	}

	// Query daily breakdown for top N groups only
	topKeys := make([]string, 0, len(topRankings))
	for _, r := range topRankings {
		topKeys = append(topKeys, r.Key)
	}

	var groups []map[string]any
	if len(topKeys) > 0 {
		groups = h.queryDailyBreakdown(ctx, whereClause, whereArgs, groupCol, topKeys, startDate, endDate, dimension)
	} else {
		groups = []map[string]any{}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"start_date": startDate,
			"end_date":   endDate,
			"rankings":   rankings,
			"groups":     groups,
		},
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// inferScopeFromPath determines scope (org/team) and scopeID from the URL path.
func inferScopeFromPath(ctx *fasthttp.RequestCtx) (scope string, scopeID string, ok bool) {
	path := string(ctx.URI().Path())
	if strings.Contains(path, "/orgs/") {
		orgID, _ := ctx.UserValue("orgId").(string)
		if orgID == "" {
			SendError(ctx, 400, "BAD_REQUEST", "orgId is required")
			return "", "", false
		}
		return "org", orgID, true
	}
	if strings.Contains(path, "/teams/") {
		teamID, _ := ctx.UserValue("teamId").(string)
		if teamID == "" {
			SendError(ctx, 400, "BAD_REQUEST", "teamId is required")
			return "", "", false
		}
		return "team", teamID, true
	}
	SendError(ctx, 400, "BAD_REQUEST", "invalid usage path")
	return "", "", false
}

// parseDateRange extracts and validates start_date and end_date query params.
func parseDateRange(ctx *fasthttp.RequestCtx) (startDate, endDate string, ok bool) {
	startDate = string(ctx.QueryArgs().Peek("start_date"))
	endDate = string(ctx.QueryArgs().Peek("end_date"))
	if startDate == "" || endDate == "" {
		SendError(ctx, 400, "BAD_REQUEST", "start_date and end_date are required (YYYY-MM-DD)")
		return "", "", false
	}
	// Validate format
	for _, d := range []string{startDate, endDate} {
		if _, err := time.Parse("2006-01-02", d); err != nil {
			SendError(ctx, 400, "BAD_REQUEST", fmt.Sprintf("invalid date format: %s, expected YYYY-MM-DD", d))
			return "", "", false
		}
	}
	return startDate, endDate, true
}

// computeTopNWithOther splits rankings into top N and aggregates the rest as "Other".
func computeTopNWithOther(rankings []usageRankingRow, topN int) (top []usageRankingRow, other *usageRankingRow) {
	if len(rankings) <= topN {
		return rankings, nil
	}

	top = rankings[:topN]
	otherAgg := usageRankingRow{Key: "other", Name: "Other"}
	for _, r := range rankings[topN:] {
		otherAgg.Requests += r.Requests
		otherAgg.Tokens += r.Tokens
		otherAgg.Cost += r.Cost
	}
	return top, &otherAgg
}

// resolveGroupNames resolves entity names for ranking rows by querying the DB.
func (h *PlatformUsageOrgHandler) resolveGroupNames(ctx *fasthttp.RequestCtx, rankings []usageRankingRow, dimension string) {
	if len(rankings) == 0 {
		return
	}

	switch dimension {
	case "team":
		ids := make([]string, len(rankings))
		for i, r := range rankings {
			ids[i] = r.Key
		}
		type nameRow struct {
			ID   string `gorm:"column:id"`
			Name string `gorm:"column:name"`
		}
		var names []nameRow
		err := h.db.WithContext(ctx).Table("platform_teams").Select("id, name").
			Where("id IN ?", ids).Scan(&names).Error
		if err != nil {
			return
		}
		nameMap := make(map[string]string, len(names))
		for _, n := range names {
			nameMap[n.ID] = n.Name
		}
		for i := range rankings {
			if name, ok := nameMap[rankings[i].Key]; ok {
				rankings[i].Name = name
			} else {
				rankings[i].Name = rankings[i].Key
			}
		}

	case "member":
		ids := make([]string, len(rankings))
		for i, r := range rankings {
			ids[i] = r.Key
		}
		type nameRow struct {
			ID       string `gorm:"column:id"`
			Username string `gorm:"column:username"`
		}
		var names []nameRow
		err := h.db.WithContext(ctx).Table("platform_users").Select("id, username").
			Where("id IN ?", ids).Scan(&names).Error
		if err != nil {
			return
		}
		nameMap := make(map[string]string, len(names))
		for _, n := range names {
			nameMap[n.ID] = n.Username
		}
		for i := range rankings {
			if name, ok := nameMap[rankings[i].Key]; ok {
				rankings[i].Name = name
			} else {
				rankings[i].Name = rankings[i].Key
			}
		}
	}
}

// queryDailyBreakdown queries daily usage per group for the given top N keys.
func (h *PlatformUsageOrgHandler) queryDailyBreakdown(
	ctx *fasthttp.RequestCtx,
	whereClause string,
	whereArgs []interface{},
	groupCol string,
	topKeys []string,
	startDate, endDate string,
	dimension string,
) []map[string]any {
	// Build IN clause placeholders
	placeholders := make([]string, len(topKeys))
	inArgs := make([]interface{}, len(topKeys))
	for i, k := range topKeys {
		placeholders[i] = "?"
		inArgs[i] = k
	}

	query := fmt.Sprintf(`
		SELECT %s AS group_key,
		       DATE(timestamp) AS date,
		       COUNT(*) AS requests,
		       COALESCE(SUM(total_tokens), 0) AS tokens,
		       COALESCE(SUM(cost), 0) AS cost
		FROM logs
		WHERE %s AND timestamp >= ? AND timestamp <= ? AND status = 'success'
		  AND %s IN (%s)
		GROUP BY %s, DATE(timestamp)
		ORDER BY group_key, date ASC`,
		groupCol, whereClause, groupCol, strings.Join(placeholders, ","), groupCol)

	args := append(whereArgs, inArgs...)

	type dailyGroupRow struct {
		GroupKey string  `json:"group_key"`
		Date     string  `json:"date"`
		Requests int64   `json:"requests"`
		Tokens   int64   `json:"tokens"`
		Cost     float64 `json:"cost"`
	}

	var rows []dailyGroupRow
	err := h.db.WithContext(ctx).Raw(query, args...).Scan(&rows).Error
	if err != nil && !isMissingTableError(err) {
		return []map[string]any{}
	}
	if rows == nil {
		rows = []dailyGroupRow{}
	}

	// Group by group_key
	groupMap := make(map[string][]map[string]any)
	groupOrder := make([]string, 0) // preserve top N order
	for _, k := range topKeys {
		groupOrder = append(groupOrder, k)
		groupMap[k] = []map[string]any{}
	}
	for _, r := range rows {
		entry := map[string]any{
			"date":     r.Date,
			"requests": r.Requests,
			"tokens":   r.Tokens,
			"cost":     r.Cost,
		}
		groupMap[r.GroupKey] = append(groupMap[r.GroupKey], entry)
	}

	// Resolve names
	nameMap := h.resolveNamesBatch(ctx, topKeys, dimension)

	result := make([]map[string]any, 0, len(topKeys))
	for _, key := range groupOrder {
		daily, ok := groupMap[key]
		if !ok {
			daily = []map[string]any{}
		}
		name := key
		if n, ok := nameMap[key]; ok {
			name = n
		}
		result = append(result, map[string]any{
			"key":   key,
			"name":  name,
			"daily": daily,
		})
	}

	return result
}

// resolveNamesBatch resolves names for a batch of entity IDs.
func (h *PlatformUsageOrgHandler) resolveNamesBatch(ctx *fasthttp.RequestCtx, ids []string, dimension string) map[string]string {
	if len(ids) == 0 {
		return map[string]string{}
	}

	switch dimension {
	case "team":
		type nameRow struct {
			ID   string `gorm:"column:id"`
			Name string `gorm:"column:name"`
		}
		var names []nameRow
		err := h.db.WithContext(ctx).Table("platform_teams").Select("id, name").
			Where("id IN ?", ids).Scan(&names).Error
		if err != nil {
			return map[string]string{}
		}
		result := make(map[string]string, len(names))
		for _, n := range names {
			result[n.ID] = n.Name
		}
		return result

	case "member":
		type nameRow struct {
			ID       string `gorm:"column:id"`
			Username string `gorm:"column:username"`
		}
		var names []nameRow
		err := h.db.WithContext(ctx).Table("platform_users").Select("id, username").
			Where("id IN ?", ids).Scan(&names).Error
		if err != nil {
			return map[string]string{}
		}
		result := make(map[string]string, len(names))
		for _, n := range names {
			result[n.ID] = n.Username
		}
		return result

	default:
		return map[string]string{}
	}
}

// ---- Helpers ----

// hashStringToInt64 converts a string (e.g. UUID) to a deterministic int64
// for use as a frontend-facing numeric ID.
func hashStringToInt64(s string) int64 {
	h := fnv.New64a()
	h.Write([]byte(s))
	return int64(h.Sum64())
}

// derefString returns the value if ptr is non-nil, otherwise returns defaultVal.
func derefString(ptr *string, defaultVal string) string {
	if ptr == nil {
		return defaultVal
	}
	return *ptr
}

// derefFloat64 returns the value if ptr is non-nil, otherwise returns defaultVal.
func derefFloat64(ptr *float64, defaultVal float64) float64 {
	if ptr == nil {
		return defaultVal
	}
	return *ptr
}

// ---------------------------------------------------------------------------
// Usage Stats types (moved from platform_billing.go)
// ---------------------------------------------------------------------------

// usageStatRow represents a single row in the usage stats breakdown.
type usageStatRow struct {
	Key             string  `json:"key"`
	CallCount       int64   `json:"call_count"`
	InputTokens     int64   `json:"input_tokens"`
	OutputTokens    int64   `json:"output_tokens"`
	TotalTokens     int64   `json:"total_tokens"`
	CreditsConsumed float64 `json:"credits_consumed"`
}

// usageStatSummary represents the summary totals for usage stats.
type usageStatSummary struct {
	TotalCalls   int64   `json:"total_calls"`
	TotalTokens  int64   `json:"total_tokens"`
	TotalCredits float64 `json:"total_credits"`
}

// ---------------------------------------------------------------------------
// Usage Stats handlers
// ---------------------------------------------------------------------------

// handleUsageStats handles GET /api/platform/usage/me/stats.
// Query params: start_date (YYYY-MM-DD), end_date (YYYY-MM-DD), group_by (day|provider|model|virtual_key)
func (h *PlatformUsageOrgHandler) handleUsageStats(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	startDate := string(ctx.QueryArgs().Peek("start_date"))
	endDate := string(ctx.QueryArgs().Peek("end_date"))
	if startDate == "" || endDate == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "start_date and end_date are required")
		return
	}

	groupBy := string(ctx.QueryArgs().Peek("group_by"))
	if groupBy == "" {
		groupBy = "day"
	}

	// Build WHERE clause - user can only see their own data
	whereClause := "user_id = ? AND timestamp >= ? AND timestamp <= ?"
	whereArgs := []interface{}{claims.UserID, startDate + " 00:00:00", endDate + " 23:59:59"}

	var groupCol string
	switch groupBy {
	case "day":
		groupCol = "DATE(timestamp)"
	case "provider":
		groupCol = "provider"
	case "model":
		groupCol = "model"
	case "virtual_key":
		groupCol = "virtual_key_id"
	default:
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "group_by must be one of: day, provider, model, virtual_key")
		return
	}

	// Query breakdown
	detailsQuery := fmt.Sprintf(`
		SELECT %s AS key,
		       COUNT(*) AS call_count,
		       COALESCE(SUM(prompt_tokens), 0) AS input_tokens,
		       COALESCE(SUM(completion_tokens), 0) AS output_tokens,
		       COALESCE(SUM(total_tokens), 0) AS total_tokens,
		       COALESCE(SUM(cost), 0) AS credits_consumed
		FROM logs
		WHERE %s AND status = 'success'
		GROUP BY %s
		ORDER BY call_count DESC
		LIMIT 100`, groupCol, whereClause, groupCol)

	var details []usageStatRow
	err := h.db.WithContext(ctx).Raw(detailsQuery, whereArgs...).Scan(&details).Error
	if err != nil && !isMissingTableError(err) {
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to query usage stats")
		return
	}
	if details == nil {
		details = []usageStatRow{}
	}

	// Query summary totals
	summaryQuery := fmt.Sprintf(`
		SELECT COUNT(*) AS total_calls,
		       COALESCE(SUM(total_tokens), 0) AS total_tokens,
		       COALESCE(SUM(cost), 0) AS total_credits
		FROM logs
		WHERE %s AND status = 'success'`, whereClause)

	var summary usageStatSummary
	err = h.db.WithContext(ctx).Raw(summaryQuery, whereArgs...).Scan(&summary).Error
	if err != nil && !isMissingTableError(err) {
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to query usage summary")
		return
	}
	if isMissingTableError(err) {
		summary = usageStatSummary{}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"start_date": startDate,
			"end_date":   endDate,
			"group_by":   groupBy,
			"summary": map[string]any{
				"total_calls":   summary.TotalCalls,
				"total_tokens":  summary.TotalTokens,
				"total_credits": summary.TotalCredits,
			},
			"details": details,
		},
	})
}

// handleAdminUsageStats handles GET /api/platform/usage/admin/stats.
// Query params: start_date, end_date, group_by, user_id (optional), customer_id (optional), team_id (optional)
func (h *PlatformUsageOrgHandler) handleAdminUsageStats(ctx *fasthttp.RequestCtx) {
	startDate := string(ctx.QueryArgs().Peek("start_date"))
	endDate := string(ctx.QueryArgs().Peek("end_date"))
	if startDate == "" || endDate == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "start_date and end_date are required")
		return
	}

	groupBy := string(ctx.QueryArgs().Peek("group_by"))
	if groupBy == "" {
		groupBy = "day"
	}

	userID := string(ctx.QueryArgs().Peek("user_id"))
	customerID := string(ctx.QueryArgs().Peek("customer_id"))
	teamID := string(ctx.QueryArgs().Peek("team_id"))

	// Build WHERE clause based on filters
	whereClause := "timestamp >= ? AND timestamp <= ?"
	whereArgs := []interface{}{startDate + " 00:00:00", endDate + " 23:59:59"}

	if userID != "" {
		whereClause += " AND user_id = ?"
		whereArgs = append(whereArgs, userID)
	}
	if customerID != "" {
		whereClause += " AND customer_id = ?"
		whereArgs = append(whereArgs, customerID)
	}
	if teamID != "" {
		whereClause += " AND team_id = ?"
		whereArgs = append(whereArgs, teamID)
	}

	var groupCol string
	switch groupBy {
	case "day":
		groupCol = "DATE(timestamp)"
	case "provider":
		groupCol = "provider"
	case "model":
		groupCol = "model"
	case "virtual_key":
		groupCol = "virtual_key_id"
	default:
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "group_by must be one of: day, provider, model, virtual_key")
		return
	}

	// Query breakdown
	detailsQuery := fmt.Sprintf(`
		SELECT %s AS key,
		       COUNT(*) AS call_count,
		       COALESCE(SUM(prompt_tokens), 0) AS input_tokens,
		       COALESCE(SUM(completion_tokens), 0) AS output_tokens,
		       COALESCE(SUM(total_tokens), 0) AS total_tokens,
		       COALESCE(SUM(cost), 0) AS credits_consumed
		FROM logs
		WHERE %s AND status = 'success'
		GROUP BY %s
		ORDER BY call_count DESC
		LIMIT 100`, groupCol, whereClause, groupCol)

	var details []usageStatRow
	err := h.db.WithContext(ctx).Raw(detailsQuery, whereArgs...).Scan(&details).Error
	if err != nil && !isMissingTableError(err) {
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to query usage stats")
		return
	}
	if details == nil {
		details = []usageStatRow{}
	}

	// Query summary totals
	summaryQuery := fmt.Sprintf(`
		SELECT COUNT(*) AS total_calls,
		       COALESCE(SUM(total_tokens), 0) AS total_tokens,
		       COALESCE(SUM(cost), 0) AS total_credits
		FROM logs
		WHERE %s AND status = 'success'`, whereClause)

	var summary usageStatSummary
	err = h.db.WithContext(ctx).Raw(summaryQuery, whereArgs...).Scan(&summary).Error
	if err != nil && !isMissingTableError(err) {
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to query usage summary")
		return
	}
	if isMissingTableError(err) {
		summary = usageStatSummary{}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"start_date": startDate,
			"end_date":   endDate,
			"group_by":   groupBy,
			"summary": map[string]any{
				"total_calls":   summary.TotalCalls,
				"total_tokens":  summary.TotalTokens,
				"total_credits": summary.TotalCredits,
			},
			"details": details,
		},
	})
}

// ---------------------------------------------------------------------------
// Usage Stability types (moved from platform_billing.go)
// ---------------------------------------------------------------------------

// stabilitySeriesEntry represents a single series entry for dimension=all.
type stabilitySeriesEntry struct {
	Date         string  `json:"date"`
	AvgLatency   float64 `json:"avg_latency"`
	P90          float64 `json:"p90"`
	P95          float64 `json:"p95"`
	P99          float64 `json:"p99"`
	SuccessCount int64   `json:"success_count"`
	ErrorCount   int64   `json:"error_count"`
	SuccessRate  float64 `json:"success_rate"`
}

// stabilitySeriesEntryByDimension represents a series entry when grouping by provider/model.
type stabilitySeriesEntryByDimension struct {
	Key          string  `json:"key"`
	AvgLatency   float64 `json:"avg_latency"`
	P90          float64 `json:"p90"`
	P95          float64 `json:"p95"`
	P99          float64 `json:"p99"`
	SuccessCount int64   `json:"success_count"`
	ErrorCount   int64   `json:"error_count"`
	SuccessRate  float64 `json:"success_rate"`
}

// stabilityDailyGroup represents a day's data when grouping by provider/model.
type stabilityDailyGroup struct {
	Date   string                            `json:"date"`
	Series []stabilitySeriesEntryByDimension `json:"series"`
}

// isMissingTableError returns true if the error indicates the logs table
// does not exist in the current database (e.g., separate logstore DB).
func isMissingTableError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	return contains(errStr, "doesn't exist") ||
		contains(errStr, "does not exist") ||
		contains(errStr, "Unknown table") ||
		contains(errStr, "relation") && contains(errStr, "does not exist")
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && func() bool {
		for i := 0; i <= len(s)-len(substr); i++ {
			if s[i:i+len(substr)] == substr {
				return true
			}
		}
		return false
	}()
}

// parseIntQuery parses an integer query parameter with a default value.
func parseIntQuery(ctx *fasthttp.RequestCtx, key string, defaultVal int64) int64 {
	val := string(ctx.QueryArgs().Peek(key))
	if val == "" {
		return defaultVal
	}
	n, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return defaultVal
	}
	return n
}
