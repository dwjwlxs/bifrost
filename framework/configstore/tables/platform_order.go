package tables

import "time"

// OrderType defines the type of order
type OrderType string

const (
	OrderTypeRecharge       OrderType = "recharge"       // Balance recharge order
	OrderTypePackagePurchase OrderType = "package_purchase" // Package purchase order
)

// OrderStatus defines the status of an order
type OrderStatus string

const (
	OrderStatusPending  OrderStatus = "pending"  // Order created, waiting for payment
	OrderStatusSuccess  OrderStatus = "success"  // Payment successful
	OrderStatusFailed   OrderStatus = "failed"   // Payment failed
	OrderStatusExpired  OrderStatus = "expired"  // Order expired without payment
	OrderStatusCanceled OrderStatus = "canceled" // Order canceled by user/admin
)

// TablePlatformOrder represents an order in the platform
type TablePlatformOrder struct {
	ID            uint         `gorm:"primaryKey;autoIncrement" json:"id"`
	OrderNo       string       `gorm:"uniqueIndex;type:varchar(64);not null" json:"order_no"` // Unique order number

	// Order ownership - either user or customer
	UserID     *string `gorm:"type:varchar(255);index" json:"user_id,omitempty"`
	CustomerID *string `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`

	// Order details
	Type       OrderType `gorm:"type:varchar(20);not null;index" json:"type"`
	Amount     float64   `gorm:"type:decimal(10,2);not null" json:"amount"`   // Amount in USD
	Credits    float64   `gorm:"type:decimal(20,6);default:0" json:"credits"` // Credits received (1 credit = $0.01)

	// Package purchase details - only filled for package_purchase orders
	PackageID        *string `gorm:"type:varchar(36);index" json:"package_id,omitempty"`
	EntityPackageID  *string `gorm:"type:varchar(36);index" json:"entity_package_id,omitempty"`

	// Payment details
	PaymentMethod string      `gorm:"type:varchar(20)" json:"payment_method"`
	PaymentID     string      `gorm:"type:varchar(200)" json:"payment_id,omitempty"`
	PaidAt        *time.Time `json:"paid_at,omitempty"`
	Status        OrderStatus `gorm:"type:varchar(20);not null;default:pending;index" json:"status"`

	// Raw payload from payment gateway for reconciliation
	ProviderPayload string `gorm:"type:text" json:"provider_payload,omitempty"`

	CreatedAt time.Time `gorm:"index;not null" json:"created_at"`
	UpdatedAt time.Time `gorm:"index;not null" json:"updated_at"`
}

// TableName sets the table name for platform orders
func (TablePlatformOrder) TableName() string { return "platform_orders" }
