package tables

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"gorm.io/gorm"
)

// TableUserProviderConfig represents per-user, per-provider model access rules.
// Purchased packages upsert rows here; the governance PreHook checks model access.
type TableUserProviderConfig struct {
	ID       string `gorm:"primaryKey;autoIncrement" json:"id"`
	UserID   string `gorm:"type:varchar(255);not null;index:idx_user_provider" json:"user_id"`
	Provider string `gorm:"type:varchar(50);not null;index:idx_user_provider" json:"provider"`

	AllowedModels schemas.WhiteList `gorm:"type:text;serializer:json" json:"allowed_models"`

	EntityPackageID *string `gorm:"type:varchar(36);index" json:"entity_package_id,omitempty"`

	ModelConfig string `gorm:"type:text" json:"model_config,omitempty"`

	CreatedAt time.Time `gorm:"index;not null" json:"created_at"`
	UpdatedAt time.Time `gorm:"index;not null" json:"updated_at"`
}

func (TableUserProviderConfig) TableName() string { return "governance_user_provider_configs" }

// BeforeSave validates WhiteList fields before GORM persists the record.
func (upc *TableUserProviderConfig) BeforeSave(tx *gorm.DB) error {
	if err := upc.AllowedModels.Validate(); err != nil {
		return fmt.Errorf("invalid allowed_models: %w", err)
	}
	if upc.ModelConfig != "" {
		if !json.Valid([]byte(upc.ModelConfig)) {
			return fmt.Errorf("model_config must be valid JSON")
		}
	}
	return nil
}

// MarshalJSON ensures AllowedModels is always an array (never null).
func (upc TableUserProviderConfig) MarshalJSON() ([]byte, error) {
	type Alias TableUserProviderConfig

	allowedModels := upc.AllowedModels
	if allowedModels == nil {
		allowedModels = []string{}
	}

	return json.Marshal(&struct {
		Alias
		AllowedModels []string `json:"allowed_models"`
	}{
		Alias:         Alias(upc),
		AllowedModels: allowedModels,
	})
}
