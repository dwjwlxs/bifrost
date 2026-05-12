package payment

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/maximhq/bifrost/framework/configstore/tables"
)

var _ PaymentGateway = (*StripeGateway)(nil)

// GatewayID returns the gateway identifier.
func (g *StripeGateway) GatewayID() string { return "stripe" }

// newStripeGatewayWith creates a StripeGateway with a custom host (for mockoon/testing).
func newStripeGatewayWith(apiKey, webhookSecret, currency, host string) *StripeGateway {
	if currency == "" {
		currency = "usd"
	}
	return &StripeGateway{
		apiKey:        apiKey,
		webhookSecret: webhookSecret,
		currency:      currency,
		host:          host,
		httpClient:    &http.Client{Timeout: 30 * time.Second},
	}
}

// StripeGateway implements PaymentGateway using Stripe Checkout Session API.
// It calls the Stripe REST API directly (no external SDK dependency).
type StripeGateway struct {
	apiKey        string
	webhookSecret string
	currency      string // base currency, default "usd"
	host          string // API base URL (default https://api.stripe.com)
	httpClient    *http.Client
}

// CreatePayment creates a Stripe Checkout Session and returns the redirect URL.
//
// Flow:
//  1. Call POST /v1/checkout/sessions with line items from the order
//  2. Pass order_no in metadata for webhook matching
//  3. Return Session URL as CheckoutURL
func (g *StripeGateway) CreatePayment(ctx context.Context, order *tables.TablePlatformOrder, opts PaymentOptions) (*PaymentResult, error) {
	// Determine display currency (MVP: Stripe auto-converts)
	currency := strings.ToLower(opts.PreferredCurrency)
	if currency == "" {
		currency = g.currency
	}

	// Amount in cents (Stripe requires integer cents)
	amountCents := int64(order.Amount * 100)

	// Build form data for Checkout Session creation
	data := url.Values{}
	data.Set("mode", "payment")
	data.Set("payment_method_types[0]", "card")
	data.Set("line_items[0][price_data][currency]", currency)
	data.Set("line_items[0][price_data][product_data][name]", orderDescription(order))
	data.Set("line_items[0][price_data][unit_amount]", strconv.FormatInt(amountCents, 10))
	data.Set("line_items[0][quantity]", "1")
	data.Set("metadata[order_no]", order.OrderNo)
	data.Set("success_url", opts.ReturnURL+"?order_no="+url.QueryEscape(order.OrderNo)+"&status=success")
	data.Set("cancel_url", opts.ReturnURL+"?order_no="+url.QueryEscape(order.OrderNo)+"&status=cancelled")

	// If order has user info, add to metadata
	if order.UserID != nil {
		data.Set("metadata[user_id]", *order.UserID)
	}
	if order.TenantType != "" {
		data.Set("metadata[tenant_type]", string(order.TenantType))
	}
	if order.TenantID != "" {
		data.Set("metadata[tenant_id]", order.TenantID)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.host+"/v1/checkout/sessions", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create stripe request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Authorization", "Bearer "+g.apiKey)

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("stripe API call: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read stripe response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("stripe API error (status %d): %s", resp.StatusCode, string(body))
	}

	var session stripeCheckoutSession
	if err := json.Unmarshal(body, &session); err != nil {
		return nil, fmt.Errorf("parse stripe session: %w", err)
	}

	return &PaymentResult{
		PaymentID:   session.ID,
		CheckoutURL: session.URL,
		ExpiresAt:   strconv.FormatInt(session.ExpiresAt, 10), // Unix timestamp string
		Status:      "pending",
	}, nil
}

// VerifyPayment queries a Checkout Session's status by calling the Stripe API.
// Used for proactive reconciliation when webhook is delayed.
func (g *StripeGateway) VerifyPayment(ctx context.Context, paymentID string) (*PaymentStatus, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		g.host+"/v1/checkout/sessions/"+url.PathEscape(paymentID), nil)
	if err != nil {
		return nil, fmt.Errorf("create stripe verify request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+g.apiKey)

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("stripe verify API call: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read stripe verify response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("stripe verify error (status %d): %s", resp.StatusCode, string(body))
	}

	var session stripeCheckoutSession
	if err := json.Unmarshal(body, &session); err != nil {
		return nil, fmt.Errorf("parse stripe session: %w", err)
	}

	status := "pending"
	var paidAmount float64
	if session.PaymentStatus == "paid" {
		status = "success"
		paidAmount = float64(session.AmountTotal) / 100.0
	}

	return &PaymentStatus{
		Status:     status,
		PaidAmount: paidAmount,
	}, nil
}

// HandleWebhook processes a Stripe webhook event.
// It verifies the signature, parses the event, and returns a WebhookResult
// that the caller can use to match and process the order.
//
// Expected event types:
//   - checkout.session.completed → payment success
//   - checkout.session.expired   → payment expired (user didn't complete)
func (g *StripeGateway) HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookResult, error) {
	// 1. Verify Stripe webhook signature
	if err := g.verifyStripeSignature(payload, signature, g.webhookSecret); err != nil {
		return nil, fmt.Errorf("webhook signature verification failed: %w", err)
	}

	// 2. Parse the event
	var event struct {
		ID      string `json:"id"`
		Type    string `json:"type"`
		Created int64  `json:"created"`
		Data    struct {
			Object stripeCheckoutSession `json:"object"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &event); err != nil {
		return nil, fmt.Errorf("parse webhook event: %w", err)
	}

	// 3. Handle by event type
	switch event.Type {
	case "checkout.session.completed":
		session := event.Data.Object
		orderNo := session.Metadata.OrderNo
		if orderNo == "" {
			return nil, fmt.Errorf("webhook event %s: missing order_no in metadata", event.ID)
		}

		paidAmount := float64(session.AmountTotal) / 100.0 // convert cents to dollars

		return &WebhookResult{
			OrderNo:    orderNo,
			Status:     "success",
			PaymentID:  session.ID,
			PaidAmount: paidAmount,
		}, nil

	case "checkout.session.expired":
		session := event.Data.Object
		orderNo := session.Metadata.OrderNo
		if orderNo == "" {
			return nil, fmt.Errorf("webhook event %s: missing order_no in metadata", event.ID)
		}

		return &WebhookResult{
			OrderNo:   orderNo,
			Status:    "expired",
			PaymentID: session.ID,
		}, nil

	default:
		// Unhandled event type — not an error, just skip
		return nil, nil
	}
}

// verifyStripeSignature verifies the Stripe webhook signature using HMAC-SHA256.
//
// Stripe sends a Stripe-Signature header with format:
//
//	t=<timestamp>,v1=<signature>,v1=<signature>,...
//
// We reconstruct the signed payload as: timestamp + "." + payload
// and compare with the provided signatures.
// We also reject events older than 5 minutes to mitigate replay attacks.
func (g *StripeGateway) verifyStripeSignature(payload []byte, sigHeader, secret string) error {
	if os.Getenv("ENV") == "local" {
		return nil
	}

	if secret == "" {
		return fmt.Errorf("webhook secret is not configured")
	}

	var timestampStr string
	var signatures []string

	pairs := strings.Split(sigHeader, ",")
	for _, pair := range pairs {
		parts := strings.SplitN(pair, "=", 2)
		if len(parts) != 2 {
			continue
		}
		switch parts[0] {
		case "t":
			timestampStr = parts[1]
		case "v1":
			signatures = append(signatures, parts[1])
		}
	}

	if timestampStr == "" || len(signatures) == 0 {
		return fmt.Errorf("invalid signature header format")
	}

	// Check timestamp freshness (tolerance: 5 minutes)
	timestamp, err := strconv.ParseInt(timestampStr, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid timestamp in signature: %w", err)
	}
	if time.Now().Unix()-timestamp > 300 {
		return fmt.Errorf("webhook timestamp too old (possible replay attack)")
	}

	// Compute expected signature
	signedPayload := timestampStr + "." + string(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signedPayload))
	expectedSig := hex.EncodeToString(mac.Sum(nil))

	// Compare with any of the provided signatures
	for _, sig := range signatures {
		if hmac.Equal([]byte(expectedSig), []byte(sig)) {
			return nil
		}
	}

	return fmt.Errorf("signature mismatch")
}

// RetryPayment re-attempts payment for an existing pending order.
// If the original checkout session is still valid (not expired), returns the existing URL.
// Otherwise creates a new Checkout Session.
func (g *StripeGateway) RetryPayment(ctx context.Context, order *tables.TablePlatformOrder) (*PaymentResult, error) {
	now := time.Now()

	// If existing checkout URL is still valid and not expired, return it
	if order.CheckoutURL != "" && order.CheckoutExpiresAt != nil && order.CheckoutExpiresAt.After(now) {
		return &PaymentResult{
			PaymentID:   order.PaymentID,
			CheckoutURL: order.CheckoutURL,
			ExpiresAt:   strconv.FormatInt(order.CheckoutExpiresAt.Unix(), 10),
			Status:      "pending",
		}, nil
	}

	// Create new payment session with original return URL
	opts := PaymentOptions{
		ReturnURL: order.ReturnURL,
	}
	result, err := g.CreatePayment(ctx, order, opts)
	if err != nil {
		return nil, err
	}
	return result, nil
}

// orderDescription returns a human-readable description for the Stripe line item.
func orderDescription(order *tables.TablePlatformOrder) string {
	switch order.Type {
	case tables.OrderTypeRecharge:
		return fmt.Sprintf("Bifrost Credits Recharge - %s", order.OrderNo)
	case tables.OrderTypePackagePurchase:
		return fmt.Sprintf("Bifrost Package Purchase - %s", order.OrderNo)
	default:
		return fmt.Sprintf("Bifrost Payment - %s", order.OrderNo)
	}
}

// ---------------------------------------------------------------------------
// Stripe API response types (minimal, only fields we need)
// ---------------------------------------------------------------------------

// stripeCheckoutSession represents the Stripe Checkout Session object we need.
type stripeCheckoutSession struct {
	ID            string `json:"id"`
	URL           string `json:"url"`
	PaymentStatus string `json:"payment_status"` // "paid" | "unpaid"
	AmountTotal   int64  `json:"amount_total"`   // cents
	ExpiresAt     int64  `json:"expires_at"`     // Unix timestamp of session expiry
	Metadata      struct {
		OrderNo    string `json:"order_no"`
		UserID     string `json:"user_id"`
		CustomerID string `json:"customer_id"`
	} `json:"metadata"`
}
