// Package payment provides payment gateway abstractions and billing service logic.
package payment

import (
	"context"

	"github.com/maximhq/bifrost/framework/configstore/tables"
)

// PaymentGateway abstracts a payment provider (Stripe, manual admin, etc.).
type PaymentGateway interface {
	// CreatePayment creates a payment intent and returns a checkout URL or payment credentials.
	CreatePayment(ctx context.Context, order *tables.TablePlatformOrder, opts PaymentOptions) (*PaymentResult, error)

	// HandleWebhook processes payment gateway webhook events.
	HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookResult, error)

	// VerifyPayment queries the payment status for reconciliation.
	VerifyPayment(ctx context.Context, paymentID string) (*PaymentStatus, error)
}

// PaymentOptions contains options for creating a payment.
type PaymentOptions struct {
	PreferredCurrency string            // Display currency ("usd", "jpy", etc.)
	ReturnURL         string            // URL to redirect after payment
	Metadata          map[string]string // Extra key-value pairs passed to the gateway
}

// PaymentResult contains the result of creating a payment.
type PaymentResult struct {
	PaymentID   string // Gateway transaction ID
	CheckoutURL string // URL for the user to complete payment (Stripe Checkout)
	Status      string // "pending" | "success"
}

// WebhookResult contains the parsed result of a webhook callback.
type WebhookResult struct {
	OrderNo    string  // Matched order number (from metadata)
	Status     string  // "success" | "failed"
	PaymentID  string  // Gateway transaction ID
	PaidAmount float64 // Actual amount paid (USD)
}

// PaymentStatus is the result of a VerifyPayment call.
type PaymentStatus struct {
	Status     string
	PaidAmount float64
}
