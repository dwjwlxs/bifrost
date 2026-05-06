package tables

import "time"

// TableUser represents a user entity in the governance/billing system.
// TableUser existence indicates the user is in the billing system:
//   - Personal VKs: User must have at least one billing Budget to use the API
//   - TableUser absent: pure governance mode (existing behavior unchanged)
//   - Future: enterprise user-level governance budgets, profile, settings, etc.
type TableUser struct {
	ID   string `gorm:"primaryKey;type:varchar(255)" json:"id"`
	Name string `gorm:"type:varchar(255);not null" json:"name"`

	RateLimitID *string `gorm:"type:varchar(255);index" json:"rate_limit_id,omitempty"`

	// Relationships
	Budgets   []TableBudget   `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"budgets,omitempty"`
	RateLimit *TableRateLimit `gorm:"foreignKey:RateLimitID" json:"rate_limit,omitempty"`

	CreatedAt time.Time `gorm:"index;not null" json:"created_at"`
	UpdatedAt time.Time `gorm:"index;not null" json:"updated_at"`
}

// TableName sets the table name for the user model
func (TableUser) TableName() string { return "governance_users" }
