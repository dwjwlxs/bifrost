package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

// TokenGenerator handles the creation of token pairs (access + refresh).
type TokenGenerator struct {
	jwtManager JWTManager
	config     *Config
}

// NewTokenGenerator creates a new TokenGenerator.
func NewTokenGenerator(jwtManager JWTManager, config *Config) *TokenGenerator {
	return &TokenGenerator{
		jwtManager: jwtManager,
		config:     config,
	}
}

// GenerateTokenPair creates a new access token + refresh token pair.
// The refresh token is an opaque random string; the caller is responsible for
// storing the session record with the SHA-256 hash of the refresh token.
func (g *TokenGenerator) GenerateTokenPair(userID, sessionID string) (*TokenPair, error) {
	// Generate access token (JWT)
	accessToken, expiresAt, err := g.jwtManager.Sign(userID, sessionID, g.config.AccessTokenTTL)
	if err != nil {
		return nil, fmt.Errorf("auth: failed to generate access token: %w", err)
	}

	// Generate opaque refresh token
	refreshToken, err := GenerateOpaqueToken()
	if err != nil {
		return nil, fmt.Errorf("auth: failed to generate refresh token: %w", err)
	}

	return &TokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresAt:    expiresAt,
		TokenType:    "Bearer",
	}, nil
}

// GenerateOpaqueToken creates a cryptographically random opaque token.
// The token is URL-safe Base64 encoded, providing 256 bits of entropy.
func GenerateOpaqueToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("auth: failed to generate random token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// GenerateVerificationCode creates a numeric verification code of the specified length.
// For example, length=6 produces a 6-digit code like "047293".
func GenerateVerificationCode(length int) (string, error) {
	if length <= 0 {
		length = 6
	}

	max := 1
	for i := 0; i < length; i++ {
		max *= 10
	}

	// Use crypto/rand to avoid bias
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("auth: failed to generate verification code: %w", err)
	}

	// Convert 4 random bytes to a number in [0, max)
	n := uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])
	code := int(n % uint32(max))

	// Pad with leading zeros
	format := fmt.Sprintf("%%0%dd", length)
	return fmt.Sprintf(format, code), nil
}
