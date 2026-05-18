package cache

import "github.com/maximhq/bifrost/framework/vectorstore"

// CacheConfig holds the shared cache configuration.
// Currently contains Redis settings used by billing plugin for budget caching.
type CacheConfig struct {
	Redis *vectorstore.RedisConfig `json:"redis,omitempty"` // TODO:这个从config.json获取
}
