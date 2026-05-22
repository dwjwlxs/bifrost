package tables

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

// EntityPackageStatus defines the status of an entity package instance
type EntityPackageStatus string

const (
	EntityPackageStatusActive    EntityPackageStatus = "active"
	EntityPackageStatusExpired   EntityPackageStatus = "expired"
	EntityPackageStatusCancelled EntityPackageStatus = "cancelled"
)

// EntityPackageSource defines how the entity package was created
type EntityPackageSource string

const (
	EntityPackageSourceOrder      EntityPackageSource = "order"
	EntityPackageSourceAdmin      EntityPackageSource = "admin"
	EntityPackageSourceRedemption EntityPackageSource = "redemption"
)

// TableEntityPackage represents a purchased package instance owned by a user or customer.
type TableEntityPackage struct {
	ID string `gorm:"type:varchar(36);primaryKey" json:"id"`

	UserID *string `gorm:"type:varchar(255);index" json:"user_id,omitempty"`

	// Tenant info: personal or organization
	TenantType TenantType `gorm:"type:varchar(20);not null;default:'personal'" json:"tenant_type"`
	TenantID   string     `gorm:"type:varchar(255)" json:"tenant_id"`

	PackageID string `gorm:"type:varchar(36);not null;index" json:"package_id"`

	BudgetID             *string `gorm:"type:varchar(255);index" json:"budget_id,omitempty"`
	RateLimitID          *string `gorm:"type:varchar(255);index" json:"rate_limit_id,omitempty"`
	UserProviderConfigID *string `gorm:"type:varchar(255);index" json:"user_provider_config_id,omitempty"`
	OffPeakDiscount      string  `gorm:"type:text" json:"off_peak_discount,omitempty"`

	AutoRenew              bool    `gorm:"default:false" json:"auto_renew"`
	StripeSubscriptionID *string `gorm:"type:varchar(128);index" json:"stripe_subscription_id,omitempty"`
	RenewedFromID        *string `gorm:"type:varchar(36);index" json:"renewed_from_id,omitempty"`
	SubscriptionGateway  string  `gorm:"type:varchar(32)" json:"subscription_gateway,omitempty"`
	PurchasedCredits     float64 `gorm:"type:double" json:"purchased_credits,omitempty"` // Quota in credits at time of purchase

	StartedAt time.Time `gorm:"not null;index" json:"started_at"`
	ExpiresAt time.Time `gorm:"not null;index" json:"expires_at"`

	Source  EntityPackageSource `gorm:"type:varchar(20);not null;default:'order'" json:"source"`
	OrderID *string             `gorm:"type:varchar(64)" json:"order_id,omitempty"`

	Status EntityPackageStatus `gorm:"type:varchar(20);not null;default:'active';index" json:"status"`

	CreatedAt time.Time `gorm:"index;not null" json:"created_at"`
	UpdatedAt time.Time `gorm:"index;not null" json:"updated_at"`

	Package TablePlatformPackage `gorm:"foreignKey:PackageID" json:"package,omitempty"`
}

func (TableEntityPackage) TableName() string { return "platform_entity_packages" }

// BeforeSave validates the entity package before persisting.
func (ep *TableEntityPackage) BeforeSave(tx *gorm.DB) error {
	if ep.TenantID == "" || ep.TenantType == "" {
		return fmt.Errorf("entity package must have TenantID and TenantType")
	}

	if ep.StartedAt.IsZero() {
		return fmt.Errorf("started_at is required")
	}
	if ep.ExpiresAt.IsZero() {
		return fmt.Errorf("expires_at is required")
	}
	if !ep.ExpiresAt.After(ep.StartedAt) {
		return fmt.Errorf("expires_at must be after started_at")
	}
	switch ep.Status {
	case EntityPackageStatusActive, EntityPackageStatusExpired, EntityPackageStatusCancelled:
	default:
		return fmt.Errorf("invalid entity package status: %s", ep.Status)
	}
	switch ep.Source {
	case EntityPackageSourceOrder, EntityPackageSourceAdmin, EntityPackageSourceRedemption:
	default:
		return fmt.Errorf("invalid entity package source: %s", ep.Source)
	}
	return nil
}
