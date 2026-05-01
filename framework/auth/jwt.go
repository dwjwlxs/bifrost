package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/google/uuid"
)

// --- Types shared across all JWT implementations ---

// JWK represents a JSON Web Key for the JWKS endpoint.
type JWK struct {
	KID string `json:"kid"`
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	Alg string `json:"alg"`
	Use string `json:"use"`
}

// JWKS represents the JWKS response for /.well-known/jwks.json.
type JWKS struct {
	Keys []JWK `json:"keys"`
}

// JWTClaims holds the claims in an access token.
type JWTClaims struct {
	Sub       string `json:"sub"`
	Iss       string `json:"iss"`
	Aud       string `json:"aud"`
	Exp       int64  `json:"exp"`
	Iat       int64  `json:"iat"`
	KID       string `json:"kid"`
	Scope     string `json:"scope,omitempty"`
	SessionID string `json:"session_id,omitempty"`
}

// --- Abstract interface ---

// JWTManager abstracts JWT signing, verification, and JWKS generation.
// Implementations may use ES256, RSA, EdDSA, or any other algorithm.
// External consumers (token generators, HTTP handlers) should depend on this
// interface, not the concrete type.
type JWTManager interface {
	// Sign creates a signed token with the given subject, session ID, and TTL.
	// Returns the serialized token string and its expiration time.
	Sign(userID string, sessionID string, ttl time.Duration) (string, time.Time, error)

	// Verify validates a token and returns its parsed claims.
	Verify(tokenString string) (*JWTClaims, error)

	// GetJWKS returns the public keys in JWKS format (RFC 7517) for
	// consumption by resource servers and /.well-known/jwks.json endpoints.
	GetJWKS() JWKS

	// GetKid returns the current key identifier.
	GetKid() string
}

func NewJWTManager(privatePEM string, issuer, audience string) (JWTManager, error) {
	return newES256JWTManager(privatePEM, issuer, audience)
}

// --- ES256 concrete implementation ---

// ES256JWTManager implements JWTSigner using ECDSA P-256 (ES256).
type ES256JWTManager struct {
	privateKey *ecdsa.PrivateKey
	publicKey  *ecdsa.PublicKey
	kid        string
	issuer     string
	audience   string
}

// newES256JWTManager creates an ES256JWTManager.
// If privatePEM is empty, a new ES256 key pair is generated at startup.
func newES256JWTManager(privatePEM string, issuer, audience string) (JWTManager, error) {
	var privateKey *ecdsa.PrivateKey
	var err error

	if privatePEM == "" {
		privateKey, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return nil, fmt.Errorf("auth: failed to generate ES256 key pair: %w", err)
		}
	} else {
		block, _ := pem.Decode([]byte(privatePEM))
		if block == nil {
			return nil, fmt.Errorf("auth: failed to decode PEM block for private key")
		}

		key, parseErr := x509.ParseECPrivateKey(block.Bytes)
		if parseErr != nil {
			parsed, pkcs8Err := x509.ParsePKCS8PrivateKey(block.Bytes)
			if pkcs8Err != nil {
				return nil, fmt.Errorf("auth: failed to parse private key: %w", parseErr)
			}
			var ok bool
			privateKey, ok = parsed.(*ecdsa.PrivateKey)
			if !ok {
				return nil, fmt.Errorf("auth: private key is not an ECDSA key")
			}
		} else {
			privateKey = key
		}
	}

	kid := uuid.New().String()

	return &ES256JWTManager{
		privateKey: privateKey,
		publicKey:  &privateKey.PublicKey,
		kid:        kid,
		issuer:     issuer,
		audience:   audience,
	}, nil
}

// Sign creates a new ES256-signed JWT.
func (m *ES256JWTManager) Sign(userID string, sessionID string, ttl time.Duration) (string, time.Time, error) {
	now := time.Now()
	expiresAt := now.Add(ttl)

	builder := jwt.Signed(m.getSigner()).
		Claims(&jwt.Claims{
			Subject:   userID,
			Issuer:    m.issuer,
			Audience:  jwt.Audience{m.audience},
			Expiry:    jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ID:        sessionID,
		}).
		Claims(&es256CustomClaims{
			KID:       m.kid,
			Scope:     "read write",
			SessionID: sessionID,
		})

	token, err := builder.Serialize()
	if err != nil {
		return "", time.Time{}, fmt.Errorf("auth: failed to sign JWT: %w", err)
	}

	return token, expiresAt, nil
}

// Verify validates an ES256-signed JWT and returns the parsed claims.
func (m *ES256JWTManager) Verify(tokenString string) (*JWTClaims, error) {
	tok, err := jwt.ParseSigned(tokenString, []jose.SignatureAlgorithm{jose.ES256})
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidAccessToken, err)
	}

	var stdClaims jwt.Claims
	if err := tok.Claims(m.publicKey, &stdClaims); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidAccessToken, err)
	}

	var custom es256CustomClaims
	if err := tok.Claims(m.publicKey, &custom); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidAccessToken, err)
	}

	if err := stdClaims.Validate(jwt.Expected{
		Issuer: m.issuer,
		Time:   time.Now(),
	}); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrAccessTokenExpired, err)
	}

	aud := ""
	if len(stdClaims.Audience) > 0 {
		aud = stdClaims.Audience[0]
	}

	return &JWTClaims{
		Sub:       stdClaims.Subject,
		Iss:       stdClaims.Issuer,
		Aud:       aud,
		Exp:       stdClaims.Expiry.Time().Unix(),
		Iat:       stdClaims.IssuedAt.Time().Unix(),
		KID:       custom.KID,
		Scope:     custom.Scope,
		SessionID: custom.SessionID,
	}, nil
}

// GetJWKS returns the ES256 public key in JWKS format.
func (m *ES256JWTManager) GetJWKS() JWKS {
	xBytes := m.publicKey.X.Bytes()
	yBytes := m.publicKey.Y.Bytes()

	return JWKS{
		Keys: []JWK{
			{
				KID: m.kid,
				Kty: "EC",
				Crv: "P-256",
				X:   base64.RawURLEncoding.EncodeToString(xBytes),
				Y:   base64.RawURLEncoding.EncodeToString(yBytes),
				Alg: "ES256",
				Use: "sig",
			},
		},
	}
}

// GetKid returns the current key ID.
func (m *ES256JWTManager) GetKid() string {
	return m.kid
}

// GetPublicKey returns the raw ECDSA public key (ES256-specific, not part of the interface).
func (m *ES256JWTManager) GetPublicKey() *ecdsa.PublicKey {
	return m.publicKey
}

// --- internal types ---

// es256CustomClaims holds non-standard claims for ES256 tokens.
type es256CustomClaims struct {
	KID       string `json:"kid"`
	Scope     string `json:"scope,omitempty"`
	SessionID string `json:"session_id,omitempty"`
}

// getSigner creates a go-jose signer for ES256.
func (m *ES256JWTManager) getSigner() jose.Signer {
	opts := (&jose.SignerOptions{}).
		WithHeader("kid", m.kid).
		WithHeader("typ", "at+jwt")

	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.ES256, Key: m.privateKey},
		opts,
	)
	if err != nil {
		panic(fmt.Sprintf("auth: failed to create signer: %v", err))
	}
	return signer
}

// Ensure ES256JWTManager implements JWTSigner at compile time.
var _ JWTManager = (*ES256JWTManager)(nil)
