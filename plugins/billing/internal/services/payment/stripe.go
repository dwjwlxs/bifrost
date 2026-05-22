package payment

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/dwjwlxs/bifrost/plugins/billing/internal/repos/billingstore/tables"
	"github.com/stripe/stripe-go/v85"
	"github.com/stripe/stripe-go/v85/checkout/session"
	"github.com/stripe/stripe-go/v85/price"
	"github.com/stripe/stripe-go/v85/product"
	"github.com/stripe/stripe-go/v85/webhook"
)

var _ PaymentGateway = (*StripeGateway)(nil)

// GatewayID returns the gateway identifier.
func (g *StripeGateway) GatewayID() string { return "stripe" }

// SupportsSubscription returns true since Stripe supports subscription mode.
func (g *StripeGateway) SupportsSubscription() bool { return true }

// newStripeGatewayWith creates a StripeGateway with a custom API key and webhook secret.
func newStripeGatewayWith(apiKey, webhookSecret, currency, baseURL string) *StripeGateway {
	if currency == "" {
		currency = "usd"
	}
	if baseURL == "" {
		baseURL = "https://api.stripe.com"
	}
	stripe.Key = apiKey
	return &StripeGateway{
		webhookSecret: webhookSecret,
		currency:      currency,
		baseURL:       baseURL,
	}
}

// StripeGateway implements PaymentGateway using Stripe Checkout Session API via the official SDK.
type StripeGateway struct {
	webhookSecret string
	currency      string // base currency, default "usd"
	baseURL       string // API base URL (default https://api.stripe.com)
}

// CreatePayment creates a Stripe Checkout Session and returns the redirect URL.
func (g *StripeGateway) CreatePayment(ctx context.Context, order *tables.TablePlatformOrder, opts PaymentOptions) (*PaymentResult, error) {
	currency := strings.ToLower(opts.PreferredCurrency)
	if currency == "" {
		currency = g.currency
	}

	params := &stripe.CheckoutSessionParams{
		Metadata: map[string]string{
			"order_no": order.OrderNo,
		},
		SuccessURL: stripe.String(opts.ReturnURL + "?order_no=" + order.OrderNo + "&status=success"),
		CancelURL:  stripe.String(opts.ReturnURL + "?order_no=" + order.OrderNo + "&status=cancelled"),
	}

	if order.UserID != nil {
		params.Metadata["user_id"] = *order.UserID
	}
	if order.TenantType != "" {
		params.Metadata["tenant_type"] = string(order.TenantType)
	}
	if order.TenantID != "" {
		params.Metadata["tenant_id"] = order.TenantID
	}

	amountCents := int64(order.Amount * 100)

	// Determine payment mode based on order type
	// Package purchases always use subscription mode to enable auto-renewal management
	// Recharge orders use one-time payment mode
	if order.Type == tables.OrderTypeRecharge {
		// Recharge: one-time payment (add balance to wallet) - supports card, alipay, wechat_pay
		params.Mode = stripe.String(string(stripe.CheckoutSessionModePayment))
		params.PaymentMethodTypes = []*string{
			stripe.String("card"),
			stripe.String("alipay"),
			stripe.String("wechat_pay"),
		}
		params.PaymentMethodOptions = &stripe.CheckoutSessionPaymentMethodOptionsParams{
			WeChatPay: &stripe.CheckoutSessionPaymentMethodOptionsWeChatPayParams{
				Client: stripe.String("web"),
			},
		}
		params.LineItems = []*stripe.CheckoutSessionLineItemParams{
			{
				PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
					Currency: stripe.String(currency),
					ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
						Name: stripe.String(orderDescription(order)),
					},
					UnitAmount: stripe.Int64(amountCents),
				},
				Quantity: stripe.Int64(1),
			},
		}
	} else {
		// Package purchase: always subscription mode - supports card only
		// Note: CancelAtPeriodEnd cannot be set via CheckoutSessionSubscriptionDataParams in SDK v85.
		// Auto-renew is ON by default. Users can toggle auto-renew off after purchase via API.
		// Note: Alipay is not supported in subscription mode per Stripe API.
		params.Mode = stripe.String(string(stripe.CheckoutSessionModeSubscription))
		params.PaymentMethodTypes = []*string{
			stripe.String("card"),
		}
		if opts.StripePriceID != "" {
			params.LineItems = []*stripe.CheckoutSessionLineItemParams{
				{
					Price:    stripe.String(opts.StripePriceID),
					Quantity: stripe.Int64(1),
				},
			}
		} else {
			params.LineItems = []*stripe.CheckoutSessionLineItemParams{
				{
					PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
						Currency: stripe.String(currency),
						ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
							Name: stripe.String(orderDescription(order)),
						},
						UnitAmount: stripe.Int64(amountCents),
						Recurring: &stripe.CheckoutSessionLineItemPriceDataRecurringParams{
							Interval: stripe.String(opts.RecurringInterval),
						},
					},
					Quantity: stripe.Int64(1),
				},
			}
		}
	}

	s, err := session.New(params)
	if err != nil {
		return nil, fmt.Errorf("create checkout session: %w", err)
	}

	return &PaymentResult{
		PaymentID:   s.ID,
		CheckoutURL: s.URL,
		ExpiresAt:   strconv.FormatInt(s.ExpiresAt, 10),
		Status:      "pending",
	}, nil
}

// VerifyPayment queries a Checkout Session's status.
func (g *StripeGateway) VerifyPayment(ctx context.Context, paymentID string) (*PaymentStatus, error) {
	s, err := session.Get(paymentID, nil)
	if err != nil {
		return nil, fmt.Errorf("get checkout session: %w", err)
	}

	status := "pending"
	var paidAmount float64
	if s.PaymentStatus == "paid" {
		status = "success"
		paidAmount = float64(s.AmountTotal) / 100.0
	}

	return &PaymentStatus{
		Status:     status,
		PaidAmount: paidAmount,
	}, nil
}

// HandleWebhook processes a Stripe webhook event.
func (g *StripeGateway) HandleWebhook(ctx context.Context, payload []byte, signature string) (*WebhookResult, error) {
	event, err := webhook.ConstructEvent(payload, signature, g.webhookSecret)
	if err != nil {
		return nil, fmt.Errorf("webhook signature verification failed: %w", err)
	}

	switch event.Type {
	case "checkout.session.completed":
		var s stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &s); err != nil {
			return nil, fmt.Errorf("parse checkout.session.completed: %w", err)
		}
		orderNo := ""
		if s.Metadata != nil {
			orderNo = s.Metadata["order_no"]
		}
		if orderNo == "" {
			return nil, fmt.Errorf("webhook event %s: missing order_no in metadata", event.ID)
		}
		var subID string
		if s.Subscription != nil {
			subID = s.Subscription.ID
		}
		var custID string
		if s.Customer != nil {
			custID = s.Customer.ID
		}
		return &WebhookResult{
			OrderNo:        orderNo,
			Status:         "success",
			PaymentID:      s.ID,
			PaidAmount:     float64(s.AmountTotal) / 100.0,
			SubscriptionID: subID,
			CustomerID:     custID,
		}, nil

	case "checkout.session.expired":
		var s stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &s); err != nil {
			return nil, fmt.Errorf("parse checkout.session.expired: %w", err)
		}
		orderNo := ""
		if s.Metadata != nil {
			orderNo = s.Metadata["order_no"]
		}
		if orderNo == "" {
			return nil, fmt.Errorf("webhook event %s: missing order_no in metadata", event.ID)
		}
		return &WebhookResult{
			OrderNo:   orderNo,
			Status:    "expired",
			PaymentID: s.ID,
		}, nil

	case "invoice.paid":
		var inv stripe.Invoice
		if err := json.Unmarshal(event.Data.Raw, &inv); err != nil {
			return nil, fmt.Errorf("parse invoice.paid: %w", err)
		}
		// Try order_no from subscription metadata first (propagated from CheckoutSession)
		orderNo := ""
		if inv.Parent != nil && inv.Parent.SubscriptionDetails != nil {
			orderNo = inv.Parent.SubscriptionDetails.Metadata["order_no"]
		}
		// Fallback to invoice's own metadata (may be empty for renewal invoices)
		if orderNo == "" && inv.Metadata != nil {
			orderNo = inv.Metadata["order_no"]
		}
		var subID, custID string
		if inv.Parent != nil && inv.Parent.SubscriptionDetails != nil && inv.Parent.SubscriptionDetails.Subscription != nil {
			subID = inv.Parent.SubscriptionDetails.Subscription.ID
		}
		if inv.Customer != nil {
			custID = inv.Customer.ID
		}
		return &WebhookResult{
			OrderNo:        orderNo,
			Status:         "renewed",
			PaymentID:      inv.ID,
			SubscriptionID: subID,
			CustomerID:     custID,
			PaidAmount:     float64(inv.AmountPaid) / 100.0,
			NextBillingAt:  inv.NextPaymentAttempt,
		}, nil

	case "invoice.payment_failed":
		var inv stripe.Invoice
		if err := json.Unmarshal(event.Data.Raw, &inv); err != nil {
			return nil, fmt.Errorf("parse invoice.payment_failed: %w", err)
		}
		var subID, custID string
		if inv.Parent != nil && inv.Parent.SubscriptionDetails != nil && inv.Parent.SubscriptionDetails.Subscription != nil {
			subID = inv.Parent.SubscriptionDetails.Subscription.ID
		}
		if inv.Customer != nil {
			custID = inv.Customer.ID
		}
		return &WebhookResult{
			Status:         "renewal_failed",
			PaymentID:      inv.ID,
			SubscriptionID: subID,
			CustomerID:     custID,
		}, nil

	case "customer.subscription.updated":
		var sub stripe.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
			return nil, fmt.Errorf("parse customer.subscription.updated: %w", err)
		}
		orderNo := ""
		if sub.Metadata != nil {
			orderNo = sub.Metadata["order_no"]
		}
		custID := ""
		if sub.Customer != nil {
			custID = sub.Customer.ID
		}
		// auto_renew = !cancel_at_period_end (cancel_at_period_end=true means user disabled auto-renew)
		autoRenew := !sub.CancelAtPeriodEnd
		return &WebhookResult{
			OrderNo:        orderNo,
			Status:         "subscription_updated",
			SubscriptionID: sub.ID,
			CustomerID:     custID,
			AutoRenew:      autoRenew,
		}, nil

	case "customer.subscription.deleted":
		var sub stripe.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
			return nil, fmt.Errorf("parse customer.subscription.deleted: %w", err)
		}
		custID := ""
		if sub.Customer != nil {
			custID = sub.Customer.ID
		}
		return &WebhookResult{
			Status:         "canceled",
			SubscriptionID: sub.ID,
			CustomerID:     custID,
		}, nil

	default:
		return nil, nil
	}
}

// RetryPayment re-attempts payment for an existing pending order.
func (g *StripeGateway) RetryPayment(ctx context.Context, order *tables.TablePlatformOrder) (*PaymentResult, error) {
	now := time.Now()

	if order.CheckoutURL != "" && order.CheckoutExpiresAt != nil && order.CheckoutExpiresAt.After(now) {
		return &PaymentResult{
			PaymentID:   order.PaymentID,
			CheckoutURL: order.CheckoutURL,
			ExpiresAt:   strconv.FormatInt(order.CheckoutExpiresAt.Unix(), 10),
			Status:      "pending",
		}, nil
	}

	opts := PaymentOptions{
		ReturnURL: order.ReturnURL,
	}
	return g.CreatePayment(ctx, order, opts)
}

// UpdateAutoRenew updates the auto-renewal setting for a Stripe subscription.
func (g *StripeGateway) UpdateAutoRenew(ctx context.Context, subscriptionID string, autoRenew bool) error {
	params := &stripe.SubscriptionUpdateParams{
		CancelAtPeriodEnd: new(bool),
	}
	*params.CancelAtPeriodEnd = !autoRenew
	client := stripe.NewClient(stripe.Key)
	_, err := client.V1Subscriptions.Update(ctx, subscriptionID, params)
	return err
}

// SyncProduct creates a Stripe Product and Price for a package, returns productID and priceID.
func (g *StripeGateway) SyncProduct(pkg *tables.TablePlatformPackage) (productID, priceID string, err error) {
	// Create Product
	productParams := &stripe.ProductParams{
		Name: stripe.String(pkg.Name),
		Metadata: map[string]string{
			"package_id": pkg.ID,
		},
	}
	if pkg.Description != "" {
		productParams.Description = stripe.String(pkg.Description)
	}
	p, err := product.New(productParams)
	if err != nil {
		return "", "", fmt.Errorf("create stripe product: %w", err)
	}

	// Determine recurring interval from duration (days)
	interval := "month"
	if pkg.Duration >= 365 {
		interval = "year"
	}

	// Create Price
	priceParams := &stripe.PriceParams{
		Product:    stripe.String(p.ID),
		Currency:   stripe.String(strings.ToLower(g.currency)),
		UnitAmount: stripe.Int64(int64(pkg.Price * 100)),
		Recurring: &stripe.PriceRecurringParams{
			Interval: stripe.String(interval),
		},
		Metadata: map[string]string{
			"package_id": pkg.ID,
		},
	}
	pr, err := price.New(priceParams)
	if err != nil {
		return "", "", fmt.Errorf("create stripe price: %w", err)
	}

	return p.ID, pr.ID, nil
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
