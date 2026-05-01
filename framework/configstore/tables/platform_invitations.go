package tables

import "time"

// TablePlatformInvitation represents a pending invitation to join an org or team.
type TablePlatformInvitation struct {
	ID        string     `gorm:"primaryKey;type:varchar(255);not null" json:"id"`
	OrgID     *string    `gorm:"type:varchar(255);index" json:"org_id,omitempty"`
	TeamID    *string    `gorm:"type:varchar(255);index" json:"team_id,omitempty"`
	Email     string     `gorm:"type:varchar(255);not null;index" json:"email"`
	Role      string     `gorm:"type:varchar(20);not null;default:'member'" json:"role"`
	Token     string     `gorm:"type:varchar(255);not null;uniqueIndex" json:"token"`
	ExpiresAt time.Time  `gorm:"not null" json:"expires_at"`
	Accepted  bool       `gorm:"not null;default:false" json:"accepted"`
	CreatedAt time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"created_at"`
}

func (TablePlatformInvitation) TableName() string { return "platform_invitations" }
