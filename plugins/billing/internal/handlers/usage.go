package handlers

import (
	"fmt"
	"strings"
	"time"

	"github.com/dwjwlxs/bifrost/plugins/billing/internal/config"
	"github.com/dwjwlxs/bifrost/plugins/billing/internal/services/console"
	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/maximhq/bifrost/transports/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

// ---------------------------------------------------------------------------
// Usage Stats (Epic I-1, I-2, I-3)
// ---------------------------------------------------------------------------

// PlatformUsageHandler handles usage analytics for organizations and teams.
type PlatformUsageHandler struct {
	store logstore.LogStore
}

// NewPlatformUsageHandler creates a new PlatformUsageHandler.
func NewPlatformUsageHandler(config *config.BillingPluginConfig) *PlatformUsageHandler {
	return &PlatformUsageHandler{
		store: config.Config.LogsStore,
	}
}

// RegisterRoutes registers all usage analytics routes.
// 8 routes pointing to 4 handler implementations:
//   - getUsageOverview: org overview + team overview
//   - getUsageBreakdown: org team/member breakdown + team member breakdown + team my-usage
//   - handleUsageStats: user usage stats (personal)
//   - getUsageStability: user stability (personal)
func (h *PlatformUsageHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	// Personal usage (user-facing)
	usageGroup := r.Group("/api/platform/usage")

	// Personal usage stats (user-facing) - using logstore methods
	usageGroup.GET("/me/stats", lib.ChainMiddlewares(h.getMeStats, middlewares...))
	// GET /me/stats/trend 分别使用store.GetHistogram GetTokenHistogram GetCostHistogram 实现
	usageGroup.GET("/me/stats/trend", lib.ChainMiddlewares(h.getMeStatsTrend, middlewares...))
	// GET /me/distribution 使用类似store.GetUserRankings的方式但支持指定维度字段，分别统计3个指标的指定维度分布情况
	usageGroup.GET("/me/distribution", lib.ChainMiddlewares(h.getMeDistribution, middlewares...))
	// Personal usage stability (user-facing) 需要返回这个时间段p90 p95 p99 和 avg latency，以及 success rate, 并使用store.GetLatencyHistogram实现柱形图数据
	usageGroup.GET("/me/stability", lib.ChainMiddlewares(h.getMeStability, middlewares...))
}

// ---------------------------------------------------------------------------
// User-facing personal usage handlers (using logstore methods)
// ---------------------------------------------------------------------------

// getMeStats returns personal usage statistics for the authenticated user.
// GET /api/platform/usage/me/stats?start_date=2024-01-01&end_date=2024-01-31
func (h *PlatformUsageHandler) getMeStats(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	filters, err := h.buildUserFilters(ctx, claims)
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	stats, err := h.store.GetStats(ctx, filters)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to query usage stats")
		return
	}

	if stats == nil {
		stats = &logstore.SearchStats{}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    stats,
	})
}

// getMeTrend returns usage trend data (request count, tokens, cost) over time.
// GET /api/platform/usage/me/stats/trend?start_date=2024-01-01&end_date=2024-01-31&bucket_size=86400
func (h *PlatformUsageHandler) getMeStatsTrend(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	filters, err := h.buildUserFilters(ctx, claims)
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	bucketSizeSeconds := h.parseBucketSize(filters)

	// Fetch all three histograms
	hist, err := h.store.GetHistogram(ctx, filters, bucketSizeSeconds)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to query request histogram")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    hist,
	})
}

// getMeStatsDistribution returns usage distribution across a specified dimension.
// GET /api/platform/usage/me/distribution?start_date=2024-01-01&end_date=2024-01-31&dimension=provider
func (h *PlatformUsageHandler) getMeDistribution(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	filters, err := h.buildUserFilters(ctx, claims)
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	dimension := logstore.HistogramDimension(string(ctx.QueryArgs().Peek("dimension")))
	if !dimension.Valid() {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "dimension is not allowed")
		return
	}

	rankings, err := h.store.GetDimensionRankings(ctx, filters, dimension)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to query distribution")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data":    rankings,
	})
}

// getMeStability returns stability metrics for the authenticated user.
// GET /api/platform/usage/me/stability?start_date=2024-01-01&end_date=2024-01-31
func (h *PlatformUsageHandler) getMeStability(ctx *fasthttp.RequestCtx) {
	claims := GetPlatformClaimsFromContext(ctx)
	if claims == nil {
		SendError(ctx, fasthttp.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}

	filters, err := h.buildUserFilters(ctx, claims)
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	dimension := logstore.HistogramDimension(string(ctx.QueryArgs().Peek("dimension")))
	if dimension != "" && !dimension.Valid() {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "dimension must be one of: all, provider, model")
		return
	}

	bucketSizeSeconds := h.parseBucketSize(filters)

	if dimension == "" {
		h.buildStabilityAll(ctx, filters, bucketSizeSeconds)
	} else {
		h.buildStabilityByDimension(ctx, filters, bucketSizeSeconds, string(dimension))
	}
}

// buildStabilityAll builds the stability response for dimension=all using store.GetLatencyHistogram.
func (h *PlatformUsageHandler) buildStabilityAll(ctx *fasthttp.RequestCtx, filters logstore.SearchFilters, bucketSize int64) {
	latencyHist, err := h.store.GetLatencyHistogram(ctx, filters, bucketSize)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to query stability data")
		return
	}

	buckets := latencyHist.Buckets
	if buckets == nil {
		buckets = []logstore.LatencyHistogramBucket{}
	}

	// Calculate summary from buckets
	var totalRequests, totalSuccess int64
	var weightedLatency float64
	var totalWeight int64
	for _, b := range buckets {
		totalRequests += b.TotalRequests
		totalSuccess += b.Success
		if b.TotalRequests > 0 {
			weightedLatency += b.AvgLatency * float64(b.TotalRequests)
			totalWeight += b.TotalRequests
		}
	}

	var avgLatency float64
	if totalWeight > 0 {
		avgLatency = weightedLatency / float64(totalWeight)
	}

	var successRate float64
	if totalRequests > 0 {
		successRate = float64(totalSuccess) / float64(totalRequests)
	}

	// Use p90/p95/p99 from the last bucket if available (approximation from store)
	var p90, p95, p99 float64
	for i := len(buckets) - 1; i >= 0; i-- {
		last := buckets[i]
		if last.TotalRequests > 0 {
			p90 = last.P90Latency
			p95 = last.P95Latency
			p99 = last.P99Latency
			break
		}
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"summary": map[string]any{
				"avg_latency":   avgLatency,
				"p90_latency":   p90,
				"p95_latency":   p95,
				"p99_latency":   p99,
				"success_rate":  successRate,
				"total_success": totalSuccess,
				"total_error":   totalRequests - totalSuccess,
			},
			"buckets": buckets,
		},
	})
}

// buildStabilityByDimension builds the stability response for a specific dimension using store.GetDimensionLatencyHistogram.
func (h *PlatformUsageHandler) buildStabilityByDimension(ctx *fasthttp.RequestCtx, filters logstore.SearchFilters, bucketSize int64, dimension string) {
	dim := logstore.HistogramDimension(dimension)
	if !dim.Valid() {
		SendError(ctx, fasthttp.StatusBadRequest, "BAD_REQUEST", "dimension is not allowed")
		return
	}

	latencyDist, err := h.store.GetDimensionLatencyHistogram(ctx, filters, bucketSize, dim)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "INTERNAL_ERROR", "Failed to query stability distribution")
		return
	}

	SendJSON(ctx, map[string]any{
		"code":    "0",
		"message": "success",
		"data": map[string]any{
			"dimension":        dimension,
			"dimension_values": latencyDist.DimensionValues,
			"buckets":          latencyDist.Buckets,
		},
	})
}

// ---------------------------------------------------------------------------
// Shared helpers for user-facing handlers
// ---------------------------------------------------------------------------

// buildUserFilters constructs SearchFilters for the authenticated user from query params.
func (h *PlatformUsageHandler) buildUserFilters(ctx *fasthttp.RequestCtx, claims *console.PlatformClaims) (logstore.SearchFilters, error) {
	startDate := string(ctx.QueryArgs().Peek("start_date"))
	endDate := string(ctx.QueryArgs().Peek("end_date"))
	if startDate == "" || endDate == "" {
		return logstore.SearchFilters{}, fmt.Errorf("start_date and end_date are required")
	}

	startTime, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		return logstore.SearchFilters{}, fmt.Errorf("invalid start_date format, expected YYYY-MM-DD")
	}
	endTime, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		return logstore.SearchFilters{}, fmt.Errorf("invalid end_date format, expected YYYY-MM-DD")
	}
	// Set endTime to end of day
	endTime = endTime.Add(23*time.Hour + 59*time.Minute + 59*time.Second)

	filters := logstore.SearchFilters{
		UserIDs:   []string{claims.UserID},
		StartTime: &startTime,
		EndTime:   &endTime,
	}

	// Optional filters
	if providers := string(ctx.QueryArgs().Peek("providers")); providers != "" {
		filters.Providers = strings.Split(providers, ",")
	}
	if models := string(ctx.QueryArgs().Peek("models")); models != "" {
		filters.Models = strings.Split(models, ",")
	}
	if status := string(ctx.QueryArgs().Peek("status")); status != "" {
		filters.Status = strings.Split(status, ",")
	}

	return filters, nil
}

// parseBucketSize parses the bucket_size (in seconds), defaulting to 86400 (1 hour).
func (h *PlatformUsageHandler) parseBucketSize(filters logstore.SearchFilters) int64 {
	return handlers.CalculateBucketSize(filters.StartTime, filters.EndTime)
}
