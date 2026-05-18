package handlers

import (
	"time"

	"github.com/valyala/fasthttp"
)

// Cookie name for refresh token (httpOnly, sent automatically on refresh requests)
const refreshTokenCookieName = "platform_refresh_token"

// setRefreshTokenCookie sets an httpOnly cookie with the refresh token.
func setRefreshTokenCookie(ctx *fasthttp.RequestCtx, token string, expiresAt time.Time) {
	cookie := fasthttp.AcquireCookie()
	defer fasthttp.ReleaseCookie(cookie)
	cookie.SetKey(refreshTokenCookieName)
	cookie.SetValue(token)
	cookie.SetExpire(expiresAt)
	cookie.SetPath("/")
	cookie.SetHTTPOnly(true)
	// SameSite=Lax: cookie sent with same-site top-level GET navigations.
	// For cross-origin AJAX with credentials, use SameSite=None; Secure.
	// Using Lax is safe when API and frontend share the same root domain.
	cookie.SetSameSite(fasthttp.CookieSameSiteLaxMode)
	// Set Secure flag when behind HTTPS proxy (production)
	if string(ctx.Request.Header.Peek("X-Forwarded-Proto")) == "https" {
		cookie.SetSecure(true)
	}
	ctx.Response.Header.SetCookie(cookie)
}

// getRefreshTokenFromCookie reads the refresh token from the httpOnly cookie.
func getRefreshTokenFromCookie(ctx *fasthttp.RequestCtx) string {
	return string(ctx.Request.Header.Cookie(refreshTokenCookieName))
}

// clearRefreshTokenCookie removes the httpOnly refresh token cookie by setting Max-Age=0.
func clearRefreshTokenCookie(ctx *fasthttp.RequestCtx) {
	cookie := fasthttp.AcquireCookie()
	defer fasthttp.ReleaseCookie(cookie)
	cookie.SetKey(refreshTokenCookieName)
	cookie.SetValue("")
	cookie.SetMaxAge(0)
	cookie.SetPath("/")
	cookie.SetHTTPOnly(true)
	cookie.SetSameSite(fasthttp.CookieSameSiteLaxMode)
	if string(ctx.Request.Header.Peek("X-Forwarded-Proto")) == "https" {
		cookie.SetSecure(true)
	}
	ctx.Response.Header.SetCookie(cookie)
}
