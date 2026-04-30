package auth

import (
	"context"
	"fmt"

	"github.com/maximhq/bifrost/framework/migrator"
	"gorm.io/gorm"
)

// Migrate creates all auth-related tables using the same migrator
// framework as configstore migrations.
// Safe to call multiple times — idempotent via HasTable checks.
func Migrate(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{
		{
			ID: "auth_init",
			Migrate: func(tx *gorm.DB) error {
				tx = tx.WithContext(ctx)
				mg := tx.Migrator()

				if !mg.HasTable(&gormUser{}) {
					if err := mg.CreateTable(&gormUser{}); err != nil {
						return fmt.Errorf("create auth_users: %w", err)
					}
				}

				if !mg.HasTable(&gormSession{}) {
					if err := mg.CreateTable(&gormSession{}); err != nil {
						return fmt.Errorf("create auth_sessions: %w", err)
					}
				}

				if !mg.HasTable(&gormVerificationCode{}) {
					if err := mg.CreateTable(&gormVerificationCode{}); err != nil {
						return fmt.Errorf("create auth_verification_codes: %w", err)
					}
				}

				if !mg.HasTable(&gormIdentity{}) {
					if err := mg.CreateTable(&gormIdentity{}); err != nil {
						return fmt.Errorf("create auth_identities: %w", err)
					}
				}

				return nil
			},
			Rollback: func(tx *gorm.DB) error {
				tx = tx.WithContext(ctx)
				mg := tx.Migrator()
				// Drop in reverse order due to potential FK references
				_ = mg.DropTable(&gormIdentity{})
				_ = mg.DropTable(&gormVerificationCode{})
				_ = mg.DropTable(&gormSession{})
				_ = mg.DropTable(&gormUser{})
				return nil
			},
		},
	})

	if err := m.Migrate(); err != nil {
		return fmt.Errorf("auth migration failed: %w", err)
	}
	return nil
}
