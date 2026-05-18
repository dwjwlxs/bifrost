package cache

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"

	"github.com/maximhq/bifrost/framework/vectorstore"
	"github.com/redis/go-redis/v9"
)

// NewRedisClient creates a Redis client from the given config.
// If Addr is empty, returns nil client and no error (caller can treat as disabled).
func NewRedisClient(ctx context.Context, cfg *vectorstore.RedisConfig) (redis.UniversalClient, error) {
	if cfg == nil || cfg.Addr.GetValue() == "" {
		return nil, nil
	}

	opts := &redis.Options{
		Addr:     cfg.Addr.GetValue(),
		Username: cfg.Username.GetValue(),
		Password: cfg.Password.GetValue(),
		DB:       cfg.DB.CoerceInt(0),
		Dialer: func(ctx context.Context, network, addr string) (net.Conn, error) {
			dialer := &net.Dialer{Timeout: cfg.DialTimeout}
			if cfg.UseTLS.CoerceBool(false) {
				return tls.Dial("tcp", addr, &tls.Config{
					InsecureSkipVerify: cfg.InsecureSkipVerify.CoerceBool(false),
				})
			}
			return dialer.DialContext(ctx, network, addr)
		},

		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,

		MaxActiveConns:  cfg.MaxActiveConns,
		MinIdleConns:    cfg.MinIdleConns,
		MaxIdleConns:    cfg.MaxIdleConns,
		ConnMaxLifetime: cfg.ConnMaxLifetime,
		ConnMaxIdleTime: cfg.ConnMaxIdleTime,
	}

	if cfg.PoolSize > 0 {
		opts.PoolSize = cfg.PoolSize
	}

	client := redis.NewClient(opts)
	if err := client.Ping(ctx).Err(); err != nil {
		client.Close()
		return nil, fmt.Errorf("redis ping failed: %w", err)
	}
	return client, nil
}
