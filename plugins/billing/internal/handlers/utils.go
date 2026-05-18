package handlers

import (
	"github.com/bytedance/sonic"
	"github.com/valyala/fasthttp"
)

func SendJSON(ctx *fasthttp.RequestCtx, data interface{}) {
	SendJSONWithStatus(ctx, data, fasthttp.StatusOK)
}

func SendJSONWithStatus(ctx *fasthttp.RequestCtx, data interface{}, statusCode int) {
	ctx.SetStatusCode(statusCode)
	ctx.SetContentType("application/json")
	b, err := sonic.Marshal(data)
	if err != nil {
		ctx.SetBodyString(`{"code":"1","message":"internal error"}`)
		return
	}
	ctx.SetBody(b)
}

func SendError(ctx *fasthttp.RequestCtx, statusCode int, code, message string) {
	SendJSONWithStatus(ctx, map[string]any{
		"code":    code,
		"message": message,
	}, statusCode)
}
