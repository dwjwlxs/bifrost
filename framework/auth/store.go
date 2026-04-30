package auth

import "context"

// UserRepository abstracts user persistence.
// Implementations may use PostgreSQL, MySQL, SQLite, or any other backend.
type UserRepository interface {
	// Create persists a new user.
	Create(ctx context.Context, user *User) error

	// GetByID retrieves a user by their ID.
	GetByID(ctx context.Context, id string) (*User, error)

	// GetByEmail retrieves a user by their normalized email.
	GetByEmail(ctx context.Context, email string) (*User, error)

	// Update updates an existing user record.
	Update(ctx context.Context, user *User) error

	// Delete performs a soft delete on a user.
	Delete(ctx context.Context, id string) error

	// EmailExists checks if an email is already registered (excluding soft-deleted).
	EmailExists(ctx context.Context, email string) (bool, error)
}

// SessionRepository abstracts session/refresh-token persistence.
// Redis is the recommended backend for fast lookups and TTL-based expiry.
type SessionRepository interface {
	// Create persists a new session.
	Create(ctx context.Context, session *Session) error

	// GetByRefreshTokenHash looks up a session by its refresh token hash.
	GetByRefreshTokenHash(ctx context.Context, hash string) (*Session, error)

	// GetByID retrieves a session by ID.
	GetByID(ctx context.Context, id string) (*Session, error)

	// GetByUserID retrieves all active sessions for a user.
	GetByUserID(ctx context.Context, userID string) ([]*Session, error)

	// MarkUsed marks a session as used (for replay detection).
	MarkUsed(ctx context.Context, id string) error

	// Delete removes a session.
	Delete(ctx context.Context, id string) error

	// DeleteByUserID removes all sessions for a user.
	DeleteByUserID(ctx context.Context, userID string) error

	// RevokeFamily revokes all sessions in a token family (replay attack response).
	RevokeFamily(ctx context.Context, familyID string) error

	// DeleteExpired removes all expired sessions.
	DeleteExpired(ctx context.Context) (int64, error)
}

// VerificationCodeRepository abstracts verification code persistence.
type VerificationCodeRepository interface {
	// Create persists a new verification code.
	Create(ctx context.Context, code *VerificationCode) error

	// GetLatest retrieves the most recent active code for a recipient+type combination.
	GetLatest(ctx context.Context, recipient string, codeType VerificationCodeType) (*VerificationCode, error)

	// IncrementAttempts increments the attempt counter for a code.
	IncrementAttempts(ctx context.Context, id string) error

	// MarkVerified marks a code as successfully verified.
	MarkVerified(ctx context.Context, id string) error

	// DeleteExpired removes all expired verification codes.
	DeleteExpired(ctx context.Context) (int64, error)
}

// IdentityRepository abstracts social-login identity persistence.
// Maps external OAuth provider identities to local user accounts.
type IdentityRepository interface {
	// Create persists a new identity link.
	Create(ctx context.Context, identity *Identity) error

	// GetByProviderAndUID looks up an identity by provider + provider-issued UID.
	GetByProviderAndUID(ctx context.Context, provider IdentityProvider, providerUID string) (*Identity, error)

	// GetByUserID retrieves all identities for a user.
	GetByUserID(ctx context.Context, userID string) ([]*Identity, error)

	// Delete removes an identity link.
	Delete(ctx context.Context, id string) error
}

// StoreFactory creates repository instances from a shared backend connection.
// This allows injecting different storage backends (memory, Redis, GORM, etc.)
// without changing the auth service code.
type StoreFactory interface {
	UserRepo() UserRepository
	SessionRepo() SessionRepository
	VerificationCodeRepo() VerificationCodeRepository
	IdentityRepo() IdentityRepository
}
