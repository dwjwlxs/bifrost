package auth

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// MemoryStoreFactory is an in-memory StoreFactory for testing and development.
type MemoryStoreFactory struct {
	userRepo    *memoryUserRepo
	sessionRepo *memorySessionRepo
	codeRepo    *memoryVerificationCodeRepo
}

// NewMemoryStoreFactory creates a new in-memory store factory.
func NewMemoryStoreFactory() StoreFactory {
	f := &MemoryStoreFactory{}
	f.userRepo = &memoryUserRepo{users: make(map[string]*User), byEmail: make(map[string]*User)}
	f.sessionRepo = &memorySessionRepo{sessions: make(map[string]*Session), byHash: make(map[string]*Session)}
	f.codeRepo = &memoryVerificationCodeRepo{codes: make(map[string]*VerificationCode)}
	return f
}

func (f *MemoryStoreFactory) UserRepo() UserRepository                         { return f.userRepo }
func (f *MemoryStoreFactory) SessionRepo() SessionRepository                   { return f.sessionRepo }
func (f *MemoryStoreFactory) VerificationCodeRepo() VerificationCodeRepository { return f.codeRepo }

// --- memoryUserRepo ---

type memoryUserRepo struct {
	mu      sync.RWMutex
	users   map[string]*User // id -> user
	byEmail map[string]*User // normalized email -> user
}

func (r *memoryUserRepo) Create(_ context.Context, user *User) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.byEmail[user.EmailNormalized]; exists {
		return ErrUserAlreadyExists
	}

	cp := *user
	r.users[user.ID] = &cp
	r.byEmail[user.EmailNormalized] = &cp
	return nil
}

func (r *memoryUserRepo) GetByID(_ context.Context, id string) (*User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	user, ok := r.users[id]
	if !ok || user.Status == UserStatusDeleted {
		return nil, ErrUserNotFound
	}
	cp := *user
	return &cp, nil
}

func (r *memoryUserRepo) GetByEmail(_ context.Context, email string) (*User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	normalized := normalizeEmail(email)
	user, ok := r.byEmail[normalized]
	if !ok || user.Status == UserStatusDeleted {
		return nil, ErrUserNotFound
	}
	cp := *user
	return &cp, nil
}

func (r *memoryUserRepo) Update(_ context.Context, user *User) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.users[user.ID]; !ok {
		return ErrUserNotFound
	}

	cp := *user
	r.users[user.ID] = &cp
	r.byEmail[user.EmailNormalized] = &cp
	return nil
}

func (r *memoryUserRepo) Delete(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	user, ok := r.users[id]
	if !ok {
		return ErrUserNotFound
	}

	now := time.Now()
	user.DeletedAt = &now
	user.Status = UserStatusDeleted
	user.UpdatedAt = now
	return nil
}

func (r *memoryUserRepo) EmailExists(_ context.Context, email string) (bool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	normalized := normalizeEmail(email)
	user, ok := r.byEmail[normalized]
	if !ok {
		return false, nil
	}
	return user.Status != UserStatusDeleted, nil
}

// --- memorySessionRepo ---

type memorySessionRepo struct {
	mu       sync.RWMutex
	sessions map[string]*Session // id -> session
	byHash   map[string]*Session // refresh_token_hash -> session
}

func (r *memorySessionRepo) Create(_ context.Context, session *Session) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	cp := *session
	r.sessions[session.ID] = &cp
	r.byHash[session.RefreshTokenHash] = &cp
	return nil
}

func (r *memorySessionRepo) GetByRefreshTokenHash(_ context.Context, hash string) (*Session, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	session, ok := r.byHash[hash]
	if !ok {
		return nil, fmt.Errorf("session not found")
	}
	cp := *session
	return &cp, nil
}

func (r *memorySessionRepo) GetByID(_ context.Context, id string) (*Session, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	session, ok := r.sessions[id]
	if !ok {
		return nil, fmt.Errorf("session not found")
	}
	cp := *session
	return &cp, nil
}

func (r *memorySessionRepo) GetByUserID(_ context.Context, userID string) ([]*Session, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*Session
	now := time.Now()
	for _, s := range r.sessions {
		if s.UserID == userID && now.Before(s.ExpiresAt) {
			cp := *s
			result = append(result, &cp)
		}
	}
	return result, nil
}

func (r *memorySessionRepo) MarkUsed(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	session, ok := r.sessions[id]
	if !ok {
		return fmt.Errorf("session not found")
	}
	session.IsUsed = true
	return nil
}

func (r *memorySessionRepo) Delete(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	session, ok := r.sessions[id]
	if !ok {
		return nil // idempotent
	}
	delete(r.byHash, session.RefreshTokenHash)
	delete(r.sessions, id)
	return nil
}

func (r *memorySessionRepo) DeleteByUserID(_ context.Context, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	for id, s := range r.sessions {
		if s.UserID == userID {
			delete(r.byHash, s.RefreshTokenHash)
			delete(r.sessions, id)
		}
	}
	return nil
}

func (r *memorySessionRepo) RevokeFamily(_ context.Context, familyID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	for id, s := range r.sessions {
		if s.TokenFamily == familyID {
			delete(r.byHash, s.RefreshTokenHash)
			delete(r.sessions, id)
		}
	}
	return nil
}

func (r *memorySessionRepo) DeleteExpired(_ context.Context) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	var count int64
	for id, s := range r.sessions {
		if now.After(s.ExpiresAt) {
			delete(r.byHash, s.RefreshTokenHash)
			delete(r.sessions, id)
			count++
		}
	}
	return count, nil
}

// --- memoryVerificationCodeRepo ---

type memoryVerificationCodeRepo struct {
	mu    sync.RWMutex
	codes map[string]*VerificationCode // id -> code
}

func (r *memoryVerificationCodeRepo) Create(_ context.Context, code *VerificationCode) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	cp := *code
	r.codes[code.ID] = &cp
	return nil
}

func (r *memoryVerificationCodeRepo) GetLatest(_ context.Context, recipient string, codeType VerificationCodeType) (*VerificationCode, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var latest *VerificationCode
	for _, c := range r.codes {
		if c.Recipient == recipient && c.CodeType == codeType && c.VerifiedAt == nil {
			if latest == nil || c.CreatedAt.After(latest.CreatedAt) {
				cp := *c
				latest = &cp
			}
		}
	}
	if latest == nil {
		return nil, fmt.Errorf("verification code not found")
	}
	return latest, nil
}

func (r *memoryVerificationCodeRepo) IncrementAttempts(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	code, ok := r.codes[id]
	if !ok {
		return fmt.Errorf("verification code not found")
	}
	code.Attempts++
	return nil
}

func (r *memoryVerificationCodeRepo) MarkVerified(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	code, ok := r.codes[id]
	if !ok {
		return fmt.Errorf("verification code not found")
	}
	now := time.Now()
	code.VerifiedAt = &now
	return nil
}

func (r *memoryVerificationCodeRepo) DeleteExpired(_ context.Context) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	var count int64
	for id, c := range r.codes {
		if now.After(c.ExpiresAt) {
			delete(r.codes, id)
			count++
		}
	}
	return count, nil
}
