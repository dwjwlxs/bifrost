package tables

import "time"

// TablePlatformOrgMember maps users to organizations for multi-tenant RBAC.
type TablePlatformOrgMember struct {
	OrgID    string    `gorm:"primaryKey;type:varchar(255);not null" json:"org_id"`
	UserID   string    `gorm:"primaryKey;type:varchar(255);not null;index:idx_org_members_user" json:"user_id"`
	Role     string    `gorm:"type:varchar(20);not null;default:'member'" json:"role"`
	JoinedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"joined_at"`
}

func (TablePlatformOrgMember) TableName() string { return "platform_org_members" }
