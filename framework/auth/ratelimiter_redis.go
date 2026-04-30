package auth

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisRateLimiter implements RateLimiter using Redis as the backend.
type RedisRateLimiter struct {
	client *redis.Client
}

// NewRedisRateLimiter creates a new Redis-backed rate limiter.
func NewRedisRateLimiter(client *redis.Client) RateLimiter {
	return &RedisRateLimiter{client: client}
}

// Redis key prefixes for rate limiting
const (
	ratelimitPrefixAttempts  = "auth:ratelimit:attempts:"  // key -> count
	ratelimitPrefixLockout   = "auth:ratelimit:lockout:"   // user_id -> locked
	ratelimitPrefixFailed    = "auth:ratelimit:failed:"    // user_id -> count
)

// IncrementLoginAttempts increments the login attempt counter for the given key.
func (r *RedisRateLimiter) IncrementLoginAttempts(ctx context.Context, key string) (int64, error) {
	fullKey := ratelimitPrefixAttempts + key

	// Use pipeline for atomic operations
	pipe := r.client.Pipeline()
	incr := pipe.Incr(ctx, fullKey)
	// Set expiry only if key is new (NX option)
	pipe.ExpireNX(ctx, fullKey, 15*time.Minute)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return 0, fmt.Errorf("auth: failed to increment login attempts: %w", err)
	}

	return incr.Val(), nil
}

// GetLoginAttempts returns the current login attempt count for the given key.
func (r *RedisRateLimiter) GetLoginAttempts(ctx context.Context, key string) (int64, error) {
	fullKey := ratelimitPrefixAttempts + key

	val, err := r.client.Get(ctx, fullKey).Result()
	if err == redis.Nil {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("auth: failed to get login attempts: %w", err)
	}

	count, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("auth: failed to parse login attempts: %w", err)
	}

	return count, nil
}

// ResetLoginAttempts resets the login attempt counter for the given key.
func (r *RedisRateLimiter) ResetLoginAttempts(ctx context.Context, key string) error {
	fullKey := ratelimitPrefixAttempts + key
	return r.client.Del(ctx, fullKey).Err()
}

// SetAccountLockout locks an account for the specified duration.
func (r *RedisRateLimiter) SetAccountLockout(ctx context.Context, userID string, duration time.Duration) error {
	fullKey := ratelimitPrefixLockout + userID
	return r.client.Set(ctx, fullKey, "1", duration).Err()
}

// IsAccountLocked checks if an account is currently locked.
func (r *RedisRateLimiter) IsAccountLocked(ctx context.Context, userID string) (bool, error) {
	fullKey := ratelimitPrefixLockout + userID

	exists, err := r.client.Exists(ctx, fullKey).Result()
	if err != nil {
		return false, fmt.Errorf("auth: failed to check account lockout: %w", err)
	}

	return exists > 0, nil
}

// IncrementFailedLogins increments the failed login counter for the given user ID.
func (r *RedisRateLimiter) IncrementFailedLogins(ctx context.Context, userID string) (int64, error) {
	fullKey := ratelimitPrefixFailed + userID

	// Use pipeline for atomic operations
	pipe := r.client.Pipeline()
	incr := pipe.Incr(ctx, fullKey)
	// Set expiry only if key is new (NX option) - 15 minutes window
	pipe.ExpireNX(ctx, fullKey, 15*time.Minute)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return 0, fmt.Errorf("auth: failed to increment failed logins: %w", err)
	}

	return incr.Val(), nil
}

// GetFailedLogins returns the current failed login count for the given user ID.
func (r *RedisRateLimiter) GetFailedLogins(ctx context.Context, userID string) (int64, error) {
	fullKey := ratelimitPrefixFailed + userID

	val, err := r.client.Get(ctx, fullKey).Result()
	if err == redis.Nil {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("auth: failed to get failed logins: %w", err)
	}

	count, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("auth: failed to parse failed logins: %w", err)
	}

	return count, nil
}

// ResetFailedLogins resets the failed login counter for the given user ID.
func (r *RedisRateLimiter) ResetFailedLogins(ctx context.Context, userID string) error {
	fullKey := ratelimitPrefixFailed + userID
	return r.client.Del(ctx, fullKey).Err()
}

// Ensure interface compliance at compile time.
var _ RateLimiter = (*RedisRateLimiter)(nil)