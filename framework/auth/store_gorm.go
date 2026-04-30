package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// GormStoreFactory implements StoreFactory using GORM as the backend.
// Supports PostgreSQL, MySQL, and SQLite.
type GormStoreFactory struct {
	db *gorm.DB
}

// NewGormStoreFactory creates a new GORM-backed store factory.
func NewGormStoreFactory(db *gorm.DB) StoreFactory {
	return &GormStoreFactory{db: db}
}

func (f *GormStoreFactory) UserRepo() UserRepository {
	return &gormUserRepo{db: f.db}
}
func (f *GormStoreFactory) SessionRepo() SessionRepository {
	return &gormSessionRepo{db: f.db}
}
func (f *GormStoreFactory) VerificationCodeRepo() VerificationCodeRepository {
	return &gormVerificationCodeRepo{db: f.db}
}
func (f *GormStoreFactory) IdentityRepo() IdentityRepository {
	return &gormIdentityRepo{db: f.db}
}

// --- GORM table models ---

type gormUser struct {
	ID              string         `gorm:"column:id;primaryKey;type:varchar(36)"`
	Email           string         `gorm:"column:email;type:varchar(255);not null"`
	EmailNormalized string         `gorm:"column:email_normalized;type:varchar(255);uniqueIndex;not null"`
	DisplayName     string         `gorm:"column:display_name;type:varchar(255)"`
	Phone           string         `gorm:"column:phone;type:varchar(20)"`
	PasswordHash    string         `gorm:"column:password_hash;type:varchar(255)"`
	Status          string         `gorm:"column:status;type:varchar(20);not null;default:pending_verification"`
	CreatedAt       time.Time      `gorm:"column:created_at;not null"`
	UpdatedAt       time.Time      `gorm:"column:updated_at;not null"`
	DeletedAt       gorm.DeletedAt `gorm:"column:deleted_at;index"`
}

func (gormUser) TableName() string { return "auth_users" }

func (m *gormUser) toDomain() *User {
	u := &User{
		ID:              m.ID,
		Email:           m.Email,
		EmailNormalized: m.EmailNormalized,
		DisplayName:     m.DisplayName,
		Phone:           m.Phone,
		PasswordHash:    m.PasswordHash,
		Status:          UserStatus(m.Status),
		CreatedAt:       m.CreatedAt,
		UpdatedAt:       m.UpdatedAt,
	}
	if m.DeletedAt.Valid {
		u.DeletedAt = &m.DeletedAt.Time
	}
	return u
}

func fromDomainUser(u *User) *gormUser {
	m := &gormUser{
		ID:              u.ID,
		Email:           u.Email,
		EmailNormalized: u.EmailNormalized,
		DisplayName:     u.DisplayName,
		Phone:           u.Phone,
		PasswordHash:    u.PasswordHash,
		Status:          string(u.Status),
		CreatedAt:       u.CreatedAt,
		UpdatedAt:       u.UpdatedAt,
	}
	if u.DeletedAt != nil {
		m.DeletedAt = gorm.DeletedAt{Time: *u.DeletedAt, Valid: true}
	}
	return m
}

type gormSession struct {
	ID               string    `gorm:"column:id;primaryKey;type:varchar(36)"`
	UserID           string    `gorm:"column:user_id;type:varchar(36);index;not null"`
	RefreshTokenHash string    `gorm:"column:refresh_token_hash;type:varchar(64);index;not null"`
	TokenFamily      string    `gorm:"column:token_family;type:varchar(36);index;not null"`
	IsUsed           bool      `gorm:"column:is_used;default:false"`
	DeviceInfo       string    `gorm:"column:device_info;type:varchar(500)"`
	IPAddress        string    `gorm:"column:ip_address;type:varchar(45)"`
	ExpiresAt        time.Time `gorm:"column:expires_at;index;not null"`
	CreatedAt        time.Time `gorm:"column:created_at;not null"`
}

func (gormSession) TableName() string { return "auth_sessions" }

func (m *gormSession) toDomain() *Session {
	return &Session{
		ID:               m.ID,
		UserID:           m.UserID,
		RefreshTokenHash: m.RefreshTokenHash,
		TokenFamily:      m.TokenFamily,
		IsUsed:           m.IsUsed,
		DeviceInfo:       m.DeviceInfo,
		IPAddress:        m.IPAddress,
		ExpiresAt:        m.ExpiresAt,
		CreatedAt:        m.CreatedAt,
	}
}

func fromDomainSession(s *Session) *gormSession {
	return &gormSession{
		ID:               s.ID,
		UserID:           s.UserID,
		RefreshTokenHash: s.RefreshTokenHash,
		TokenFamily:      s.TokenFamily,
		IsUsed:           s.IsUsed,
		DeviceInfo:       s.DeviceInfo,
		IPAddress:        s.IPAddress,
		ExpiresAt:        s.ExpiresAt,
		CreatedAt:        s.CreatedAt,
	}
}

type gormVerificationCode struct {
	ID         string         `gorm:"column:id;primaryKey;type:varchar(36)"`
	UserID     string         `gorm:"column:user_id;type:varchar(36)"`
	CodeType   string         `gorm:"column:code_type;type:varchar(20);not null"`
	CodeHash   string         `gorm:"column:code_hash;type:varchar(64);not null"`
	Recipient  string         `gorm:"column:recipient;type:varchar(255);index;not null"`
	Attempts   int            `gorm:"column:attempts;default:0"`
	ExpiresAt  time.Time      `gorm:"column:expires_at;not null"`
	VerifiedAt gorm.DeletedAt `gorm:"column:verified_at"`
	CreatedAt  time.Time      `gorm:"column:created_at;not null"`
}

func (gormVerificationCode) TableName() string { return "auth_verification_codes" }

func (m *gormVerificationCode) toDomain() *VerificationCode {
	vc := &VerificationCode{
		ID:        m.ID,
		UserID:    m.UserID,
		CodeType:  VerificationCodeType(m.CodeType),
		CodeHash:  m.CodeHash,
		Recipient: m.Recipient,
		Attempts:  m.Attempts,
		ExpiresAt: m.ExpiresAt,
		CreatedAt: m.CreatedAt,
	}
	if m.VerifiedAt.Valid {
		vc.VerifiedAt = &m.VerifiedAt.Time
	}
	return vc
}

func fromDomainVerificationCode(vc *VerificationCode) *gormVerificationCode {
	m := &gormVerificationCode{
		ID:        vc.ID,
		UserID:    vc.UserID,
		CodeType:  string(vc.CodeType),
		CodeHash:  vc.CodeHash,
		Recipient: vc.Recipient,
		Attempts:  vc.Attempts,
		ExpiresAt: vc.ExpiresAt,
		CreatedAt: vc.CreatedAt,
	}
	if vc.VerifiedAt != nil {
		m.VerifiedAt = gorm.DeletedAt{Time: *vc.VerifiedAt, Valid: true}
	}
	return m
}

type gormIdentity struct {
	ID          string         `gorm:"column:id;primaryKey;type:varchar(36)"`
	UserID      string         `gorm:"column:user_id;type:varchar(36);index;not null"`
	Provider    string         `gorm:"column:provider;type:varchar(20);not null"`
	ProviderUID string         `gorm:"column:provider_uid;type:varchar(255);not null"`
	DisplayName string         `gorm:"column:display_name;type:varchar(255)"`
	AvatarURL   string         `gorm:"column:avatar_url;type:varchar(500)"`
	Metadata    string         `gorm:"column:metadata;type:text"` // JSON
	CreatedAt   time.Time      `gorm:"column:created_at;not null"`
	DeletedAt   gorm.DeletedAt `gorm:"column:deleted_at;index"`
}

func (gormIdentity) TableName() string { return "auth_identities" }

func (m *gormIdentity) toDomain() *Identity {
	id := &Identity{
		ID:          m.ID,
		UserID:      m.UserID,
		Provider:    IdentityProvider(m.Provider),
		ProviderUID: m.ProviderUID,
		DisplayName: m.DisplayName,
		AvatarURL:   m.AvatarURL,
		CreatedAt:   m.CreatedAt,
	}
	if m.Metadata != "" {
		id.Metadata = make(map[string]string)
		_ = json.Unmarshal([]byte(m.Metadata), &id.Metadata)
	}
	return id
}

func fromDomainIdentity(id *Identity) *gormIdentity {
	m := &gormIdentity{
		ID:          id.ID,
		UserID:      id.UserID,
		Provider:    string(id.Provider),
		ProviderUID: id.ProviderUID,
		DisplayName: id.DisplayName,
		AvatarURL:   id.AvatarURL,
		CreatedAt:   id.CreatedAt,
	}
	if len(id.Metadata) > 0 {
		data, _ := json.Marshal(id.Metadata)
		m.Metadata = string(data)
	}
	return m
}

// --- AutoMigrate creates the auth tables ---

// AutoMigrate creates all auth-related tables.
func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&gormUser{},
		&gormSession{},
		&gormVerificationCode{},
		&gormIdentity{},
	)
}

// --- gormUserRepo ---

type gormUserRepo struct {
	db *gorm.DB
}

func (r *gormUserRepo) Create(ctx context.Context, user *User) error {
	return r.db.WithContext(ctx).Create(fromDomainUser(user)).Error
}

func (r *gormUserRepo) GetByID(ctx context.Context, id string) (*User, error) {
	var m gormUser
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&m).Error; err != nil {
		return nil, ErrUserNotFound
	}
	return m.toDomain(), nil
}

func (r *gormUserRepo) GetByEmail(ctx context.Context, email string) (*User, error) {
	normalized := normalizeEmail(email)
	var m gormUser
	if err := r.db.WithContext(ctx).Where("email_normalized = ?", normalized).First(&m).Error; err != nil {
		return nil, ErrUserNotFound
	}
	return m.toDomain(), nil
}

func (r *gormUserRepo) Update(ctx context.Context, user *User) error {
	return r.db.WithContext(ctx).Save(fromDomainUser(user)).Error
}

func (r *gormUserRepo) Delete(ctx context.Context, id string) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&gormUser{}).Where("id = ?", id).Updates(map[string]interface{}{
		"deleted_at": now,
		"status":     string(UserStatusDeleted),
		"updated_at": now,
	}).Error
}

func (r *gormUserRepo) EmailExists(ctx context.Context, email string) (bool, error) {
	normalized := normalizeEmail(email)
	var count int64
	err := r.db.WithContext(ctx).Model(&gormUser{}).Where("email_normalized = ?", normalized).Count(&count).Error
	return count > 0, err
}

// --- gormSessionRepo ---

type gormSessionRepo struct {
	db *gorm.DB
}

func (r *gormSessionRepo) Create(ctx context.Context, session *Session) error {
	return r.db.WithContext(ctx).Create(fromDomainSession(session)).Error
}

func (r *gormSessionRepo) GetByRefreshTokenHash(ctx context.Context, hash string) (*Session, error) {
	var m gormSession
	if err := r.db.WithContext(ctx).Where("refresh_token_hash = ?", hash).First(&m).Error; err != nil {
		return nil, fmt.Errorf("session not found")
	}
	return m.toDomain(), nil
}

func (r *gormSessionRepo) GetByID(ctx context.Context, id string) (*Session, error) {
	var m gormSession
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&m).Error; err != nil {
		return nil, fmt.Errorf("session not found")
	}
	return m.toDomain(), nil
}

func (r *gormSessionRepo) GetByUserID(ctx context.Context, userID string) ([]*Session, error) {
	var rows []gormSession
	if err := r.db.WithContext(ctx).Where("user_id = ? AND expires_at > ?", userID, time.Now()).Find(&rows).Error; err != nil {
		return nil, err
	}
	var sessions []*Session
	for _, row := range rows {
		sessions = append(sessions, row.toDomain())
	}
	return sessions, nil
}

func (r *gormSessionRepo) MarkUsed(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Model(&gormSession{}).Where("id = ?", id).Update("is_used", true).Error
}

func (r *gormSessionRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&gormSession{}).Error
}

func (r *gormSessionRepo) DeleteByUserID(ctx context.Context, userID string) error {
	return r.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&gormSession{}).Error
}

func (r *gormSessionRepo) RevokeFamily(ctx context.Context, familyID string) error {
	return r.db.WithContext(ctx).Where("token_family = ?", familyID).Delete(&gormSession{}).Error
}

func (r *gormSessionRepo) DeleteExpired(ctx context.Context) (int64, error) {
	result := r.db.WithContext(ctx).Where("expires_at < ?", time.Now()).Delete(&gormSession{})
	return result.RowsAffected, result.Error
}

// --- gormVerificationCodeRepo ---

type gormVerificationCodeRepo struct {
	db *gorm.DB
}

func (r *gormVerificationCodeRepo) Create(ctx context.Context, code *VerificationCode) error {
	return r.db.WithContext(ctx).Create(fromDomainVerificationCode(code)).Error
}

func (r *gormVerificationCodeRepo) GetLatest(ctx context.Context, recipient string, codeType VerificationCodeType) (*VerificationCode, error) {
	var m gormVerificationCode
	err := r.db.WithContext(ctx).
		Where("recipient = ? AND code_type = ? AND verified_at IS NULL", recipient, string(codeType)).
		Order("created_at DESC").
		First(&m).Error
	if err != nil {
		return nil, fmt.Errorf("verification code not found")
	}
	return m.toDomain(), nil
}

func (r *gormVerificationCodeRepo) IncrementAttempts(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Model(&gormVerificationCode{}).
		Where("id = ?", id).
		UpdateColumn("attempts", gorm.Expr("attempts + 1")).Error
}

func (r *gormVerificationCodeRepo) MarkVerified(ctx context.Context, id string) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&gormVerificationCode{}).
		Where("id = ?", id).
		Update("verified_at", now).Error
}

func (r *gormVerificationCodeRepo) DeleteExpired(ctx context.Context) (int64, error) {
	result := r.db.WithContext(ctx).Where("expires_at < ?", time.Now()).Delete(&gormVerificationCode{})
	return result.RowsAffected, result.Error
}

// --- gormIdentityRepo ---

type gormIdentityRepo struct {
	db *gorm.DB
}

func (r *gormIdentityRepo) Create(ctx context.Context, identity *Identity) error {
	return r.db.WithContext(ctx).Create(fromDomainIdentity(identity)).Error
}

func (r *gormIdentityRepo) GetByProviderAndUID(ctx context.Context, provider IdentityProvider, providerUID string) (*Identity, error) {
	var m gormIdentity
	if err := r.db.WithContext(ctx).
		Where("provider = ? AND provider_uid = ?", string(provider), providerUID).
		First(&m).Error; err != nil {
		return nil, fmt.Errorf("identity not found")
	}
	return m.toDomain(), nil
}

func (r *gormIdentityRepo) GetByUserID(ctx context.Context, userID string) ([]*Identity, error) {
	var rows []gormIdentity
	if err := r.db.WithContext(ctx).Where("user_id = ?", userID).Find(&rows).Error; err != nil {
		return nil, err
	}
	var identities []*Identity
	for _, row := range rows {
		identities = append(identities, row.toDomain())
	}
	return identities, nil
}

func (r *gormIdentityRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&gormIdentity{}).Error
}

// Suppress unused import
var _ = time.Now
