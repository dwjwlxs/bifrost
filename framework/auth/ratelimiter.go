package auth

import (
	"context"
	"time"
)

// RateLimiter abstracts rate limiting and account lockout.
// Implementations may use Redis, Memcached, or any other backend.
type RateLimiter interface {
	// IncrementLoginAttempts increments the login attempt counter for the given key (e.g., IP or email).
	// Returns the current count after increment.
	IncrementLoginAttempts(ctx context.Context, key string) (int64, error)

	// GetLoginAttempts returns the current login attempt count for the given key.
	GetLoginAttempts(ctx context.Context, key string) (int64, error)

	// ResetLoginAttempts resets the login attempt counter for the given key.
	ResetLoginAttempts(ctx context.Context, key string) error

	// SetAccountLockout locks an account for the specified duration.
	SetAccountLockout(ctx context.Context, userID string, duration time.Duration) error

	// IsAccountLocked checks if an account is currently locked.
	IsAccountLocked(ctx context.Context, userID string) (bool, error)

	// IncrementFailedLogins increments the failed login counter for the given user ID.
	// Returns the current count after increment.
	IncrementFailedLogins(ctx context.Context, userID string) (int64, error)

	// GetFailedLogins returns the current failed login count for the given user ID.
	GetFailedLogins(ctx context.Context, userID string) (int64, error)

	// ResetFailedLogins resets the failed login counter for the given user ID.
	ResetFailedLogins(ctx context.Context, userID string) error
}

// NoopRateLimiter is a no-op rate limiter that allows all requests (for testing).
type NoopRateLimiter struct{}

func (n *NoopRateLimiter) IncrementLoginAttempts(_ context.Context, _ string) (int64, error) {
	return 0, nil
}

func (n *NoopRateLimiter) GetLoginAttempts(_ context.Context, _ string) (int64, error) {
	return 0, nil
}

func (n *NoopRateLimiter) ResetLoginAttempts(_ context.Context, _ string) error {
	return nil
}

func (n *NoopRateLimiter) SetAccountLockout(_ context.Context, _ string, _ time.Duration) error {
	return nil
}

func (n *NoopRateLimiter) IsAccountLocked(_ context.Context, _ string) (bool, error) {
	return false, nil
}

func (n *NoopRateLimiter) IncrementFailedLogins(_ context.Context, _ string) (int64, error) {
	return 0, nil
}

func (n *NoopRateLimiter) GetFailedLogins(_ context.Context, _ string) (int64, error) {
	return 0, nil
}

func (n *NoopRateLimiter) ResetFailedLogins(_ context.Context, _ string) error {
	return nil
}