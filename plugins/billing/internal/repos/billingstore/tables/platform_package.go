package tables

import (
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// TablePlatformPackage represents a package product template that defines
// purchasable bundles of billing quota, rate limits, allowed models, and discounts.
type TablePlatformPackage struct {
	ID          string  `gorm:"type:varchar(36);primaryKey" json:"id"`
	Name        string  `gorm:"type:varchar(100);not null" json:"name"`
	Description string  `gorm:"type:text" json:"description,omitempty"`
	Price       float64 `gorm:"type:decimal(10,2);not null" json:"price"`
	Quota       float64 `gorm:"type:decimal(20,6);not null" json:"quota"`
	Duration    int     `gorm:"not null" json:"duration"`

	RateLimitConfig string `gorm:"type:text" json:"rate_limit_config,omitempty"`
	AllowedModels   string `gorm:"type:text" json:"allowed_models,omitempty"`
	OffPeakDiscount string `gorm:"type:text" json:"off_peak_discount,omitempty"`
	AutoRenew       bool   `gorm:"default:false" json:"auto_renew"`

	TargetType         string `gorm:"type:varchar(20);not null;default:'both'" json:"target_type"`
	MaxPurchasePerUser int    `gorm:"default:0" json:"max_purchase_per_user"`

	IsActive  bool `gorm:"default:true;index" json:"is_active"`
	SortOrder int  `gorm:"default:0" json:"sort_order"`

	StripePriceID *string `gorm:"type:varchar(128)" json:"stripe_price_id,omitempty"`

	CreatedAt time.Time `gorm:"index;not null" json:"created_at"`
	UpdatedAt time.Time `gorm:"index;not null" json:"updated_at"`
}

func (TablePlatformPackage) TableName() string { return "platform_packages" }

// BeforeCreate validates the package template before inserting a new record.
// It intentionally does NOT run on Update — partial field updates (e.g. changing
// price alone) must succeed without triggering full-record validation.
func (p *TablePlatformPackage) BeforeCreate(tx *gorm.DB) error {
	if p.Name == "" {
		return fmt.Errorf("package name is required")
	}
	if p.Price < 0 {
		return fmt.Errorf("package price cannot be negative: %.2f", p.Price)
	}
	if p.Quota <= 0 {
		return fmt.Errorf("package quota must be positive: %.6f", p.Quota)
	}
	if p.Duration <= 0 {
		return fmt.Errorf("package duration must be positive: %d", p.Duration)
	}
	if p.TargetType != "user" && p.TargetType != "customer" && p.TargetType != "both" {
		return fmt.Errorf("invalid target_type: %s (must be 'user', 'customer', or 'both')", p.TargetType)
	}
	if p.RateLimitConfig != "" {
		if !json.Valid([]byte(p.RateLimitConfig)) {
			return fmt.Errorf("rate_limit_config must be valid JSON")
		}
	}
	if p.AllowedModels != "" {
		if !json.Valid([]byte(p.AllowedModels)) {
			return fmt.Errorf("allowed_models must be valid JSON")
		}
	}
	if p.OffPeakDiscount != "" {
		if !json.Valid([]byte(p.OffPeakDiscount)) {
			return fmt.Errorf("off_peak_discount must be valid JSON")
		}
	}
	return nil
}
