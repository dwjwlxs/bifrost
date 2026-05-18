package payment

import (
	"fmt"
	"maps"
	"slices"
	"strings"
)

// GatewayRegistry manages multiple payment gateway instances keyed by gateway ID.
type GatewayRegistry struct {
	gateways  map[string]PaymentGateway
	defaultID string
}

// NewGatewayRegistry creates a GatewayRegistry from a BillingConfig.
// It instantiates the appropriate gateway types based on the config.
func NewGatewayRegistry(cfg *BillingConfig) (*GatewayRegistry, error) {
	if cfg == nil {
		// Default: manual gateway only
		return newRegistryWith(map[string]PaymentGateway{
			"manual": NewManualGateway(),
		}, "manual"), nil
	}

	gateways := make(map[string]PaymentGateway)
	gatewayConfigs := cfg.GatewayConfigs()
	enabledCount := 0

	for id, gc := range gatewayConfigs {
		if !gc.IsEnabled() {
			continue
		}

		switch id {
		case "stripe":
			sc := gc.StripeConfig()
			if sc == nil {
				return nil, fmt.Errorf("stripe gateway config is required")
			}
			baseURL := gc.BaseURL
			if baseURL == "" {
				baseURL = sc.BaseURL
			}
			if baseURL == "" {
				baseURL = "https://api.stripe.com"
			}
			gateways[id] = newStripeGatewayWith(sc.APIKey, sc.WebhookSecret, sc.Currency, baseURL)
			enabledCount++

		case "alipay":
			ac := gc.AliPayConfig()
			if ac == nil {
				return nil, fmt.Errorf("alipay gateway config is required")
			}
			baseURL := gc.BaseURL
			if baseURL == "" {
				baseURL = ac.BaseURL
			}
			if baseURL == "" {
				baseURL = "https://openapi.alipay.com"
			}
			gateways[id] = newAliPayGateway(ac, baseURL)
			enabledCount++

		case "manual":
			gateways[id] = NewManualGateway()
			enabledCount++

		default:
			// Unknown gateway — skip (forward compatibility)
		}
	}

	if enabledCount == 0 {
		return nil, fmt.Errorf("at least one payment gateway must be enabled")
	}

	defaultID := cfg.EffectiveDefaultGateway()
	// If default is not in gateways (e.g. disabled), pick first available
	if _, ok := gateways[defaultID]; !ok {
		for id := range gateways {
			defaultID = id
			break
		}
	}

	return newRegistryWith(gateways, defaultID), nil
}

// newRegistryWith creates a GatewayRegistry with pre-built gateway instances.
// Exposed for testing and internal use.
func newRegistryWith(gateways map[string]PaymentGateway, defaultID string) *GatewayRegistry {
	return &GatewayRegistry{
		gateways:  gateways,
		defaultID: defaultID,
	}
}

// Get returns the gateway with the given ID, or the default gateway if id is empty.
func (r *GatewayRegistry) Get(id string) (PaymentGateway, error) {
	if id == "" {
		id = r.defaultID
	}
	gw, ok := r.gateways[id]
	if !ok {
		return nil, fmt.Errorf("payment gateway %q not found or not enabled", id)
	}
	return gw, nil
}

// Default returns the default gateway.
func (r *GatewayRegistry) Default() PaymentGateway {
	return r.gateways[r.defaultID]
}

// List returns all registered gateways.
func (r *GatewayRegistry) List() map[string]PaymentGateway {
	result := make(map[string]PaymentGateway, len(r.gateways))
	for k, v := range r.gateways {
		result[k] = v
	}
	return result
}

// IDs returns all gateway IDs.
func (r *GatewayRegistry) IDs() []string {
	m := maps.Keys(r.gateways)
	return slices.Collect(m)
}

// DefaultID returns the default gateway ID.
func (r *GatewayRegistry) DefaultID() string {
	return r.defaultID
}

// GatewayInfos returns metadata about all gateways (for listGateways API).
func (r *GatewayRegistry) GatewayInfos() []GatewayInfo {
	infos := make([]GatewayInfo, 0, len(r.gateways))
	for id := range r.gateways {
		infos = append(infos, GatewayInfo{
			ID:      id,
			Name:    gatewayDisplayName(id),
			Methods: gatewayMethods(id),
		})
	}
	return infos
}

// GatewayInfo describes a gateway for API responses.
type GatewayInfo struct {
	ID      string              `json:"gateway"`
	Name    string              `json:"name"`
	Methods []map[string]string `json:"methods"`
}

func gatewayDisplayName(id string) string {
	switch id {
	case "stripe":
		return "Stripe"
	case "alipay":
		return "Alipay"
	case "manual":
		return "Manual"
	case "wechat_pay":
		return "WeChat Pay"
	default:
		return strings.ToUpper(id)
	}
}

func gatewayMethods(id string) []map[string]string {
	switch id {
	case "stripe":
		return []map[string]string{
			{"type": "card", "name": "Credit/Debit Card"},
		}
	case "alipay":
		return []map[string]string{
			{"type": "alipay", "name": "Alipay"},
		}
	case "manual":
		return []map[string]string{
			{"type": "admin", "name": "Admin Manual"},
		}
	case "wechat_pay":
		return []map[string]string{
			{"type": "wechat_pay", "name": "WeChat Pay"},
		}
	default:
		return nil
	}
}
