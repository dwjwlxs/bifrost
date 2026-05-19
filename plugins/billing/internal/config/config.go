package config

import (
	"fmt"
	"time"

	"github.com/bytedance/sonic"
	authsvc "github.com/dwjwlxs/bifrost/plugins/billing/internal/services/authn"
	bpayment "github.com/dwjwlxs/bifrost/plugins/billing/internal/services/payment"
	"github.com/dwjwlxs/bifrost/plugins/billing/pkg/cache"
	"github.com/dwjwlxs/bifrost/plugins/billing/pkg/messenger"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
)

const PluginName = "billing"

func LoadConfig(config *lib.Config) (*BillingPluginConfig, error) {
	var pluginConfig *schemas.PluginConfig
	for _, c := range config.PluginConfigs {
		if c.Name == PluginName {
			pluginConfig = c
			break
		}
	}
	if pluginConfig == nil {
		return nil, fmt.Errorf("can not found plugin config for plugin: %v", PluginName)
	}

	data, err := sonic.Marshal(pluginConfig.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal plugin config: %v %w", PluginName, err)
	}
	var conf BillingPluginConfig
	if err := sonic.Unmarshal([]byte(data), &conf); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config file: %w", err)
	}

	result := &conf
	result.Logger = config.Logger
	result.Config = config
	if err := result.loadMessenger(); err != nil {
		return nil, fmt.Errorf("failed to load messenger: %w", err)
	}
	if err := result.loadConsumerAuthConfig(); err != nil {
		return nil, fmt.Errorf("failed to load consumer auth config: %w", err)
	}
	if err := result.loadCacheConfig(); err != nil {
		return nil, fmt.Errorf("failed to load cache config: %w", err)
	}
	return result, nil
}

type BillingPluginConfig struct {
	Config *lib.Config

	// Payment gateway 配置
	GatewayConfig *bpayment.BillingConfig `json:"billing,omitempty"`
	// BillingConfig holds the billing/payment gateway configuration.
	// BillingConfig *fpayment.BillingConfig
	// Cache holds the shared cache configuration (used by billing plugin for Redis-based budget caching).
	Cache *cache.CacheConfig `json:"cache,omitempty"`
	// Dump 间隔（秒），默认 10
	DumpIntervalSec int `json:"dump_interval_sec,omitempty"`
	// PlatformURL is the public-facing base URL of this Bifrost deployment (e.g. "https://bifrost.example.com").
	// Used for generating invitation accept links. Falls back to the host/port from the HTTP listener.
	PlatformURL string `json:"platform_url,omitempty"`
	// PlatformAuth holds configuration for platform multi-tenant authentication.
	// If ConsumerAuthService is nil, platform auth is disabled.
	PlatformAuthEnabled bool                    `json:"platform_auth_enabled"`
	EmailConfig         *EmailConfigData        `json:"email_config,omitempty"`
	ConsumerAuthConfig  *ConsumerAuthConfigData `json:"consumer_auth_config,omitempty"`

	// Consumer Authentication Service (C-end user account system).
	// If non-nil, /api/auth/* routes are registered.
	ConsumerAuthService authsvc.AuthService `json:"-"`
	// MessageSender is the shared email/SMS sender used by consumer auth and platform
	// invitation features. Initialized during loadConsumerAuthConfig.
	Messenger messenger.Sender `json:"-"`
	Logger    schemas.Logger   `json:"-"`
}

type EmailConfigData struct {
	Host     string `json:"host,omitempty"`
	Port     int    `json:"port,omitempty"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	From     string `json:"from,omitempty"`
	UseTLS   bool   `json:"use_tls,omitempty"`
	UseSSL   bool   `json:"use_ssl,omitempty"`
	AppURL   string `json:"app_url,omitempty"`
}

func (cfg *BillingPluginConfig) loadMessenger() error {
	var emailCfg messenger.Config
	if cfg.EmailConfig != nil {
		emailCfg = messenger.Config{
			Host:     cfg.EmailConfig.Host,
			Port:     cfg.EmailConfig.Port,
			Username: cfg.EmailConfig.Username,
			Password: cfg.EmailConfig.Password,
			From:     cfg.EmailConfig.From,
			UseTLS:   cfg.EmailConfig.UseTLS,
			UseSSL:   cfg.EmailConfig.UseSSL,

			Logger: cfg.Logger,
		}
	}

	cfg.Messenger = messenger.NewSender(emailCfg)
	return nil
}

// ConsumerAuthConfigData mirrors the JSON structure of consumer_auth_config.
// String fields for durations (e.g. "15m", "30d") are parsed into time.Duration
// when building the internal authsvc.Config.
type ConsumerAuthConfigData struct {
	IsEnabled bool `json:"is_enabled"`

	JWT *ConsumerAuthJWTConfig `json:"jwt,omitempty"`

	// Token / password / verification code / rate limit settings
	AccessTokenTTL          string `json:"access_token_ttl,omitempty"`
	RefreshTokenTTL         string `json:"refresh_token_ttl,omitempty"`
	PasswordMinLength       int    `json:"password_min_length,omitempty"`
	VerificationCodeLength  int    `json:"verification_code_length,omitempty"`
	VerificationCodeTTL     string `json:"verification_code_ttl,omitempty"`
	VerificationMaxAttempts int    `json:"verification_max_attempts,omitempty"`
	LoginMaxAttempts        int    `json:"login_max_attempts,omitempty"`
	LoginLockoutDuration    string `json:"login_lockout_duration,omitempty"`
	RegisterRateLimitPerIP  int    `json:"register_rate_limit_per_ip,omitempty"`
	RegisterRateLimitWindow string `json:"register_rate_limit_window,omitempty"`
	AccountDeletionCoolDown string `json:"account_deletion_cool_down,omitempty"`

	KeyRotation *ConsumerAuthKeyRotationConfig `json:"key_rotation,omitempty"`
	OAuth       *ConsumerAuthOAuthConfig       `json:"oauth,omitempty"`
}

// loadConsumerAuthConfig initializes the consumer auth service from config.
func (cfg *BillingPluginConfig) loadConsumerAuthConfig() error {
	data := cfg.ConsumerAuthConfig

	// Build authsvc.Config
	authCfg := authsvc.DefaultConfig()
	if data.JWT != nil {
		if data.JWT.Issuer != "" {
			authCfg.JWTIssuer = data.JWT.Issuer
		}
		if data.JWT.Audience != "" {
			authCfg.JWTAudience = data.JWT.Audience
		}
		if data.JWT.KeyPair != nil && data.JWT.KeyPair.PrivateKeyPEM != "" && data.JWT.KeyPair.PublicKeyPEM != "" {
			authCfg.JWKSKeyPair = &authsvc.JWKSKeyPairConfig{
				PrivateKeyPEM: data.JWT.KeyPair.PrivateKeyPEM,
				PublicKeyPEM:  data.JWT.KeyPair.PublicKeyPEM,
			}
		}
	}

	// Override defaults with explicit config values
	if data.AccessTokenTTL != "" {
		if d, err := time.ParseDuration(data.AccessTokenTTL); err == nil {
			authCfg.AccessTokenTTL = d
		}
	}
	if data.RefreshTokenTTL != "" {
		if d, err := time.ParseDuration(data.RefreshTokenTTL); err == nil {
			authCfg.RefreshTokenTTL = d
		}
	}
	if data.PasswordMinLength > 0 {
		authCfg.PasswordMinLength = data.PasswordMinLength
	}
	if data.VerificationCodeLength > 0 {
		authCfg.VerificationCodeLength = data.VerificationCodeLength
	}
	if data.VerificationCodeTTL != "" {
		if d, err := time.ParseDuration(data.VerificationCodeTTL); err == nil {
			authCfg.VerificationCodeTTL = d
		}
	}
	if data.VerificationMaxAttempts > 0 {
		authCfg.VerificationMaxAttempts = data.VerificationMaxAttempts
	}
	if data.LoginMaxAttempts > 0 {
		authCfg.LoginMaxAttempts = data.LoginMaxAttempts
	}
	if data.LoginLockoutDuration != "" {
		if d, err := time.ParseDuration(data.LoginLockoutDuration); err == nil {
			authCfg.LoginLockoutDuration = d
		}
	}
	if data.RegisterRateLimitPerIP > 0 {
		authCfg.RegisterRateLimitPerIP = data.RegisterRateLimitPerIP
	}
	if data.RegisterRateLimitWindow != "" {
		if d, err := time.ParseDuration(data.RegisterRateLimitWindow); err == nil {
			authCfg.RegisterRateLimitWindow = d
		}
	}
	if data.AccountDeletionCoolDown != "" {
		if d, err := time.ParseDuration(data.AccountDeletionCoolDown); err == nil {
			authCfg.AccountDeletionCoolDown = d
		}
	}

	// Key rotation
	if data.KeyRotation != nil {
		krc := &authsvc.KeyRotationConfig{}
		if data.KeyRotation.KeyTTL != "" {
			if d, err := time.ParseDuration(data.KeyRotation.KeyTTL); err == nil {
				krc.KeyTTL = d
			}
		}
		if data.KeyRotation.RotationInterval != "" {
			if d, err := time.ParseDuration(data.KeyRotation.RotationInterval); err == nil {
				krc.RotationInterval = d
			}
		}
		if data.KeyRotation.GracePeriod != "" {
			if d, err := time.ParseDuration(data.KeyRotation.GracePeriod); err == nil {
				krc.GracePeriod = d
			}
		}
		authCfg.KeyRotation = krc
	}

	// OAuth
	if data.OAuth != nil && data.OAuth.Wechat != nil {
		wc := data.OAuth.Wechat
		authCfg.OAuth = &authsvc.OAuthConfig{
			Wechat: &authsvc.WechatOAuthConfig{
				Enabled:     wc.Enabled,
				AppID:       wc.AppID,
				AppSecret:   wc.AppSecret,
				RedirectURI: wc.RedirectURI,
			},
		}
	}

	// Load OAuth from env (overrides config file values)
	authCfg.LoadOAuthConfigFromEnv()

	// Build store factory
	storeFactory := authsvc.NewGormStoreFactory(cfg.Config.ConfigStore.DB())

	// Rate limiter (in-memory noop for now; redis-backed can be added later)
	rateLimiter := &authsvc.NoopRateLimiter{}

	// Create auth service
	authService, err := authsvc.NewAuthService(authCfg, storeFactory, cfg.Messenger, rateLimiter, cfg.Logger)
	if err != nil {
		return fmt.Errorf("failed to create consumer auth service: %w", err)
	}

	cfg.ConsumerAuthService = authService
	cfg.Logger.Info("consumer auth service initialized")
	return nil
}

type ConsumerAuthJWTConfig struct {
	Issuer   string                     `json:"issuer,omitempty"`
	Audience string                     `json:"audience,omitempty"`
	KeyPair  *ConsumerAuthKeyPairConfig `json:"key_pair,omitempty"`
}

type ConsumerAuthKeyPairConfig struct {
	PrivateKeyPEM string `json:"private_key_pem,omitempty"`
	PublicKeyPEM  string `json:"public_key_pem,omitempty"`
}

type ConsumerAuthKeyRotationConfig struct {
	KeyTTL           string `json:"key_ttl,omitempty"`
	RotationInterval string `json:"rotation_interval,omitempty"`
	GracePeriod      string `json:"grace_period,omitempty"`
}

type ConsumerAuthOAuthConfig struct {
	Wechat *ConsumerAuthWechatConfig `json:"wechat,omitempty"`
}

type ConsumerAuthWechatConfig struct {
	Enabled     bool   `json:"enabled"`
	AppID       string `json:"app_id,omitempty"`
	AppSecret   string `json:"app_secret,omitempty"`
	RedirectURI string `json:"redirect_uri,omitempty"`
}

func (cfg *BillingPluginConfig) loadCacheConfig() error {
	// noop
	return nil
}
