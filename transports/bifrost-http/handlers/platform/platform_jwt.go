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

// ─── Platform JWT (multi-tenant, string UUID user IDs) ─────────
// Used by platform auth system for C-end user authentication.

var (
	// PlatformJWTKey is the HMAC secret for platform multi-tenant JWT tokens.
	// Loaded from PLATFORM_JWT_SECRET env var, or randomly generated.
	PlatformJWTKey []byte

	// PlatformJWTExpiry is the platform JWT token expiry (24 hours).
	// Loaded from PLATFORM_JWT_EXPIRY env var, or defaults to 24 hours.
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

	if expiry := os.Getenv("PLATFORM_JWT_EXPIRY"); expiry != "" {
		d, err := time.ParseDuration(expiry)
		if err != nil {
			panic("invalid PLATFORM_JWT_EXPIRY: " + err.Error())
		}
		PlatformJWTExpiry = d
	}
}

// PlatformClaims represents the claims in a platform multi-tenant JWT.
type PlatformClaims struct {
	UserID    string      `json:"sub"`
	IsAdmin   bool        `json:"is_admin"`
	Orgs      []OrgClaim  `json:"orgs"`
	Teams     []TeamClaim `json:"teams"`
	AuthToken string      `json:"auth_token"`
	Email     string      `json:"email"`
	UserName  string      `json:"user_name"`
	Exp       int64       `json:"exp"`
	Iat       int64       `json:"iat"`
	Jti       string      `json:"jti"`
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

// SignPlatformJWT creates a signed platform JWT token using the given HMAC key and expiry.
// If key is empty, returns error.
func SignPlatformJWT(claims *PlatformClaims, key []byte, expiry time.Duration) (string, error) {
	if len(key) == 0 {
		return "", fmt.Errorf("platform JWT key is empty")
	}
	claims.Exp = time.Now().Add(expiry).Unix()
	claims.Iat = time.Now().Unix()
	claims.Jti = uuid.New().String()

	mapClaims := jwt.MapClaims{
		"sub":        claims.UserID,
		"is_admin":   claims.IsAdmin,
		"orgs":       claims.Orgs,
		"teams":      claims.Teams,
		"auth_token": claims.AuthToken,
		"user_name":  claims.UserName,
		"email":      claims.Email,
		"exp":        claims.Exp,
		"iat":        claims.Iat,
		"jti":        claims.Jti,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, mapClaims)
	return token.SignedString(key)
}

// VerifyPlatformJWT parses and validates a platform JWT using the given HMAC key,
// returning the claims. Returns error if key is empty or token is invalid.
func VerifyPlatformJWT(tokenString string, key []byte) (*PlatformClaims, error) {
	if len(key) == 0 {
		return nil, fmt.Errorf("platform JWT key is empty")
	}
	if tokenString == "" {
		return nil, fmt.Errorf("empty token")
	}
	parsedToken, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Method.Alg())
		}
		return key, nil
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
