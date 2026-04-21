package configstore

import (
	"context"
	"fmt"

	"github.com/maximhq/bifrost/core/schemas"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

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

	// MySQL DSN format: user:password@tcp(host:port)/dbname?charset=utf8mb4&parseTime=True&loc=Local
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=UTC",
		config.User.GetValue(),
		config.Password.GetValue(),
		config.Host.GetValue(),
		config.Port.GetValue(),
		config.DBName.GetValue(),
	)
	db, err := gorm.Open(mysql.New(mysql.Config{
		DSN: dsn,
	}), &gorm.Config{
		Logger: newGormLogger(logger),
	})
	if err != nil {
		return nil, err
	}

	// Configure connection pool
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	// Set MaxIdleConns (default: 5)
	maxIdleConns := config.MaxIdleConns
	if maxIdleConns == 0 {
		maxIdleConns = 5
	}
	sqlDB.SetMaxIdleConns(maxIdleConns)

	// Set MaxOpenConns (default: 50)
	maxOpenConns := config.MaxOpenConns
	if maxOpenConns == 0 {
		maxOpenConns = 50
	}
	sqlDB.SetMaxOpenConns(maxOpenConns)

	d := &RDBConfigStore{logger: logger}
	d.db.Store(db)
	// Run migrations
	if err := triggerMigrations(ctx, db); err != nil {
		// Closing the DB connection
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			if closeErr := sqlDB.Close(); closeErr != nil {
				logger.Error("failed to close DB connection: %v", closeErr)
			}
		}
		return nil, err
	}
	// Encrypt any plaintext rows if encryption is enabled
	if err := d.EncryptPlaintextRows(ctx); err != nil {
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			if closeErr := sqlDB.Close(); closeErr != nil {
				logger.Error("failed to close DB connection: %v", closeErr)
			}
		}
		return nil, fmt.Errorf("failed to encrypt plaintext rows: %w", err)
	}
	return d, nil
}
