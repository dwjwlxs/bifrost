package handlers

import (
	"github.com/maximhq/bifrost/transports/bifrost-http/handlers"
	"github.com/valyala/fasthttp"
)

// sendJSON sends a JSON response with 200 OK status.
func sendJSON(ctx *fasthttp.RequestCtx, data interface{}) {
	sendJSONWithStatus(ctx, data, 200)
}

// sendJSONWithStatus sends a JSON response with a custom status code
func sendJSONWithStatus(ctx *fasthttp.RequestCtx, data interface{}, statusCode int) {
	handlers.SendJSONWithStatus(ctx, data, statusCode)
}

// sendError sends a BifrostError response.
func sendError(ctx *fasthttp.RequestCtx, statusCode int, code string, message string) {
	handlers.SendJSONWithStatus(ctx, map[string]any{
		"code":    code,
		"message": message,
	}, statusCode)
}
