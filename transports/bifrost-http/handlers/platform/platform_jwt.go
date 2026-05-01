package handlers

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// ─── Legacy JWT (single-tenant, integer user IDs) ─────────────
// Used by billing.go, user.go, user_apikey.go for backward compatibility.
// Kept for migration period; new code should use Platform JWT.

var (
	// JWTKey is the HMAC secret for legacy single-tenant JWT tokens.
	// Loaded from BIFROST_JWT_SECRET env var, or randomly generated.
	JWTKey []byte
)

const (
	// LegacyJWTExpiry is the legacy JWT token expiry (30 days).
	LegacyJWTExpiry = 24 * time.Hour * 30
)

// LegacyJWTClaims represents claims in a legacy single-tenant JWT.
type LegacyJWTClaims struct {
	UserID   uint   `json:"user_id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	IsAdmin  bool   `json:"is_admin"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

func init() {
	if secret := os.Getenv("BIFROST_JWT_SECRET"); secret != "" {
		JWTKey = []byte(secret)
	} else {
		key := make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			panic("failed to generate legacy JWT secret: " + err.Error())
		}
		JWTKey = key
	}
	if len(JWTKey) == 0 {
		panic("legacy JWT key is not initialized")
	}
}

// GenerateLegacyToken creates a legacy single-tenant JWT.
func GenerateLegacyToken(userID uint, email, username string, isAdmin bool, role string) (string, error) {
	if len(JWTKey) == 0 {
		return "", fmt.Errorf("legacy JWT key not initialized")
	}
	claims := jwt.MapClaims{
		"user_id":  userID,
		"email":    email,
		"username": username,
		"is_admin": isAdmin,
		"role":     role,
		"exp":      time.Now().Add(LegacyJWTExpiry).Unix(),
		"iat":      time.Now().Unix(),
		"jti":      uuid.New().String(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(JWTKey)
}

// ValidateLegacyToken verifies a legacy JWT and returns the user ID.
func ValidateLegacyToken(tokenString string) (uint, error) {
	if len(JWTKey) == 0 {
		return 0, fmt.Errorf("legacy JWT key not initialized")
	}
	if tokenString == "" {
		return 0, fmt.Errorf("empty token")
	}
	parsedToken, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Method.Alg())
		}
		return JWTKey, nil
	})
	if err != nil {
		return 0, fmt.Errorf("token parsing failed: %w", err)
	}
	if !parsedToken.Valid {
		return 0, fmt.Errorf("token is invalid")
	}
	claims, ok := parsedToken.Claims.(jwt.MapClaims)
	if !ok {
		return 0, fmt.Errorf("invalid claims format")
	}
	userIDFloat, ok := claims["user_id"].(float64)
	if !ok {
		return 0, fmt.Errorf("user_id claim missing or invalid")
	}
	return uint(userIDFloat), nil
}

// ExtractLegacyUserIDFromToken returns the user ID from a legacy JWT, or 0 on error.
func ExtractLegacyUserIDFromToken(tokenString string) uint {
	userID, _ := ValidateLegacyToken(tokenString)
	return userID
}

// ─── Platform JWT (multi-tenant, string UUID user IDs) ─────────
// Used by platform auth system for C-end user authentication.

var (
	// PlatformJWTKey is the HMAC secret for platform multi-tenant JWT tokens.
	// Loaded from PLATFORM_JWT_SECRET env var, or randomly generated.
	PlatformJWTKey []byte
)

const (
	// PlatformJWTExpiry is the platform JWT token expiry (24 hours).
	PlatformJWTExpiry = 24 * time.Hour
)

func init() {
	if secret := os.Getenv("PLATFORM_JWT_SECRET"); secret != "" {
		if len(secret) < 32 {
			panic("PLATFORM_JWT_SECRET must be at least 32 characters")
		}
		PlatformJWTKey = []byte(secret)
	} else {
		key := make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			panic("failed to generate platform JWT secret: " + err.Error())
		}
		PlatformJWTKey = key
	}
	if len(PlatformJWTKey) == 0 {
		panic("platform JWT key is not initialized")
	}
}

// PlatformClaims represents the claims in a platform multi-tenant JWT.
type PlatformClaims struct {
	UserID    string     `json:"sub"`
	Email     string     `json:"email"`
	IsAdmin   bool       `json:"is_admin"`
	Orgs      []OrgClaim `json:"orgs"`
	Teams     []TeamClaim `json:"teams"`
	AuthToken string     `json:"auth_token"`
	Exp       int64      `json:"exp"`
	Iat       int64      `json:"iat"`
	Jti       string     `json:"jti"`
}

// OrgClaim represents a user's membership in an organization.
type OrgClaim struct {
	ID   string `json:"id"`
	Role string `json:"role"`
}

// TeamClaim represents a user's membership in a team.
type TeamClaim struct {
	ID   string `json:"id"`
	Role string `json:"role"`
}

// IsOrgAdmin returns true if the user has admin role in the given organization.
func (c *PlatformClaims) IsOrgAdmin(orgID string) bool {
	for _, org := range c.Orgs {
		if org.ID == orgID && (org.Role == "admin" || org.Role == "owner") {
			return true
		}
	}
	return false
}

// IsTeamAdmin returns true if the user has admin role in the given team.
func (c *PlatformClaims) IsTeamAdmin(teamID string) bool {
	for _, team := range c.Teams {
		if team.ID == teamID && (team.Role == "admin" || team.Role == "owner") {
			return true
		}
	}
	return false
}

// SignPlatformJWT creates a signed platform JWT token.
func SignPlatformJWT(claims *PlatformClaims) (string, error) {
	if len(PlatformJWTKey) == 0 {
		return "", fmt.Errorf("platform JWT key not initialized")
	}
	claims.Exp = time.Now().Add(PlatformJWTExpiry).Unix()
	claims.Iat = time.Now().Unix()
	claims.Jti = uuid.New().String()

	mapClaims := jwt.MapClaims{
		"sub":        claims.UserID,
		"email":      claims.Email,
		"is_admin":   claims.IsAdmin,
		"orgs":       claims.Orgs,
		"teams":      claims.Teams,
		"auth_token": claims.AuthToken,
		"exp":        claims.Exp,
		"iat":        claims.Iat,
		"jti":        claims.Jti,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, mapClaims)
	return token.SignedString(PlatformJWTKey)
}

// VerifyPlatformJWT parses and validates a platform JWT, returning the claims.
func VerifyPlatformJWT(tokenString string) (*PlatformClaims, error) {
	if len(PlatformJWTKey) == 0 {
		return nil, fmt.Errorf("platform JWT key not initialized")
	}
	if tokenString == "" {
		return nil, fmt.Errorf("empty token")
	}
	parsedToken, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Method.Alg())
		}
		return PlatformJWTKey, nil
	})
	if err != nil {
		return nil, fmt.Errorf("platform token parsing failed: %w", err)
	}
	if !parsedToken.Valid {
		return nil, fmt.Errorf("platform token is invalid")
	}
	mapClaims, ok := parsedToken.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("invalid platform claims format")
	}
	claimsJSON, err := json.Marshal(mapClaims)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal platform claims: %w", err)
	}
	var claims PlatformClaims
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return nil, fmt.Errorf("failed to unmarshal platform claims: %w", err)
	}
	return &claims, nil
}
