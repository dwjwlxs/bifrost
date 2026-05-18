package tables

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

// BudgetType defines the type of budget: governance (spending limit) or billing (spending allowance)
type BudgetType string

const (
	BudgetTypeGovernance BudgetType = "governance" // Governance limit: AND logic, default
	BudgetTypeBilling    BudgetType = "billing"    // Billing allowance: OR logic, hybrid deduction
)

// TableBudget defines spending limits with configurable reset periods
type TableBudget struct {
	ID            string    `gorm:"primaryKey;type:varchar(255)" json:"id"`
	MaxLimit      float64   `gorm:"not null" json:"max_limit"`                       // Maximum budget in dollars
	ResetDuration string    `gorm:"type:varchar(50);not null" json:"reset_duration"` // e.g., "30s", "5m", "1h", "1d", "1w", "1M", "1Y", "0" (never reset, for balance type)
	LastReset     time.Time `gorm:"index" json:"last_reset"`                         // Last time budget was reset
	CurrentUsage  float64   `gorm:"default:0" json:"current_usage"`                  // Current usage in dollars

	// Owner FKs: a budget belongs to at most one of the following entities
	TeamID           *string `gorm:"type:varchar(255);index" json:"team_id,omitempty"`        // Governance + Billing
	VirtualKeyID     *string `gorm:"type:varchar(255);index" json:"virtual_key_id,omitempty"` // Governance only
	ProviderConfigID *uint   `gorm:"index" json:"provider_config_id,omitempty"`               // Governance only
	CustomerID       *string `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`    // Governance + Billing (NEW)
	UserID           *string `gorm:"type:varchar(255);index" json:"user_id,omitempty"`        // Governance + Billing (NEW)

	// User scope FKs (only valid when UserID != nil)
	UserScopeTeamID     *string `gorm:"type:varchar(255);index" json:"user_scope_team_id,omitempty"`     // Budget only applies to this User within this Team
	UserScopeCustomerID *string `gorm:"type:varchar(255);index" json:"user_scope_customer_id,omitempty"` // Budget only applies to this User within this Customer

	// Type field: governance (default) or billing
	Type BudgetType `gorm:"type:varchar(20);default:'governance';not null" json:"type"`

	// ExpiresAt is for one-time packages that expire at a specific time
	// Nil means never expires (balance type and subscription type)
	ExpiresAt *time.Time `gorm:"index" json:"expires_at,omitempty"`

	// OffPeakDiscount stores discount rules as JSON, copied from EntityPackage at purchase time
	// Used by BillingBudgetChecker during Deduct to apply off-peak discounts
	// Empty for balance-type budgets
	OffPeakDiscount string `gorm:"type:text" json:"off_peak_discount,omitempty"`

	CalendarAligned bool `gorm:"default:false" json:"calendar_aligned"` // When true, all budgets under this VK reset at clean calendar boundaries

	// Config hash is used to detect the changes synced from config.json file
	// Every time we sync the config.json file, we will update the config hash
	ConfigHash string `gorm:"type:varchar(255);null" json:"config_hash"`

	CreatedAt time.Time `gorm:"index;not null" json:"created_at"`
	UpdatedAt time.Time `gorm:"index;not null" json:"updated_at"`
}

// TableName sets the table name for each model
func (TableBudget) TableName() string { return "governance_budgets" }

// BeforeSave hook for Budget to validate owner constraints, type rules, scope rules, and reset duration
func (b *TableBudget) BeforeSave(tx *gorm.DB) error {
	if b.Type == "" {
		b.Type = BudgetTypeGovernance
	}

	// 1. A budget owner check

	// 2. Billing type cannot be attached to VirtualKey or ProviderConfig
	if b.Type == BudgetTypeBilling {
		// legal cases:
		// 1、userid not nil && teamid nil && customerid nil, user-wise budget
		// 2、customerid not nil && teamid nil && userid nil, org-wise budget
		if b.UserID == nil && b.CustomerID == nil {
			return fmt.Errorf("billing budget must have either user_id or customer_id set")
		}
		if b.VirtualKeyID != nil || b.ProviderConfigID != nil {
			return fmt.Errorf("billing budget cannot be attached to virtual key or provider config")
		}
	}

	// 3. Validate BudgetType value
	if b.Type != BudgetTypeGovernance && b.Type != BudgetTypeBilling {
		return fmt.Errorf("invalid budget type: %s (must be 'governance' or 'billing')", b.Type)
	}

	// 4. User scope validation: scope fields are only valid when UserID is set
	if b.Type == BudgetTypeGovernance {
		// legal cases:
		// 1、userid not nil && teamid nil && customerid nil, user-wise budget
		// 2、customerid not nil && teamid nil && userid nil, org-wise budget
		// 3、teamid not nil && userid nil && customerid nil, team-wise budget
		// 4、userid not nil && teamid not nil, user-in-team-wise budget
		// 5、userid not nil && teamid nil && customerid not nil, user-in-org-wise budget
	}
	if b.UserID != nil {
		// UserScopeTeamID and UserScopeCustomerID are mutually exclusive
		if b.UserScopeTeamID != nil && b.UserScopeCustomerID != nil {
			return fmt.Errorf("user budget scope cannot have both team_id and customer_id")
		}
	} else {
		// If UserID is nil, scope fields must also be nil
		if b.UserScopeTeamID != nil || b.UserScopeCustomerID != nil {
			return fmt.Errorf("user scope fields require user_id to be set")
		}
	}

	// 5. Validate ResetDuration format (d == 0 is allowed for balance type; d < 0 is not)
	if d, err := ParseDuration(b.ResetDuration); err != nil {
		if b.Type == BudgetTypeGovernance {
			return fmt.Errorf("invalid reset duration format: %s", b.ResetDuration)
		}
	} else if d < 0 {
		return fmt.Errorf("reset duration cannot be negative: %s", b.ResetDuration)
	}

	// 6. Validate that MaxLimit is not negative
	if b.MaxLimit < 0 {
		return fmt.Errorf("budget max_limit cannot be negative: %.2f", b.MaxLimit)
	}

	return nil
}
