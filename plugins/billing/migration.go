package billing

import (
	"context"
	"database/sql"
	"fmt"
	"sync"

	"github.com/dwjwlxs/bifrost/plugins/billing/internal/repos/billingstore/tables"
	"github.com/dwjwlxs/bifrost/plugins/billing/internal/services/authn"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/migrator"
	"gorm.io/gorm"
)

// billingTables 需要自动迁移的 billing 相关表
var billingTables = []interface{}{
	&tables.TablePlatformOrder{},
	&tables.TablePlatformPackage{},
	&tables.TableEntityPackage{},
	&tables.TableUserProviderConfig{},
	&tables.TablePlatformAdmin{},
	&tables.TablePlatformInvitation{},
	&tables.TablePlatformOrgMember{},
	&tables.TablePlatformTeamMember{},
}

// migrationAdvisoryLockKey is used for PostgreSQL advisory locks
// to serialize migrations across cluster nodes.
const migrationAdvisoryLockKey = 1000002

// migrationLock holds a dedicated connection for the advisory lock.
// This ensures the lock is held on the same connection throughout migrations,
// preventing race conditions caused by GORM's connection pooling.
type migrationLock struct {
	conn *sql.Conn
}

// acquireMigrationLock gets a dedicated connection and acquires an advisory lock.
// For non-PostgreSQL databases, returns a no-op lock.
func acquireMigrationLock(ctx context.Context, db *gorm.DB) (*migrationLock, error) {
	if db.Dialector.Name() != "postgres" {
		return &migrationLock{}, nil
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get sql.DB: %w", err)
	}

	// Get a dedicated connection (not returned to pool until Close())
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get dedicated connection: %w", err)
	}

	// Acquire advisory lock on this dedicated connection.
	// This will BLOCK if another node holds the lock.
	_, err = conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", migrationAdvisoryLockKey)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to acquire migration advisory lock: %w", err)
	}

	return &migrationLock{conn: conn}, nil
}

// release unlocks and closes the dedicated connection.
func (l *migrationLock) release(ctx context.Context) {
	if l.conn == nil {
		return
	}
	// Release lock on the SAME connection that acquired it
	_, _ = l.conn.ExecContext(ctx, "SELECT pg_advisory_unlock($1)", migrationAdvisoryLockKey)
	l.conn.Close()
}

var (
	_migrationInit    sync.Once
	_migrationInitErr error
)

// TriggerMigrations runs all migrations including schema init.
// It is safe to call multiple times (e.g. after plugin upgrade) — migrations
// are idempotent via gormigrate's migration ID deduplication.
func TriggerMigrations(ctx context.Context, store configstore.ConfigStore) error {
	_migrationInit.Do(func() {
		_migrationInitErr = runMigrations(ctx, store)
	})
	return _migrationInitErr
}

// runMigrations runs all migrations.
// It acquires a PostgreSQL advisory lock (no-op on other DBs) to serialize
// migrations across cluster nodes, then runs each migration via
// ConfigStore.RunMigration on a fresh throwaway connection. After all migrations
// complete, it refreshes the ConfigStore connection pool to avoid cached
// prepared-statement plans.
func runMigrations(ctx context.Context, store configstore.ConfigStore) error {
	// Run all migrations via ConfigStore.RunMigration so each gets a fresh
	// throwaway connection that closes after the migration. This prevents DDL
	// from leaving cached prepared-statement plans on the runtime pool.
	if store == nil {
		return fmt.Errorf("configstore is nil")
	}
	// The advisory lock (PostgreSQL only) ensures that even if multiple nodes
	// attempt to migrate simultaneously, only one succeeds and the others wait.
	migrations := []struct {
		id string
		fn func(context.Context, *gorm.DB) error
	}{
		{"billing_add_governance_users_table", migrationAddGovernanceUsersTable},
		{"billing_add_platform_packages_table", migrationAddPlatformPackagesTable},
		{"billing_add_platform_entity_packages_table", migrationAddPlatformEntityPackagesTable},
		{"billing_add_user_provider_configs_table", migrationAddUserProviderConfigsTable},
		{"billing_add_platform_orders_table", migrationAddPlatformOrdersTable},
		{"billing_add_owner_user_id_column", migrationAddOwnerUserIDColumn},
		{"billing_add_platform_org_members_table", migrationAddPlatformOrgMembersTable},
		{"billing_add_platform_team_members_table", migrationAddPlatformTeamMembersTable},
		{"billing_add_platform_admins_table", migrationAddPlatformAdminsTable},
		{"billing_add_platform_invitations_table", migrationAddPlatformInvitationsTable},
		{"billing_add_billing_fields_to_budgets_table", migrationAddBillingFieldsToBudgetsTable},
		{"billing_convert_customer_to_multi_budget", migrationConvertCustomerToMultiBudget},
		{"billing_add_user_id_to_virtual_keys_table", migrationAddUserIDToVirtualKeysTable},
		{"billing_add_stripe_subscription_id_to_entity_packages", migrationAddStripeSubscriptionIDToEntityPackages},
		{"billing_add_subscription_gateway_to_entity_packages", migrationAddSubscriptionGatewayToEntityPackages},
		{"billing_add_purchased_credits_to_entity_packages", migrationAddPurchasedCreditsToEntityPackages},
		{"billing_add_stripe_product_price_to_packages", migrationAddStripeProductPriceToPackages},
	}

	// Acquire migration lock. For PostgreSQL this serializes across cluster nodes;
	// for MySQL/SQLite it is a no-op.
	lock, err := acquireMigrationLock(ctx, store.DB())
	if err != nil {
		return fmt.Errorf("failed to acquire migration lock: %w", err)
	}
	defer lock.release(ctx)

	// init schemas
	if err := store.RunMigration(ctx, func(ctx context.Context, db *gorm.DB) error {
		for _, table := range billingTables {
			if err := db.WithContext(ctx).AutoMigrate(table); err != nil {
				return fmt.Errorf("failed to migrate billing table %T: %w", table, err)
			}
		}
		return nil
	}); err != nil {
		return err
	}

	// auth schemas
	if err := store.RunMigration(ctx, func(ctx context.Context, db *gorm.DB) error {
		return authn.Migrate(ctx, db)
	}); err != nil {
		return err
	}

	for _, m := range migrations {
		if err := store.RunMigration(ctx, m.fn); err != nil {
			return fmt.Errorf("billing migration %q failed: %w", m.id, err)
		}
	}

	// Refresh the connection pool so the runtime pool has no cached plans
	// from the migration connections.
	if err := store.RefreshConnectionPool(ctx); err != nil {
		return fmt.Errorf("failed to refresh connection pool after migrations: %w", err)
	}

	return nil
}

// Individual migration functions — each is a self-contained gormigrate migration.
// They follow the same pattern as framework/configstore/migrations.go.

// migrationAddGovernanceUsersTable creates the governance_users table for the
// billing/governance dual-track system. TableUser existence indicates the user
// is in the billing system and must have at least one billing Budget to use the API.
func migrationAddGovernanceUsersTable(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_governance_users_table",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if !migrator.HasTable(&tables.TableUser{}) {
				if err := migrator.CreateTable(&tables.TableUser{}); err != nil {
					return fmt.Errorf("failed to create governance_users table: %w", err)
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if migrator.HasTable(&tables.TableUser{}) {
				if err := migrator.DropTable(&tables.TableUser{}); err != nil {
					return fmt.Errorf("failed to drop governance_users table: %w", err)
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_governance_users_table migration: %s", err.Error())
	}
	return nil
}

// migrationAddPlatformPackagesTable creates the platform_packages table for
// available package definitions.
func migrationAddPlatformPackagesTable(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_platform_packages_table",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if !migrator.HasTable(&tables.TablePlatformPackage{}) {
				if err := migrator.CreateTable(&tables.TablePlatformPackage{}); err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if migrator.HasTable(&tables.TablePlatformPackage{}) {
				if err := migrator.DropTable(&tables.TablePlatformPackage{}); err != nil {
					return err
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_platform_packages_table migration: %s", err.Error())
	}
	return nil
}

// migrationAddPlatformEntityPackagesTable creates the platform_entity_packages table
// for purchased package instances.
func migrationAddPlatformEntityPackagesTable(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_platform_entity_packages_table",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if !migrator.HasTable(&tables.TableEntityPackage{}) {
				if err := migrator.CreateTable(&tables.TableEntityPackage{}); err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if migrator.HasTable(&tables.TableEntityPackage{}) {
				if err := migrator.DropTable(&tables.TableEntityPackage{}); err != nil {
					return err
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_platform_entity_packages_table migration: %s", err.Error())
	}
	return nil
}

// migrationAddUserProviderConfigsTable creates the governance_user_provider_configs table
// for per-user, per-provider model access rules.
func migrationAddUserProviderConfigsTable(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_user_provider_configs_table",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if !migrator.HasTable(&tables.TableUserProviderConfig{}) {
				if err := migrator.CreateTable(&tables.TableUserProviderConfig{}); err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if migrator.HasTable(&tables.TableUserProviderConfig{}) {
				if err := migrator.DropTable(&tables.TableUserProviderConfig{}); err != nil {
					return err
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_user_provider_configs_table migration: %s", err.Error())
	}
	return nil
}

func migrationAddPlatformOrdersTable(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_platform_orders_table",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if !migrator.HasTable(&tables.TablePlatformOrder{}) {
				if err := migrator.CreateTable(&tables.TablePlatformOrder{}); err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if migrator.HasTable(&tables.TablePlatformOrder{}) {
				if err := migrator.DropTable(&tables.TablePlatformOrder{}); err != nil {
					return err
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_platform_orders_table migration: %s", err.Error())
	}
	return nil
}

// migrationAddOwnerUserIDColumn adds the owner_user_id column to the governance_customers table.
func migrationAddOwnerUserIDColumn(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_owner_user_id_column",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if !migrator.HasColumn(&configstoreTables.TableCustomer{}, "owner_user_id") {
				if err := migrator.AddColumn(&configstoreTables.TableCustomer{}, "owner_user_id"); err != nil {
					return fmt.Errorf("failed to add owner_user_id column: %w", err)
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if migrator.HasColumn(&configstoreTables.TableCustomer{}, "owner_user_id") {
				if err := migrator.DropColumn(&configstoreTables.TableCustomer{}, "owner_user_id"); err != nil {
					return fmt.Errorf("failed to drop owner_user_id column: %w", err)
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_owner_user_id_column migration: %s", err.Error())
	}
	return nil
}

// migrationAddPlatformOrgMembersTable creates the platform_org_members table for
// multi-tenant RBAC — maps users to organizations.
func migrationAddPlatformOrgMembersTable(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_platform_org_members_table",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if !migrator.HasTable(&tables.TablePlatformOrgMember{}) {
				if err := migrator.CreateTable(&tables.TablePlatformOrgMember{}); err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if migrator.HasTable(&tables.TablePlatformOrgMember{}) {
				if err := migrator.DropTable(&tables.TablePlatformOrgMember{}); err != nil {
					return err
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_platform_org_members_table migration: %s", err.Error())
	}
	return nil
}

// migrationAddPlatformTeamMembersTable creates the platform_team_members table for
// multi-tenant RBAC — maps users to teams.
func migrationAddPlatformTeamMembersTable(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_platform_team_members_table",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if !migrator.HasTable(&tables.TablePlatformTeamMember{}) {
				if err := migrator.CreateTable(&tables.TablePlatformTeamMember{}); err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if migrator.HasTable(&tables.TablePlatformTeamMember{}) {
				if err := migrator.DropTable(&tables.TablePlatformTeamMember{}); err != nil {
					return err
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_platform_team_members_table migration: %s", err.Error())
	}
	return nil
}

// migrationAddPlatformAdminsTable creates the platform_admins table for system-level
// administrator records.
func migrationAddPlatformAdminsTable(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_platform_admins_table",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if !migrator.HasTable(&tables.TablePlatformAdmin{}) {
				if err := migrator.CreateTable(&tables.TablePlatformAdmin{}); err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if migrator.HasTable(&tables.TablePlatformAdmin{}) {
				if err := migrator.DropTable(&tables.TablePlatformAdmin{}); err != nil {
					return err
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_platform_admins_table migration: %s", err.Error())
	}
	return nil
}

// migrationAddPlatformInvitationsTable creates the platform_invitations table for
// pending invitations to join an org or team.
func migrationAddPlatformInvitationsTable(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_platform_invitations_table",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if !migrator.HasTable(&tables.TablePlatformInvitation{}) {
				if err := migrator.CreateTable(&tables.TablePlatformInvitation{}); err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()
			if migrator.HasTable(&tables.TablePlatformInvitation{}) {
				if err := migrator.DropTable(&tables.TablePlatformInvitation{}); err != nil {
					return err
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_platform_invitations_table migration: %s", err.Error())
	}
	return nil
}

// migrationAddBillingFieldsToBudgetsTable adds billing-related columns to the
// governance_budgets table: type, user_id, customer_id, user_scope_team_id,
// user_scope_customer_id, expires_at, off_peak_discount.
// Existing rows default to type='governance', preserving current behavior.
func migrationAddBillingFieldsToBudgetsTable(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_billing_fields_to_budgets_table",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()

			columns := []struct {
				table  interface{}
				column string
				field  string
			}{
				{&configstoreTables.TableBudget{}, "type", "Type"},
				{&configstoreTables.TableBudget{}, "user_id", "UserID"},
				{&configstoreTables.TableBudget{}, "customer_id", "CustomerID"},
				{&configstoreTables.TableBudget{}, "user_scope_team_id", "UserScopeTeamID"},
				{&configstoreTables.TableBudget{}, "user_scope_customer_id", "UserScopeCustomerID"},
				{&configstoreTables.TableBudget{}, "expires_at", "ExpiresAt"},
				{&configstoreTables.TableBudget{}, "off_peak_discount", "OffPeakDiscount"},
			}

			for _, c := range columns {
				if !migrator.HasColumn(c.table, c.column) {
					if err := migrator.AddColumn(c.table, c.field); err != nil {
						return fmt.Errorf("failed to add %s column to governance_budgets: %w", c.column, err)
					}
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migrator := tx.Migrator()

			columns := []struct {
				table  interface{}
				column string
			}{
				{&configstoreTables.TableBudget{}, "off_peak_discount"},
				{&configstoreTables.TableBudget{}, "expires_at"},
				{&configstoreTables.TableBudget{}, "user_scope_customer_id"},
				{&configstoreTables.TableBudget{}, "user_scope_team_id"},
				{&configstoreTables.TableBudget{}, "customer_id"},
				{&configstoreTables.TableBudget{}, "user_id"},
				{&configstoreTables.TableBudget{}, "type"},
			}

			for _, c := range columns {
				if migrator.HasColumn(c.table, c.column) {
					if err := migrator.DropColumn(c.table, c.column); err != nil {
						return fmt.Errorf("failed to drop %s column from governance_budgets: %w", c.column, err)
					}
				}
			}

			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_billing_fields_to_budgets_table migration: %s", err.Error())
	}
	return nil
}

// migrationConvertCustomerToMultiBudget converts TableCustomer from single BudgetID
// to multiple Budgets (has-many via CustomerID FK). It:
//  1. Migrates existing budget_id references: sets customer_id on the referenced budget row
//  2. Drops the legacy FK constraint fk_governance_customers_budget (MySQL only)
//  3. Drops the legacy budget_id column from governance_customers
func migrationConvertCustomerToMultiBudget(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "convert_customer_to_multi_budget",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migr := tx.Migrator()

			// Step 1: Migrate data — set customer_id on budgets referenced by budget_id
			if migr.HasColumn(&configstoreTables.TableCustomer{}, "budget_id") {
				// Only run data migration if the budget_id column still exists
				// and the target customer_id column exists on governance_budgets
				if migr.HasColumn(&configstoreTables.TableBudget{}, "customer_id") {
					if err := tx.Exec(`
						UPDATE governance_budgets b
						JOIN governance_customers c ON c.budget_id = b.id
						SET b.customer_id = c.id
						WHERE c.budget_id IS NOT NULL AND b.customer_id IS NULL
					`).Error; err != nil {
						// Log but don't fail — data migration is best-effort for new installs
						_ = err
					}
				}
				// Step 2: Drop the FK constraint (MySQL — PostgreSQL cascades on column drop)
				if tx.Dialector.Name() == "mysql" {
					if err := tx.Exec("ALTER TABLE governance_customers DROP FOREIGN KEY fk_governance_customers_budget").Error; err != nil {
						return fmt.Errorf("failed to drop FK constraint fk_governance_customers_budget: %w", err)
					}
				}
				// Step 3: Drop the legacy budget_id column
				if err := migr.DropColumn(&configstoreTables.TableCustomer{}, "budget_id"); err != nil {
					return fmt.Errorf("failed to drop budget_id column from governance_customers: %w", err)
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migr := tx.Migrator()
			// Re-add the budget_id column if it doesn't exist
			if !migr.HasColumn(&configstoreTables.TableCustomer{}, "budget_id") {
				if err := migr.AddColumn(&configstoreTables.TableCustomer{}, "BudgetID"); err != nil {
					return fmt.Errorf("failed to re-add budget_id column to governance_customers: %w", err)
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running convert_customer_to_multi_budget migration: %s", err.Error())
	}
	return nil
}

// migrationAddUserIDToVirtualKeysTable adds the user_id column and index to
// the governance_virtual_keys table. The UserID field on TableVirtualKey
// coexists with TeamID/CustomerID (not mutually exclusive) and is required
// when billing is enabled.
func migrationAddUserIDToVirtualKeysTable(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_user_id_to_virtual_keys_table",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migr := tx.Migrator()

			// Add user_id column if it doesn't exist
			if !migr.HasColumn(&configstoreTables.TableVirtualKey{}, "user_id") {
				if err := migr.AddColumn(&configstoreTables.TableVirtualKey{}, "UserID"); err != nil {
					return fmt.Errorf("failed to add user_id column to governance_virtual_keys: %w", err)
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migr := tx.Migrator()

			if migr.HasColumn(&configstoreTables.TableVirtualKey{}, "user_id") {
				if err := migr.DropColumn(&configstoreTables.TableVirtualKey{}, "user_id"); err != nil {
					return fmt.Errorf("failed to drop user_id column from governance_virtual_keys: %w", err)
				}
			}

			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_user_id_to_virtual_keys_table migration: %s", err.Error())
	}
	return nil
}

// migrationAddStripeSubscriptionIDToEntityPackages adds the stripe_subscription_id column
// to platform_entity_packages for managing subscription auto-renewal.
func migrationAddStripeSubscriptionIDToEntityPackages(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_stripe_subscription_id_to_entity_packages",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migr := tx.Migrator()
			if !migr.HasColumn(&tables.TableEntityPackage{}, "stripe_subscription_id") {
				if err := migr.AddColumn(&tables.TableEntityPackage{}, "StripeSubscriptionID"); err != nil {
					return fmt.Errorf("failed to add stripe_subscription_id column to platform_entity_packages: %w", err)
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migr := tx.Migrator()
			if migr.HasColumn(&tables.TableEntityPackage{}, "stripe_subscription_id") {
				if err := migr.DropColumn(&tables.TableEntityPackage{}, "stripe_subscription_id"); err != nil {
					return fmt.Errorf("failed to drop stripe_subscription_id column from platform_entity_packages: %w", err)
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_stripe_subscription_id_to_entity_packages migration: %s", err.Error())
	}
	return nil
}

// migrationAddSubscriptionGatewayToEntityPackages adds subscription_gateway column
// to platform_entity_packages for tracking which payment gateway manages the subscription.
func migrationAddSubscriptionGatewayToEntityPackages(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_subscription_gateway_to_entity_packages",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migr := tx.Migrator()
			if !migr.HasColumn(&tables.TableEntityPackage{}, "subscription_gateway") {
				if err := migr.AddColumn(&tables.TableEntityPackage{}, "SubscriptionGateway"); err != nil {
					return fmt.Errorf("failed to add subscription_gateway column to platform_entity_packages: %w", err)
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migr := tx.Migrator()
			if migr.HasColumn(&tables.TableEntityPackage{}, "subscription_gateway") {
				if err := migr.DropColumn(&tables.TableEntityPackage{}, "subscription_gateway"); err != nil {
					return fmt.Errorf("failed to drop subscription_gateway column from platform_entity_packages: %w", err)
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_subscription_gateway_to_entity_packages migration: %s", err.Error())
	}
	return nil
}

// migrationAddPurchasedCreditsToEntityPackages adds purchased_credits column
// to platform_entity_packages for storing the quota at time of purchase (used for renewals).
func migrationAddPurchasedCreditsToEntityPackages(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_purchased_credits_to_entity_packages",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migr := tx.Migrator()
			if !migr.HasColumn(&tables.TableEntityPackage{}, "purchased_credits") {
				if err := migr.AddColumn(&tables.TableEntityPackage{}, "PurchasedCredits"); err != nil {
					return fmt.Errorf("failed to add purchased_credits column to platform_entity_packages: %w", err)
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migr := tx.Migrator()
			if migr.HasColumn(&tables.TableEntityPackage{}, "purchased_credits") {
				if err := migr.DropColumn(&tables.TableEntityPackage{}, "purchased_credits"); err != nil {
					return fmt.Errorf("failed to drop purchased_credits column from platform_entity_packages: %w", err)
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_purchased_credits_to_entity_packages migration: %s", err.Error())
	}
	return nil
}

// migrationAddStripeProductPriceToPackages adds stripe_product_id and stripe_price_id columns
// to platform_packages for supporting pre-created Stripe Products and Prices.
func migrationAddStripeProductPriceToPackages(ctx context.Context, db *gorm.DB) error {
	m := migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "add_stripe_product_price_to_packages",
		Migrate: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migr := tx.Migrator()
			if !migr.HasColumn(&tables.TablePlatformPackage{}, "stripe_product_id") {
				if err := migr.AddColumn(&tables.TablePlatformPackage{}, "StripeProductID"); err != nil {
					return fmt.Errorf("failed to add stripe_product_id column to platform_packages: %w", err)
				}
			}
			if !migr.HasColumn(&tables.TablePlatformPackage{}, "stripe_price_id") {
				if err := migr.AddColumn(&tables.TablePlatformPackage{}, "StripePriceID"); err != nil {
					return fmt.Errorf("failed to add stripe_price_id column to platform_packages: %w", err)
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tx = tx.WithContext(ctx)
			migr := tx.Migrator()
			if migr.HasColumn(&tables.TablePlatformPackage{}, "stripe_product_id") {
				if err := migr.DropColumn(&tables.TablePlatformPackage{}, "stripe_product_id"); err != nil {
					return fmt.Errorf("failed to drop stripe_product_id column from platform_packages: %w", err)
				}
			}
			if migr.HasColumn(&tables.TablePlatformPackage{}, "stripe_price_id") {
				if err := migr.DropColumn(&tables.TablePlatformPackage{}, "stripe_price_id"); err != nil {
					return fmt.Errorf("failed to drop stripe_price_id column from platform_packages: %w", err)
				}
			}
			return nil
		},
	}})
	if err := m.Migrate(); err != nil {
		return fmt.Errorf("error running add_stripe_product_price_to_packages migration: %s", err.Error())
	}
	return nil
}
