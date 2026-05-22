// Package payment provides payment gateway abstractions and billing service logic.
package payment

import (
	"context"

	"github.com/dwjwlxs/bifrost/plugins/billing/internal/repos/billingstore/tables"
)

// PaymentGateway abstracts a payment provider (Stripe, AliPay, manual admin, etc.).
type PaymentGateway interface {
	// GatewayID returns the unique identifier for this gateway (e.g. "stripe", "alipay", "manual").
	GatewayID() string

	// CreatePayment creates a payment intent and returns a checkout URL or payment credentials.
	CreatePayment(ctx context.Context, order *tables.TablePlatformOrder, opts PaymentOptions) (*PaymentResult, error)

	// RetryPayment re-attempts a payment for an existing pending order.
	// Returns a new checkout URL if the previous session has expired.
	RetryPayment(ctx context.Context, order *tables.TablePlatformOrder) (*PaymentResult, error)

	// HandleWebhook processes payment gateway webhook events.
	HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookResult, error)

	// VerifyPayment queries the payment status for reconciliation.
	VerifyPayment(ctx context.Context, paymentID string) (*PaymentStatus, error)

	// UpdateAutoRenew updates the auto-renewal setting for an active subscription.
	UpdateAutoRenew(ctx context.Context, subscriptionID string, autoRenew bool) error

	// SupportsSubscription returns true if the gateway supports subscription-based payments.
	SupportsSubscription() bool

	// SyncProduct creates a product and price on the gateway for a package.
	// Returns the product ID and price ID.
	SyncProduct(pkg *tables.TablePlatformPackage) (productID, priceID string, err error)
}

// PaymentOptions contains options for creating a payment.
type PaymentOptions struct {
	PreferredCurrency string            // Display currency ("usd", "jpy", etc.)
	ReturnURL         string            // URL to redirect after payment
	Metadata          map[string]string // Extra key-value pairs passed to the gateway
	AutoRenew         bool              // If true, creates a subscription with automatic renewal
	StripePriceID     string            // Optional: pre-created Stripe Price ID (for subscription mode)
	// RecurringInterval specifies the billing interval for subscriptions (day, week, month, year).
	// Required when AutoRenew is true and StripePriceID is not provided.
	RecurringInterval string
}

// PaymentResult contains the result of creating a payment.
type PaymentResult struct {
	PaymentID   string // Gateway transaction ID
	CheckoutURL string // URL for the user to complete payment (Stripe Checkout)
	ExpiresAt   string // ISO8601 expiry time of the checkout session
	Status      string // "pending" | "success"
}

// WebhookResult contains the parsed result of a webhook callback.
type WebhookResult struct {
	OrderNo       string  // Matched order number (from metadata)
	Status        string  // "success" | "failed" | "expired" | "renewed" | "canceled" | "subscription_updated"
	PaymentID     string  // Gateway transaction ID
	PaidAmount    float64 // Actual amount paid (USD)
	PaymentMethod string  // card | bank_transfer | etc.

	// Subscription fields (for subscription events)
	SubscriptionID string // Stripe subscription ID
	CustomerID     string // Stripe customer ID
	NextBillingAt  int64  // Unix timestamp of next billing (for invoice events)
	AutoRenew      bool   // Auto-renew setting (from subscription_updated webhook)
}

// PaymentStatus is the result of a VerifyPayment call.
type PaymentStatus struct {
	Status     string
	PaidAmount float64
}
