package payment

import (
	"context"

	"github.com/dwjwlxs/bifrost/plugins/billing/internal/repos/billingstore/tables"
)

var _ PaymentGateway = (*ManualGateway)(nil)

// GatewayID returns the gateway identifier.
func (m *ManualGateway) GatewayID() string { return "manual" }

// SupportsSubscription returns false since manual gateway does not support subscriptions.
func (m *ManualGateway) SupportsSubscription() bool { return false }

// ManualGateway is a no-op gateway used when payments are handled out-of-band
// (admin manual recharge, test environments, pre-Stripe MVP).
type ManualGateway struct{}

// NewManualGateway returns a ManualGateway.
func NewManualGateway() *ManualGateway { return &ManualGateway{} }

// CreatePayment returns a pending result — admin will confirm payment manually.
func (m *ManualGateway) CreatePayment(_ context.Context, _ *tables.TablePlatformOrder, _ PaymentOptions) (*PaymentResult, error) {
	return &PaymentResult{Status: "pending"}, nil
}

// HandleWebhook is unused for manual payments.
func (m *ManualGateway) HandleWebhook(_ context.Context, _ []byte, _ string) (*WebhookResult, error) {
	return nil, nil
}

// VerifyPayment always reports success for manual payments.
func (m *ManualGateway) VerifyPayment(_ context.Context, _ string) (*PaymentStatus, error) {
	return &PaymentStatus{Status: "success"}, nil
}

// RetryPayment is not supported for manual gateway — returns error.
func (m *ManualGateway) RetryPayment(_ context.Context, _ *tables.TablePlatformOrder) (*PaymentResult, error) {
	return nil, ErrNotSupported // manual gateway has no checkout URL to retry
}

// UpdateAutoRenew is not supported for manual gateway.
func (m *ManualGateway) UpdateAutoRenew(_ context.Context, _ string, _ bool) error {
	return ErrNotSupported
}

// SyncProduct is not supported for manual gateway.
func (m *ManualGateway) SyncProduct(pkg *tables.TablePlatformPackage) (productID, priceID string, err error) {
	return "", "", ErrNotSupported
}
