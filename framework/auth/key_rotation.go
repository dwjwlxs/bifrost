package auth

import (
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"sync"
	"time"
)

// --- E2-S5: Key Rotation JWT Manager ---

// KeyRotationConfig holds the configuration for key rotation.
type KeyRotationConfig struct {
	// KeyTTL is how long a key remains valid for signing AND verification.
	// After KeyTTL from creation, a key is removed entirely.
	KeyTTL time.Duration `json:"key_ttl"`

	// RotationInterval is how often a new signing key is generated.
	// After RotationInterval, the old key becomes verify-only and a new key starts signing.
	RotationInterval time.Duration `json:"rotation_interval"`

	// GracePeriod is the additional time after KeyTTL that old keys
	// remain available for verification (to handle in-flight tokens).
	GracePeriod time.Duration `json:"grace_period"`
}

// DefaultKeyRotationConfig returns sensible defaults for key rotation.
// Keys rotate every 24h, valid for 7 days, with 24h grace period.
func DefaultKeyRotationConfig() *KeyRotationConfig {
	return &KeyRotationConfig{
		KeyTTL:            7 * 24 * time.Hour,
		RotationInterval:  24 * time.Hour,
		GracePeriod:       24 * time.Hour,
	}
}

// RotatingJWTManager is a JWTManager that supports multiple signing keys
// with automatic rotation. It implements the JWTManager interface.
//
// Key lifecycle:
//   1. New key is generated at creation time (and at each rotation)
//   2. During RotationInterval, the latest key signs new tokens AND verifies
//   3. After RotationInterval, the previous key becomes verify-only
//   4. After KeyTTL + GracePeriod, old keys are permanently removed
//   5. JWKS endpoint returns all active (verify) keys
type RotatingJWTManager struct {
	mu       sync.RWMutex
	keys     []*rotatingKey // sorted newest first
	config   *KeyRotationConfig
	issuer   string
	audience string

	// rotationTicker is used by the background goroutine
	stopCh chan struct{}
}

// rotatingKey holds the state for a single signing key.
type rotatingKey struct {
	es256       *ES256JWTManager // the actual key manager
	createdAt   time.Time
	expiresAt   time.Time   // when this key can no longer verify tokens
	lastRotated time.Time   // when rotation happened (new key was created after this one)
	isSigning   bool        // true = used for signing new tokens
}

// NewRotatingJWTManager creates a RotatingJWTManager.
// If privatePEM is empty, a new key pair is generated for the initial key.
// rotationConfig can be nil, in which case DefaultKeyRotationConfig is used.
func NewRotatingJWTManager(privatePEM string, issuer, audience string, rotationConfig *KeyRotationConfig) (JWTManager, error) {
	if rotationConfig == nil {
		rotationConfig = DefaultKeyRotationConfig()
	}

	now := time.Now()
	keyManager, err := newES256JWTManager(privatePEM, issuer, audience)
	if err != nil {
		return nil, err
	}

	es256Key := keyManager.(*ES256JWTManager)
	key := &rotatingKey{
		es256:     es256Key,
		createdAt: now,
		expiresAt: now.Add(rotationConfig.KeyTTL),
		isSigning: true,
	}

	rm := &RotatingJWTManager{
		keys:     []*rotatingKey{key},
		config:   rotationConfig,
		issuer:   issuer,
		audience: audience,
		stopCh:   make(chan struct{}),
	}

	// Start background rotation goroutine
	go rm.rotationLoop()

	return rm, nil
}

// rotationLoop periodically checks if rotation is needed and cleans up expired keys.
func (m *RotatingJWTManager) rotationLoop() {
	ticker := time.NewTicker(1 * time.Minute) // check every minute
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			m.maybeRotate()
			m.cleanExpired()
		case <-m.stopCh:
			return
		}
	}
}

// maybeRotate creates a new signing key if the current one is due for rotation.
func (m *RotatingJWTManager) maybeRotate() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.keys) == 0 {
		return
	}

	currentSigning := m.keys[0]
	if time.Since(currentSigning.createdAt) < m.config.RotationInterval {
		return
	}

	// Time to rotate: demote current key to verify-only, create new signing key
	newKey, err := newES256JWTManager("", m.issuer, m.audience)
	if err != nil {
		// Rotation failed — log this in production
		return
	}

	now := time.Now()
	currentSigning.isSigning = false
	currentSigning.lastRotated = now

	newRotatingKey := &rotatingKey{
		es256:     newKey.(*ES256JWTManager),
		createdAt: now,
		expiresAt: now.Add(m.config.KeyTTL),
		isSigning: true,
	}

	// Prepend new key (newest first)
	m.keys = append([]*rotatingKey{newRotatingKey}, m.keys...)
}

// cleanExpired removes keys that have fully expired (beyond TTL + grace period).
func (m *RotatingJWTManager) cleanExpired() {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-m.config.KeyTTL - m.config.GracePeriod)

	var active []*rotatingKey
	for _, k := range m.keys {
		if k.createdAt.After(cutoff) || k.isSigning {
			active = append(active, k)
		}
	}

	// Ensure at least one key remains (signing)
	if len(active) == 0 && len(m.keys) > 0 {
		active = m.keys[:1]
	}

	m.keys = active
}

// Sign creates a new token using the current signing key.
func (m *RotatingJWTManager) Sign(userID string, sessionID string, ttl time.Duration) (string, time.Time, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, k := range m.keys {
		if k.isSigning {
			return k.es256.Sign(userID, sessionID, ttl)
		}
	}

	return "", time.Time{}, ErrNoActiveKeys
}

// Verify validates a token. It tries all keys that are still valid for verification.
func (m *RotatingJWTManager) Verify(tokenString string) (*JWTClaims, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now()

	var lastErr error
	for _, k := range m.keys {
		// Check if this key is still within its validity window
		if now.After(k.expiresAt.Add(m.config.GracePeriod)) {
			continue
		}

		claims, err := k.es256.Verify(tokenString)
		if err == nil {
			return claims, nil
		}
		lastErr = err
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, ErrNoActiveKeys
}

// GetJWKS returns all active keys (signing + verification) in JWKS format.
func (m *RotatingJWTManager) GetJWKS() JWKS {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now()
	var keys []JWK

	for _, k := range m.keys {
		// Skip fully expired keys
		if now.After(k.expiresAt.Add(m.config.GracePeriod)) {
			continue
		}

		ecKey := k.es256.publicKey
		xBytes := ecKey.X.Bytes()
		yBytes := ecKey.Y.Bytes()

		use := "sig"
		if !k.isSigning {
			use = "ver" // verify-only
		}

		keys = append(keys, JWK{
			KID: k.es256.kid,
			Kty: "EC",
			Crv: "P-256",
			X:   base64.RawURLEncoding.EncodeToString(xBytes),
			Y:   base64.RawURLEncoding.EncodeToString(yBytes),
			Alg: "ES256",
			Use: use,
		})
	}

	return JWKS{Keys: keys}
}

// GetKid returns the current signing key's kid.
func (m *RotatingJWTManager) GetKid() string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, k := range m.keys {
		if k.isSigning {
			return k.es256.GetKid()
		}
	}
	return ""
}

// GetPublicKey returns the current signing key's public key.
func (m *RotatingJWTManager) GetPublicKey() *ecdsa.PublicKey {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, k := range m.keys {
		if k.isSigning {
			return k.es256.GetPublicKey()
		}
	}
	return nil
}

// GetKeys returns a snapshot of all key info (for admin/debug use).
func (m *RotatingJWTManager) GetKeys() []KeyInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now()
	var result []KeyInfo

	for _, k := range m.keys {
		result = append(result, KeyInfo{
			KID:         k.es256.kid,
			CreatedAt:   k.createdAt,
			ExpiresAt:   k.expiresAt,
			Algorithm:   "ES256",
			IsSigning:   k.isSigning,
			IsVerifying: !now.After(k.expiresAt.Add(m.config.GracePeriod)),
		})
	}

	return result
}

// Stop shuts down the background rotation goroutine.
func (m *RotatingJWTManager) Stop() {
	close(m.stopCh)
}

// Ensure RotatingJWTManager implements JWTManager at compile time.
var _ JWTManager = (*RotatingJWTManager)(nil)

// --- Alternative constructor from PEM ---

// NewRotatingJWTManagerFromKeyPair creates a RotatingJWTManager from an existing key pair PEM.
func NewRotatingJWTManagerFromKeyPair(privateKeyPEM, issuer, audience string, config *KeyRotationConfig) (JWTManager, error) {
	return NewRotatingJWTManager(privateKeyPEM, issuer, audience, config)
}

// ParsePrivateKeyFromPEM parses a PEM-encoded ECDSA P-256 private key.
func ParsePrivateKeyFromPEM(pemStr string) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, fmt.Errorf("auth: failed to decode PEM block")
	}

	key, err := x509.ParseECPrivateKey(block.Bytes)
	if err != nil {
		parsed, pkcs8Err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if pkcs8Err != nil {
			return nil, fmt.Errorf("auth: failed to parse private key: %w", err)
		}
		ecKey, ok := parsed.(*ecdsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("auth: private key is not ECDSA")
		}
		return ecKey, nil
	}
	return key, nil
}
