package tables

import "time"

// TablePlatformTeamMember maps users to teams for multi-tenant RBAC.
type TablePlatformTeamMember struct {
	TeamID   string    `gorm:"primaryKey;type:varchar(255);not null" json:"team_id"`
	UserID   string    `gorm:"primaryKey;type:varchar(255);not null;index:idx_team_members_user" json:"user_id"`
	Role     string    `gorm:"type:varchar(20);not null;default:'member'" json:"role"`
	JoinedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"joined_at"`
}

func (TablePlatformTeamMember) TableName() string { return "platform_team_members" }
