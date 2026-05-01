package handlers

import (
	"encoding/json"
	"log"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/valyala/fasthttp"
)

// SendJSON sends a JSON response with 200 OK status.
func SendJSON(ctx *fasthttp.RequestCtx, data interface{}) {
	ctx.SetContentType("application/json")
	if err := json.NewEncoder(ctx).Encode(data); err != nil {
		log.Printf("WARN: Failed to encode JSON response: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Internal encoding error")
	}
}

// SendError sends a BifrostError response.
func SendError(ctx *fasthttp.RequestCtx, statusCode int, message string) {
	bifrostErr := &schemas.BifrostError{
		IsBifrostError: false,
		StatusCode:     &statusCode,
		Error: &schemas.ErrorField{
			Message: message,
		},
	}
	SendBifrostError(ctx, bifrostErr)
}

// SendBifrostError sends a BifrostError response.
func SendBifrostError(ctx *fasthttp.RequestCtx, bifrostErr *schemas.BifrostError) {
	if bifrostErr.StatusCode != nil {
		ctx.SetStatusCode(*bifrostErr.StatusCode)
	} else if !bifrostErr.IsBifrostError {
		ctx.SetStatusCode(fasthttp.StatusBadRequest)
	} else {
		ctx.SetStatusCode(fasthttp.StatusInternalServerError)
	}

	ctx.SetContentType("application/json")
	if encodeErr := json.NewEncoder(ctx).Encode(bifrostErr); encodeErr != nil {
		log.Printf("WARN: Failed to encode error response: %v", encodeErr)
		ctx.SetStatusCode(fasthttp.StatusInternalServerError)
		ctx.SetBodyString("Internal server error")
	}
}
