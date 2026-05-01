package tables

import "time"

// TablePlatformAdmin represents a system-level administrator.
type TablePlatformAdmin struct {
	UserID    string    `gorm:"primaryKey;type:varchar(255);not null" json:"user_id"`
	Email     string    `gorm:"type:varchar(255);not null" json:"email"`
	CreatedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"created_at"`
}

func (TablePlatformAdmin) TableName() string { return "platform_admins" }
