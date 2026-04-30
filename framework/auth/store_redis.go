package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisStoreFactory implements StoreFactory using Redis as the backend.
// Suitable for production deployments requiring fast lookups and TTL-based expiry.
type RedisStoreFactory struct {
	client *redis.Client
}

// NewRedisStoreFactory creates a new Redis-backed store factory.
func NewRedisStoreFactory(client *redis.Client) StoreFactory {
	return &RedisStoreFactory{client: client}
}

func (f *RedisStoreFactory) UserRepo() UserRepository {
	return &redisUserRepo{client: f.client}
}
func (f *RedisStoreFactory) SessionRepo() SessionRepository {
	return &redisSessionRepo{client: f.client}
}
func (f *RedisStoreFactory) VerificationCodeRepo() VerificationCodeRepository {
	return &redisVerificationCodeRepo{client: f.client}
}
func (f *RedisStoreFactory) IdentityRepo() IdentityRepository {
	return &redisIdentityRepo{client: f.client}
}

// Redis key prefixes
const (
	redisPrefixUser           = "auth:user:"
	redisPrefixEmail          = "auth:email:" // email_normalized -> user_id
	redisPrefixSession        = "auth:session:"
	redisPrefixSessionHash    = "auth:session:hash:"    // rt_hash -> session_id
	redisPrefixSessionUser    = "auth:session:user:"    // user_id -> set of session_ids
	redisPrefixSessionFamily  = "auth:session:family:"  // family -> set of session_ids
	redisPrefixCode           = "auth:code:"            // recipient:type -> latest code_id
	redisPrefixIdentity       = "auth:identity:"        // id -> JSON(identity)
	redisPrefixIdentityLookup = "auth:identity:lookup:" // provider:provider_uid -> identity_id
	redisPrefixIdentityUser   = "auth:identity:user:"   // user_id -> SET of identity_ids
)

// --- redisUserRepo ---

type redisUserRepo struct {
	client *redis.Client
}

func (r *redisUserRepo) Create(ctx context.Context, user *User) error {
	key := redisPrefixUser + user.ID
	data, err := json.Marshal(user)
	if err != nil {
		return err
	}

	pipe := r.client.Pipeline()
	pipe.Set(ctx, key, data, 0)
	// Map email -> user_id
	pipe.Set(ctx, redisPrefixEmail+user.EmailNormalized, user.ID, 0)
	_, err = pipe.Exec(ctx)
	return err
}

func (r *redisUserRepo) GetByID(ctx context.Context, id string) (*User, error) {
	data, err := r.client.Get(ctx, redisPrefixUser+id).Bytes()
	if err == redis.Nil {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, err
	}

	var user User
	if err := json.Unmarshal(data, &user); err != nil {
		return nil, err
	}
	if user.Status == UserStatusDeleted {
		return nil, ErrUserNotFound
	}
	return &user, nil
}

func (r *redisUserRepo) GetByEmail(ctx context.Context, email string) (*User, error) {
	normalized := normalizeEmail(email)
	userID, err := r.client.Get(ctx, redisPrefixEmail+normalized).Result()
	if err == redis.Nil {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, err
	}
	return r.GetByID(ctx, userID)
}

func (r *redisUserRepo) Update(ctx context.Context, user *User) error {
	key := redisPrefixUser + user.ID
	data, err := json.Marshal(user)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, key, data, 0).Err()
}

func (r *redisUserRepo) Delete(ctx context.Context, id string) error {
	user, err := r.GetByID(ctx, id)
	if err != nil {
		return err
	}
	now := time.Now()
	user.DeletedAt = &now
	user.Status = UserStatusDeleted
	user.UpdatedAt = now
	return r.Update(ctx, user)
}

func (r *redisUserRepo) EmailExists(ctx context.Context, email string) (bool, error) {
	normalized := normalizeEmail(email)
	exists, err := r.client.Exists(ctx, redisPrefixEmail+normalized).Result()
	if err != nil {
		return false, err
	}
	return exists > 0, nil
}

// --- redisSessionRepo ---

type redisSessionRepo struct {
	client *redis.Client
}

func (r *redisSessionRepo) Create(ctx context.Context, session *Session) error {
	data, err := json.Marshal(session)
	if err != nil {
		return err
	}

	ttl := time.Until(session.ExpiresAt)
	if ttl <= 0 {
		return nil // Don't store expired sessions
	}

	pipe := r.client.Pipeline()
	key := redisPrefixSession + session.ID
	pipe.Set(ctx, key, data, ttl)
	// Map rt_hash -> session_id
	pipe.Set(ctx, redisPrefixSessionHash+session.RefreshTokenHash, session.ID, ttl)
	// Add to user's session set
	pipe.SAdd(ctx, redisPrefixSessionUser+session.UserID, session.ID)
	pipe.ExpireAt(ctx, redisPrefixSessionUser+session.UserID, session.ExpiresAt)
	// Add to family set
	pipe.SAdd(ctx, redisPrefixSessionFamily+session.TokenFamily, session.ID)
	pipe.ExpireAt(ctx, redisPrefixSessionFamily+session.TokenFamily, session.ExpiresAt)
	_, err = pipe.Exec(ctx)
	return err
}

func (r *redisSessionRepo) GetByRefreshTokenHash(ctx context.Context, hash string) (*Session, error) {
	sessionID, err := r.client.Get(ctx, redisPrefixSessionHash+hash).Result()
	if err == redis.Nil {
		return nil, fmt.Errorf("session not found")
	}
	if err != nil {
		return nil, err
	}
	return r.GetByID(ctx, sessionID)
}

func (r *redisSessionRepo) GetByID(ctx context.Context, id string) (*Session, error) {
	data, err := r.client.Get(ctx, redisPrefixSession+id).Bytes()
	if err == redis.Nil {
		return nil, fmt.Errorf("session not found")
	}
	if err != nil {
		return nil, err
	}
	var session Session
	if err := json.Unmarshal(data, &session); err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *redisSessionRepo) GetByUserID(ctx context.Context, userID string) ([]*Session, error) {
	sessionIDs, err := r.client.SMembers(ctx, redisPrefixSessionUser+userID).Result()
	if err != nil {
		return nil, err
	}

	var sessions []*Session
	for _, id := range sessionIDs {
		s, err := r.GetByID(ctx, id)
		if err == nil {
			sessions = append(sessions, s)
		}
	}
	return sessions, nil
}

func (r *redisSessionRepo) MarkUsed(ctx context.Context, id string) error {
	data, err := r.client.Get(ctx, redisPrefixSession+id).Bytes()
	if err != nil {
		return err
	}

	var session Session
	if err := json.Unmarshal(data, &session); err != nil {
		return err
	}

	session.IsUsed = true
	updatedData, err := json.Marshal(session)
	if err != nil {
		return err
	}

	// Preserve original TTL
	ttl, _ := r.client.TTL(ctx, redisPrefixSession+id).Result()
	return r.client.Set(ctx, redisPrefixSession+id, updatedData, ttl).Err()
}

func (r *redisSessionRepo) Delete(ctx context.Context, id string) error {
	session, err := r.GetByID(ctx, id)
	if err != nil {
		return nil // idempotent
	}

	pipe := r.client.Pipeline()
	pipe.Del(ctx, redisPrefixSession+id)
	pipe.Del(ctx, redisPrefixSessionHash+session.RefreshTokenHash)
	pipe.SRem(ctx, redisPrefixSessionUser+session.UserID, id)
	pipe.SRem(ctx, redisPrefixSessionFamily+session.TokenFamily, id)
	_, err = pipe.Exec(ctx)
	return err
}

func (r *redisSessionRepo) DeleteByUserID(ctx context.Context, userID string) error {
	sessionIDs, err := r.client.SMembers(ctx, redisPrefixSessionUser+userID).Result()
	if err != nil {
		return err
	}

	for _, id := range sessionIDs {
		_ = r.Delete(ctx, id)
	}
	return nil
}

func (r *redisSessionRepo) RevokeFamily(ctx context.Context, familyID string) error {
	sessionIDs, err := r.client.SMembers(ctx, redisPrefixSessionFamily+familyID).Result()
	if err != nil {
		return err
	}

	for _, id := range sessionIDs {
		_ = r.Delete(ctx, id)
	}
	return nil
}

func (r *redisSessionRepo) DeleteExpired(ctx context.Context) (int64, error) {
	// Redis handles expiry via TTL, but we can clean up stale keys in the sets.
	// For a complete cleanup, iterate session keys and check TTL.
	var count int64
	var cursor uint64
	prefix := redisPrefixSession

	for {
		keys, nextCursor, err := r.client.Scan(ctx, cursor, prefix+"*", 100).Result()
		if err != nil {
			return count, err
		}

		for _, key := range keys {
			ttl, _ := r.client.TTL(ctx, key).Result()
			if ttl == -2 { // key doesn't exist (already expired)
				count++
			}
		}

		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}
	return count, nil
}

// --- redisVerificationCodeRepo ---

type redisVerificationCodeRepo struct {
	client *redis.Client
}

func (r *redisVerificationCodeRepo) codeKey(recipient string, codeType VerificationCodeType) string {
	return redisPrefixCode + string(recipient) + ":" + string(codeType)
}

func (r *redisVerificationCodeRepo) Create(ctx context.Context, code *VerificationCode) error {
	data, err := json.Marshal(code)
	if err != nil {
		return err
	}

	// Store as the latest code for this recipient+type with TTL
	ttl := time.Until(code.ExpiresAt)
	if ttl <= 0 {
		return nil
	}

	key := r.codeKey(code.Recipient, code.CodeType)
	return r.client.Set(ctx, key, data, ttl).Err()
}

func (r *redisVerificationCodeRepo) GetLatest(ctx context.Context, recipient string, codeType VerificationCodeType) (*VerificationCode, error) {
	key := r.codeKey(recipient, codeType)
	data, err := r.client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, fmt.Errorf("verification code not found")
	}
	if err != nil {
		return nil, err
	}

	var code VerificationCode
	if err := json.Unmarshal(data, &code); err != nil {
		return nil, err
	}
	return &code, nil
}

func (r *redisVerificationCodeRepo) IncrementAttempts(ctx context.Context, id string) error {
	// In Redis, we update the stored code directly.
	// For production, consider using a Lua script for atomicity.
	key := redisPrefixCode + id
	data, err := r.client.Get(ctx, key).Bytes()
	if err != nil {
		return fmt.Errorf("verification code not found")
	}

	var code VerificationCode
	if err := json.Unmarshal(data, &code); err != nil {
		return err
	}

	code.Attempts++
	updatedData, err := json.Marshal(code)
	if err != nil {
		return err
	}

	ttl, _ := r.client.TTL(ctx, key).Result()
	return r.client.Set(ctx, key, updatedData, ttl).Err()
}

func (r *redisVerificationCodeRepo) MarkVerified(ctx context.Context, id string) error {
	key := redisPrefixCode + id
	data, err := r.client.Get(ctx, key).Bytes()
	if err != nil {
		return fmt.Errorf("verification code not found")
	}

	var code VerificationCode
	if err := json.Unmarshal(data, &code); err != nil {
		return err
	}

	now := time.Now()
	code.VerifiedAt = &now
	updatedData, err := json.Marshal(code)
	if err != nil {
		return err
	}

	ttl, _ := r.client.TTL(ctx, key).Result()
	return r.client.Set(ctx, key, updatedData, ttl).Err()
}

func (r *redisVerificationCodeRepo) DeleteExpired(ctx context.Context) (int64, error) {
	// Redis handles expiry via TTL automatically.
	// This is a no-op for Redis but kept for interface compliance.
	return 0, nil
}

// --- redisIdentityRepo ---

type redisIdentityRepo struct {
	client *redis.Client
}

func (r *redisIdentityRepo) identityLookupKey(provider IdentityProvider, providerUID string) string {
	return redisPrefixIdentityLookup + string(provider) + ":" + providerUID
}

func (r *redisIdentityRepo) Create(ctx context.Context, identity *Identity) error {
	data, err := json.Marshal(identity)
	if err != nil {
		return err
	}

	pipe := r.client.Pipeline()
	pipe.Set(ctx, redisPrefixIdentity+identity.ID, data, 0)
	pipe.Set(ctx, r.identityLookupKey(identity.Provider, identity.ProviderUID), identity.ID, 0)
	pipe.SAdd(ctx, redisPrefixIdentityUser+identity.UserID, identity.ID)
	_, err = pipe.Exec(ctx)
	return err
}

func (r *redisIdentityRepo) GetByProviderAndUID(ctx context.Context, provider IdentityProvider, providerUID string) (*Identity, error) {
	id, err := r.client.Get(ctx, r.identityLookupKey(provider, providerUID)).Result()
	if err == redis.Nil {
		return nil, fmt.Errorf("identity not found")
	}
	if err != nil {
		return nil, err
	}
	return r.getByID(ctx, id)
}

func (r *redisIdentityRepo) getByID(ctx context.Context, id string) (*Identity, error) {
	data, err := r.client.Get(ctx, redisPrefixIdentity+id).Bytes()
	if err == redis.Nil {
		return nil, fmt.Errorf("identity not found")
	}
	if err != nil {
		return nil, err
	}
	var identity Identity
	if err := json.Unmarshal(data, &identity); err != nil {
		return nil, err
	}
	return &identity, nil
}

func (r *redisIdentityRepo) GetByUserID(ctx context.Context, userID string) ([]*Identity, error) {
	ids, err := r.client.SMembers(ctx, redisPrefixIdentityUser+userID).Result()
	if err != nil {
		return nil, err
	}

	var identities []*Identity
	for _, id := range ids {
		identity, err := r.getByID(ctx, id)
		if err == nil {
			identities = append(identities, identity)
		}
	}
	return identities, nil
}

func (r *redisIdentityRepo) Delete(ctx context.Context, id string) error {
	identity, err := r.getByID(ctx, id)
	if err != nil {
		return nil // idempotent
	}

	pipe := r.client.Pipeline()
	pipe.Del(ctx, redisPrefixIdentity+id)
	pipe.Del(ctx, r.identityLookupKey(identity.Provider, identity.ProviderUID))
	pipe.SRem(ctx, redisPrefixIdentityUser+identity.UserID, id)
	_, err = pipe.Exec(ctx)
	return err
}

// Ensure interface compliance at compile time.
var (
	_ StoreFactory               = (*RedisStoreFactory)(nil)
	_ StoreFactory               = (*MemoryStoreFactory)(nil)
	_ UserRepository             = (*redisUserRepo)(nil)
	_ SessionRepository          = (*redisSessionRepo)(nil)
	_ VerificationCodeRepository = (*redisVerificationCodeRepo)(nil)
	_ IdentityRepository         = (*redisIdentityRepo)(nil)
)

// Suppress unused import warnings
var _ = strconv.Itoa
