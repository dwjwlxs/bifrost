package tables

import "gorm.io/gorm"

// PlatformMigrate auto-migrates all platform multi-tenant tables.
// It is idempotent — calling it when tables already exist is safe.
func PlatformMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&TablePlatformOrgMember{},
		&TablePlatformTeamMember{},
		&TablePlatformAdmin{},
		&TablePlatformInvitation{},
	)
}
