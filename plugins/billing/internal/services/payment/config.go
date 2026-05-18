package payment

import (
	"github.com/maximhq/bifrost/plugins/billing/pkg/payment"
)

// Re-export types from public package so that internal and external importers
// can both use "payment" as the import path.
type (
	BillingConfig  = payment.BillingConfig
	GatewayConfig  = payment.GatewayConfig
	StripeConfig   = payment.StripeConfig
	AliPayConfig   = payment.AliPayConfig
	ManualConfig   = payment.ManualConfig
)
