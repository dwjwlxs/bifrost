package auth

import (
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// HybridStoreFactory combines different backends for optimal performance:
//   - UserRepository        → GORM (PostgreSQL/MySQL/SQLite) for durable user data
//   - SessionRepository     → GORM for durable session data
//   - VerificationCodeRepository → Redis for fast TTL-based expiry
//   - IdentityRepository    → GORM for durable identity data
//
// This is a common production pattern: relational DB for identity, Redis for
// ephemeral verification codes that benefit from automatic key expiry.
type HybridStoreFactory struct {
	userRepo     UserRepository
	sessionRepo  SessionRepository
	codeRepo     VerificationCodeRepository
	identityRepo IdentityRepository
}

// NewHybridStoreFactory creates a hybrid store with GORM for users/sessions/identities
// and Redis for verification codes.
func NewHybridStoreFactory(db *gorm.DB, redisClient *redis.Client) StoreFactory {
	return &HybridStoreFactory{
		userRepo:     &gormUserRepo{db: db},
		sessionRepo:  &gormSessionRepo{db: db},
		codeRepo:     &redisVerificationCodeRepo{client: redisClient},
		identityRepo: &gormIdentityRepo{db: db},
	}
}

func (f *HybridStoreFactory) UserRepo() UserRepository               { return f.userRepo }
func (f *HybridStoreFactory) SessionRepo() SessionRepository          { return f.sessionRepo }
func (f *HybridStoreFactory) VerificationCodeRepo() VerificationCodeRepository { return f.codeRepo }
func (f *HybridStoreFactory) IdentityRepo() IdentityRepository        { return f.identityRepo }

// Ensure interface compliance at compile time.
var _ StoreFactory = (*HybridStoreFactory)(nil)
