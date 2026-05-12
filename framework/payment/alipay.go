package payment

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/maximhq/bifrost/framework/configstore/tables"
)

var _ PaymentGateway = (*AliPayGateway)(nil)

// AliPayGateway implements PaymentGateway using Alipay Checkout.
// It calls the Alipay REST API directly (no external SDK dependency).
type AliPayGateway struct {
	appID           string
	privateKey      string
	alipayPublicKey string
	httpClient      *http.Client
	host            string
}

// newAliPayGateway creates a new AliPayGateway from config.
func newAliPayGateway(cfg *AliPayConfig, baseURL string) *AliPayGateway {
	host := baseURL
	if host == "" {
		host = "https://openapi.alipay.com"
	}
	return &AliPayGateway{
		appID:           cfg.AppID,
		privateKey:      cfg.PrivateKey,
		alipayPublicKey: cfg.AlipayPublicKey,
		httpClient:      &http.Client{Timeout: 30 * time.Second},
		host:            host,
	}
}

// GatewayID returns the gateway identifier.
func (g *AliPayGateway) GatewayID() string { return "alipay" }

// CreatePayment creates an Alipay trade page and returns the redirect URL.
//
// Flow:
//  1. Call Alipay统一收单下单接口 (trade_page_pay) with return_url
//  2. Return the form HTML / redirect URL from Alipay response
//  3. User pays on Alipay page, then redirected back to return_url
func (g *AliPayGateway) CreatePayment(ctx context.Context, order *tables.TablePlatformOrder, opts PaymentOptions) (*PaymentResult, error) {
	outTradeNo := order.OrderNo
	totalAmount := fmt.Sprintf("%.2f", order.Amount)
	subject := orderDescription(order)

	// Alipay trade parameters
	params := url.Values{}
	params.Set("app_id", g.appID)
	params.Set("method", "alipay.trade.page.pay")
	params.Set("charset", "utf-8")
	params.Set("sign_type", "RSA2")
	params.Set("timestamp", time.Now().Format("2006-01-02 15:04:05"))
	params.Set("version", "1.0")
	params.Set("biz_content", mapToJSON(map[string]any{
		"out_trade_no": outTradeNo,
		"product_code": "FAST_INSTANT_TRADE_PAY",
		"total_amount": totalAmount,
		"subject":       subject,
		"timeout_express": "30m",
	}))
	params.Set("return_url", opts.ReturnURL)

	// Sign the request
	sign := g.sign(params)
	params.Set("sign", sign)

	// Build the payment URL
	payURL := g.host + "/gateway.do?" + params.Encode()

	return &PaymentResult{
		PaymentID:  outTradeNo,
		CheckoutURL: payURL,
		ExpiresAt:   "", // Alipay doesn't give a session expiry in this flow
		Status:      "pending",
	}, nil
}

// HandleWebhook processes an Alipay asynchronous notification (IPN).
//
// Alipay notifies via POST to notify_url with these fields:
// - trade_status: TRADE_SUCCESS, TRADE_CLOSED, etc.
// - out_trade_no: our order number
//
// For now, AliPayGateway returns an error indicating webhook handling
// is not yet implemented. IpcClient must configure the notify_url
// to point to the appropriate webhook handler.
func (g *AliPayGateway) HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookResult, error) {
	// TODO: Parse Alipay notify payload, verify sign, return WebhookResult
	// Alipay webhook verification uses RSA2 public key, different from Stripe HMAC.
	return nil, fmt.Errorf("alipay webhook handling not implemented: configure notify_url and implement RSA verification")
}

// VerifyPayment queries an Alipay trade status.
func (g *AliPayGateway) VerifyPayment(ctx context.Context, paymentID string) (*PaymentStatus, error) {
	params := url.Values{}
	params.Set("app_id", g.appID)
	params.Set("method", "alipay.trade.query")
	params.Set("charset", "utf-8")
	params.Set("sign_type", "RSA2")
	params.Set("timestamp", time.Now().Format("2006-01-02 15:04:05"))
	params.Set("version", "1.0")
	params.Set("biz_content", mapToJSON(map[string]any{
		"out_trade_no": paymentID,
	}))

	sign := g.sign(params)
	params.Set("sign", sign)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.host+"/gateway.do", strings.NewReader(params.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create alipay request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("alipay API call: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read alipay response: %w", err)
	}

	// Parse Alipay response: { "alipay_trade_query_response": { "trade_status": "...", "total_amount": "..." } }
	var ar alipayResponse
	if err := json.Unmarshal(body, &ar); err != nil {
		return nil, fmt.Errorf("parse alipay response: %w", err)
	}

	if ar.AliPayResponse.Code != "10000" {
		return nil, fmt.Errorf("alipay query error: %s - %s", ar.AliPayResponse.Code, ar.AliPayResponse.Msg)
	}

	status := "pending"
	switch ar.AliPayResponse.TradeStatus {
	case "TRADE_SUCCESS", "TRADE_FINISHED":
		status = "success"
	case "TRADE_CLOSED":
		status = "failed"
	}

	var paidAmount float64
	if ar.AliPayResponse.TotalAmount != "" {
		fmt.Sscanf(ar.AliPayResponse.TotalAmount, "%f", &paidAmount)
	}

	return &PaymentStatus{
		Status:     status,
		PaidAmount: paidAmount,
	}, nil
}

// RetryPayment for AliPay — create a new payment if the previous one expired.
func (g *AliPayGateway) RetryPayment(ctx context.Context, order *tables.TablePlatformOrder) (*PaymentResult, error) {
	opts := PaymentOptions{
		ReturnURL: order.ReturnURL,
	}
	return g.CreatePayment(ctx, order, opts)
}

// sign signs the Alipay request parameters using RSA2 (SHA256 with RSA).
// Note: this is a stub. Production implementation requires parsing the PKCS8
// private key and using crypto/rsa. The signature format is:
//   sign = base64(rsa_sha256(alipay_public_key, sortedParamString))
func (g *AliPayGateway) sign(params url.Values) string {
	// Collect and sort keys
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	// Build sorted query string (excluding sign/sign_type)
	var sb strings.Builder
	for _, k := range keys {
		if k == "sign" || k == "sign_type" {
			continue
		}
		if sb.Len() > 0 {
			sb.WriteByte('&')
		}
		sb.WriteString(k)
		sb.WriteByte('=')
		sb.WriteString(params.Get(k))
	}
	data := sb.String()

	// RSA2 signature using SHA256
	h := sha256.New()
	h.Write([]byte(data))
	digest := h.Sum(nil)

	// Sign with private key (placeholder — requires crypto/rsa in real impl)
	// For now return empty string to indicate stub
	_ = digest
	return ""
}

// alipayResponse represents the Alipay API response wrapper.
type alipayResponse struct {
	AliPayResponse struct {
		Code        string `json:"code"`
		Msg         string `json:"msg"`
		TradeStatus string `json:"trade_status"`
		TotalAmount string `json:"total_amount"`
	} `json:"alipay_trade_query_response"`
}

// mapToJSON encodes a map as a JSON string.
func mapToJSON(m map[string]any) string {
	b, _ := json.Marshal(m)
	return string(b)
}
