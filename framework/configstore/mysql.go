package configstore

import (
	"context"
	"fmt"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

// buildMySQLDSN assembles a MySQL DSN from the validated config.
func buildMySQLDSN(config *MySQLConfig) string {
	return fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=UTC",
		config.User.GetValue(),
		config.Password.GetValue(),
		config.Host.GetValue(),
		config.Port.GetValue(),
		config.DBName.GetValue(),
	)
}

// openMySQLConnection opens a *gorm.DB against the configured MySQL instance
// using the shared bifrost logger. Used for both the throwaway migration pool
// and the runtime pool.
func openMySQLConnection(dsn string, logger schemas.Logger) (*gorm.DB, error) {
	return gorm.Open(mysql.New(mysql.Config{
		DSN: dsn,
	}), &gorm.Config{
		Logger: bifrost.NewGormLogger(logger),
	})
}

// applyMySQLPoolTuning applies MaxIdleConns / MaxOpenConns from config to
// the supplied *gorm.DB, falling back to defaults when the config leaves the
// field at zero.
func applyMySQLPoolTuning(db *gorm.DB, config *MySQLConfig) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	maxIdleConns := config.MaxIdleConns
	if maxIdleConns == 0 {
		maxIdleConns = 5
	}
	sqlDB.SetMaxIdleConns(maxIdleConns)
	maxOpenConns := config.MaxOpenConns
	if maxOpenConns == 0 {
		maxOpenConns = 50
	}
	sqlDB.SetMaxOpenConns(maxOpenConns)
	return nil
}

// MySQLConfig represents the configuration for a MySQL database.
type MySQLConfig struct {
	Host         *schemas.EnvVar `json:"host"`
	Port         *schemas.EnvVar `json:"port"`
	User         *schemas.EnvVar `json:"user"`
	Password     *schemas.EnvVar `json:"password"`
	DBName       *schemas.EnvVar `json:"db_name"`
	MaxIdleConns int             `json:"max_idle_conns"`
	MaxOpenConns int             `json:"max_open_conns"`
}

// newMySQLConfigStore creates a new MySQL config store.
//
// Uses a two-pool lifecycle to avoid cached prepared-statement plan
// invalidation after DDL: a throwaway migration pool runs DDL and is closed
// immediately, then a fresh runtime pool is opened. The runtime pool's
// connections never see pre-migration schema, so their cached prepared-plans
// stay valid for the life of the process.
func newMySQLConfigStore(ctx context.Context, config *MySQLConfig, logger schemas.Logger) (ConfigStore, error) {
	if config == nil {
		return nil, fmt.Errorf("config is required")
	}
	// Validate required config
	if config.Host == nil || config.Host.GetValue() == "" {
		return nil, fmt.Errorf("mysql host is required")
	}
	if config.Port == nil || config.Port.GetValue() == "" {
		return nil, fmt.Errorf("mysql port is required")
	}
	if config.User == nil || config.User.GetValue() == "" {
		return nil, fmt.Errorf("mysql user is required")
	}
	if config.Password == nil {
		return nil, fmt.Errorf("mysql password is required")
	}
	if config.DBName == nil || config.DBName.GetValue() == "" {
		return nil, fmt.Errorf("mysql db name is required")
	}

	dsn := buildMySQLDSN(config)

	// Throwaway pool for schema migrations. Closing it before the runtime pool
	// opens guarantees no cached prepared-plan survives the DDL.
	mDb, err := openMySQLConnection(dsn, logger)
	if err != nil {
		return nil, err
	}
	if err := triggerMigrations(ctx, mDb); err != nil {
		closeDbConn(mDb, logger)
		return nil, err
	}
	closeDbConn(mDb, logger)

	// Runtime pool. Opens against post-migration schema.
	db, err := openMySQLConnection(dsn, logger)
	if err != nil {
		return nil, err
	}
	if err := applyMySQLPoolTuning(db, config); err != nil {
		closeDbConn(db, logger)
		return nil, err
	}

	d := &RDBConfigStore{logger: logger}
	d.db.Store(db)

	// migrateOnFreshFn: downstream consumers (e.g. billing plugin) run
	// their migrations via this hook on a throwaway pool that closes after fn.
	d.migrateOnFreshFn = func(ctx context.Context, fn func(context.Context, *gorm.DB) error) error {
		tempDB, err := openMySQLConnection(dsn, logger)
		if err != nil {
			return err
		}
		defer closeDbConn(tempDB, logger)
		return fn(ctx, tempDB)
	}

	// refreshPoolFn: open fresh runtime pool first (so a failure leaves the
	// existing pool in place), swap atomically, then close the old pool.
	// sql.DB.Close blocks until in-flight queries finish, so callers already
	// using the old pool complete safely.
	d.refreshPoolFn = func(ctx context.Context) error {
		newDB, err := openMySQLConnection(dsn, logger)
		if err != nil {
			return fmt.Errorf("failed to open fresh runtime pool: %w", err)
		}
		if err := applyMySQLPoolTuning(newDB, config); err != nil {
			closeDbConn(newDB, logger)
			return fmt.Errorf("failed to tune fresh runtime pool: %w", err)
		}
		oldDB := d.db.Swap(newDB)
		if oldDB != nil {
			closeDbConn(oldDB, logger)
		}
		return nil
	}

	// Encrypt any plaintext rows if encryption is enabled. Runs on the
	// runtime pool — pure DML (SELECT + UPDATE), no DDL, so cached plans it
	// installs remain valid until the next external migration batch.
	if err := d.EncryptPlaintextRows(ctx); err != nil {
		closeDbConn(db, logger)
		return nil, fmt.Errorf("failed to encrypt plaintext rows: %w", err)
	}
	return d, nil
}
