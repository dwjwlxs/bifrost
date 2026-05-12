package payment

import (
	"fmt"
)

// BillingConfig defines the billing configuration loaded from config.json.
//
// Example config.json (multi-gateway, flat format):
//
//	{
//	  "billing": {
//	    "default_gateway": "stripe",
//	    "gateways": {
//	      "stripe":  { "enabled": true, "api_key": "sk_live_xxx", "webhook_secret": "whsec_xxx", "currency": "usd" },
//	      "alipay":  { "enabled": true, "app_id": "...", "private_key": "...", "alipay_public_key": "..." },
//	      "manual":  { "enabled": true }
//	    }
//	  }
//	}
type BillingConfig struct {
	// DefaultGateway is the gateway used when user does not specify one.
	DefaultGateway string `json:"default_gateway,omitempty"`

	// Gateways is a map of gateway ID to its configuration.
	// Supported IDs: "stripe", "alipay", "manual"
	Gateways map[string]GatewayConfig `json:"gateways,omitempty"`
}

// GatewayConfig is a tagged union for each gateway's configuration.
// It supports two formats: flat (api_key, app_id etc. at top level) and nested
// (stripe:, alipay:, manual: sub-structs). Flat takes precedence if both are present.
// The BaseURL field overrides the default API endpoint for all gateways.
type GatewayConfig struct {
	// Common
	Enabled *bool  `json:"enabled,omitempty"`  // default true if absent
	BaseURL string `json:"base_url,omitempty"` // override the default API base URL

	// Stripe — flat fields (preferred)
	APIKey        string `json:"api_key,omitempty"`
	WebhookSecret string `json:"webhook_secret,omitempty"`
	Currency      string `json:"currency,omitempty"`

	// AliPay — flat fields (preferred)
	AppID           string `json:"app_id,omitempty"`
	PrivateKey      string `json:"private_key,omitempty"`
	AlipayPublicKey string `json:"alipay_public_key,omitempty"`
}

// StripeConfig contains Stripe-specific configuration.
type StripeConfig struct {
	APIKey        string `json:"api_key"`
	WebhookSecret string `json:"webhook_secret"`
	Currency      string `json:"currency,omitempty"`
	BaseURL       string `json:"base_url,omitempty"`
}

// AliPayConfig contains AliPay-specific configuration.
type AliPayConfig struct {
	AppID           string `json:"app_id"`
	PrivateKey      string `json:"private_key"`
	AlipayPublicKey string `json:"alipay_public_key"`
	BaseURL         string `json:"base_url,omitempty"`
}

// ManualConfig contains Manual gateway configuration (currently no fields needed).
type ManualConfig struct{}

// IsEnabled returns whether the gateway is enabled (default true if Enabled is nil).
func (g *GatewayConfig) IsEnabled() bool {
	if g == nil {
		return false
	}
	if g.Enabled == nil {
		return false // default: enabled
	}
	return *g.Enabled
}

// StripeConfig returns the Stripe configuration, preferring flat fields over nested.
func (g *GatewayConfig) StripeConfig() *StripeConfig {
	if g.APIKey != "" {
		return &StripeConfig{
			APIKey:        g.APIKey,
			WebhookSecret: g.WebhookSecret,
			Currency:      g.Currency,
			BaseURL:       g.BaseURL,
		}
	}
	return nil
}

// AliPayConfig returns the AliPay configuration, preferring flat fields over nested.
func (g *GatewayConfig) AliPayConfig() *AliPayConfig {
	if g.AppID != "" {
		return &AliPayConfig{
			AppID:           g.AppID,
			PrivateKey:      g.PrivateKey,
			AlipayPublicKey: g.AlipayPublicKey,
			BaseURL:         g.BaseURL,
		}
	}
	return nil
}

// GatewayConfigs returns the enabled gateway configs as a flat map.
// It merges the legacy single-gateway format into the new map format for uniform handling.
func (c *BillingConfig) GatewayConfigs() map[string]*GatewayConfig {
	if c.Gateways != nil && len(c.Gateways) > 0 {
		result := make(map[string]*GatewayConfig, len(c.Gateways))
		for k, v := range c.Gateways {
			result[k] = &v
		}
		return result
	}
	return nil
}

// EffectiveDefaultGateway returns the default gateway ID.
func (c *BillingConfig) EffectiveDefaultGateway() string {
	if c.DefaultGateway != "" {
		return c.DefaultGateway
	}
	return "manual"
}

// Validate validates the billing config and returns an error if invalid.
func (c *BillingConfig) Validate() error {
	if c == nil {
		return nil
	}
	gateways := c.GatewayConfigs()
	if len(gateways) == 0 {
		return fmt.Errorf("billing config: at least one gateway must be configured")
	}

	// Validate each gateway config
	for id, cfg := range gateways {
		if !cfg.IsEnabled() {
			continue
		}
		switch id {
		case "stripe":
			sc := cfg.StripeConfig()
			if sc == nil || sc.APIKey == "" {
				return fmt.Errorf("billing config: stripe gateway requires api_key")
			}
		case "alipay":
			ac := cfg.AliPayConfig()
			if ac == nil || ac.AppID == "" {
				return fmt.Errorf("billing config: alipay gateway requires app_id")
			}
			if ac.PrivateKey == "" {
				return fmt.Errorf("billing config: alipay gateway requires private_key")
			}
			if ac.AlipayPublicKey == "" {
				return fmt.Errorf("billing config: alipay gateway requires alipay_public_key")
			}
		case "manual":
			// no validation needed
		default:
			return fmt.Errorf("billing config: unknown gateway type %q", id)
		}
	}

	// Validate default gateway exists and is enabled
	defaultID := c.EffectiveDefaultGateway()
	defaultCfg, exists := gateways[defaultID]
	if !exists {
		return fmt.Errorf("billing config: default_gateway %q is not configured", defaultID)
	}
	if !defaultCfg.IsEnabled() {
		return fmt.Errorf("billing config: default_gateway %q is disabled", defaultID)
	}

	return nil
}
