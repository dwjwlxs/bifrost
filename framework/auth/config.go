package auth

import (
	"os"
	"time"
)

// Config holds the configuration for the AuthService.
type Config struct {
	// JWT ES256 Configuration
	// If JWKSKeyPair is nil, a new key pair is generated on startup.
	JWKSKeyPair  *JWKSKeyPairConfig `json:"jwks_key_pair,omitempty"`
	JWTIssuer    string             `json:"jwt_issuer"`
	JWTAudience  string             `json:"jwt_audience"`
	JWKSCacheTTL time.Duration      `json:"jwks_cache_ttl"`

	// Token Configuration
	AccessTokenTTL  time.Duration `json:"access_token_ttl"`
	RefreshTokenTTL time.Duration `json:"refresh_token_ttl"`

	// Password Configuration
	PasswordMinLength int `json:"password_min_length"`

	// Verification Code Configuration
	VerificationCodeLength  int           `json:"verification_code_length"`
	VerificationCodeTTL     time.Duration `json:"verification_code_ttl"`
	VerificationMaxAttempts int           `json:"verification_max_attempts"`

	// Rate Limiting (Login)
	LoginMaxAttempts     int           `json:"login_max_attempts"`
	LoginLockoutDuration time.Duration `json:"login_lockout_duration"`

	// Registration Rate Limiting
	RegisterRateLimitPerIP  int           `json:"register_rate_limit_per_ip"`
	RegisterRateLimitWindow time.Duration `json:"register_rate_limit_window"`

	// OAuth Configuration
	OAuth *OAuthConfig `json:"oauth,omitempty"`
}

// OAuthConfig holds OAuth provider configurations.
type OAuthConfig struct {
	// Wechat holds WeChat OAuth2 settings.
	// If Enabled is false, WeChat login endpoints return ErrOAuthProviderDisabled.
	Wechat *WechatOAuthConfig `json:"wechat,omitempty"`
}

// WechatOAuthConfig holds WeChat-specific OAuth2 configuration.
type WechatOAuthConfig struct {
	Enabled       bool   `json:"enabled"`
	AppID         string `json:"app_id"`
	AppSecret     string `json:"app_secret"`
	RedirectURI   string `json:"redirect_uri"`
}

// JWKSKeyPairConfig holds the PEM-encoded ES256 key pair.
// If both are empty, a new key pair is generated at startup.
type JWKSKeyPairConfig struct {
	PrivateKeyPEM string `json:"private_key_pem"`
	PublicKeyPEM  string `json:"public_key_pem"`
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		AccessTokenTTL:          15 * time.Minute,
		RefreshTokenTTL:         30 * 24 * time.Hour, // 30 days
		PasswordMinLength:       8,
		VerificationCodeLength:  6,
		VerificationCodeTTL:     15 * time.Minute,
		VerificationMaxAttempts: 5,
		LoginMaxAttempts:        5,
		LoginLockoutDuration:    15 * time.Minute,
		RegisterRateLimitPerIP:  10,
		RegisterRateLimitWindow: time.Hour,
		JWKSCacheTTL:            time.Hour,
	}
}

// LoadOAuthConfigFromEnv populates OAuthConfig from environment variables.
// This allows controlling WeChat login without changing the config file.
// Env vars:
//
//	BIFROST_OAUTH_WECHAT_ENABLED  = "true"/"false"
//	BIFROST_OAUTH_WECHAT_APPID    = WeChat AppID
//	BIFROST_OAUTH_WECHAT_SECRET   = WeChat AppSecret
//	BIFROST_OAUTH_WECHAT_REDIRECT = OAuth redirect URI
func (c *Config) LoadOAuthConfigFromEnv() {
	enabled := os.Getenv("BIFROST_OAUTH_WECHAT_ENABLED")
	if enabled == "" {
		return
	}

	if c.OAuth == nil {
		c.OAuth = &OAuthConfig{}
	}

	wechatEnabled := enabled == "true" || enabled == "1" || enabled == "yes"
	c.OAuth.Wechat = &WechatOAuthConfig{
		Enabled:     wechatEnabled,
		AppID:       os.Getenv("BIFROST_OAUTH_WECHAT_APPID"),
		AppSecret:   os.Getenv("BIFROST_OAUTH_WECHAT_SECRET"),
		RedirectURI: os.Getenv("BIFROST_OAUTH_WECHAT_REDIRECT"),
	}
}
