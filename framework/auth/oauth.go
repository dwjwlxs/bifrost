package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// --- OAuth2 Provider abstraction ---

// OAuthUserInfo holds normalized user information from any OAuth provider.
type OAuthUserInfo struct {
	Provider    IdentityProvider
	ProviderUID string
	DisplayName string
	AvatarURL   string
	Email       string // may be empty if provider doesn't expose it
}

// OAuthProvider abstracts the OAuth2 authorization code flow.
// Each provider implements: AuthCodeURL, Exchange, GetUserInfo.
type OAuthProvider interface {
	// Name returns the provider identifier (e.g., "wechat").
	Name() IdentityProvider

	// AuthCodeURL returns the URL the user should be redirected to for authorization.
	// state is a CSRF protection token stored in the session.
	AuthCodeURL(state string) string

	// Exchange exchanges an authorization code for user info.
	// This performs the token exchange + user info fetch in one call.
	Exchange(ctx context.Context, code string) (*OAuthUserInfo, error)
}

// OAuthProviderRegistry maps provider names to implementations.
type OAuthProviderRegistry struct {
	providers map[IdentityProvider]OAuthProvider
}

// NewOAuthProviderRegistry creates a registry from the OAuth config.
// Disabled providers are not registered.
func NewOAuthProviderRegistry(config *OAuthConfig) *OAuthProviderRegistry {
	r := &OAuthProviderRegistry{
		providers: make(map[IdentityProvider]OAuthProvider),
	}

	if config == nil {
		return r
	}

	if config.Wechat != nil && config.Wechat.Enabled {
		r.providers[IdentityProviderWechat] = NewWechatProvider(config.Wechat)
	}

	return r
}

// Get returns a registered provider, or nil if not found/disabled.
func (r *OAuthProviderRegistry) Get(provider IdentityProvider) OAuthProvider {
	return r.providers[provider]
}

// IsEnabled returns true if the provider is registered and enabled.
func (r *OAuthProviderRegistry) IsEnabled(provider IdentityProvider) bool {
	return r.providers[provider] != nil
}

// --- WeChat OAuth2 implementation ---

// WechatProvider implements OAuthProvider for WeChat Open Platform.
// Docs: https://open.weixin.qq.com/cgi-bin/showdocument?action=dirlist&t=resource/res_list&verify=1
type WechatProvider struct {
	appID       string
	appSecret   string
	redirectURI string
	httpClient  *http.Client
}

// NewWechatProvider creates a WeChat OAuth2 provider.
func NewWechatProvider(config *WechatOAuthConfig) OAuthProvider {
	return &WechatProvider{
		appID:       config.AppID,
		appSecret:   config.AppSecret,
		redirectURI: config.RedirectURI,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (p *WechatProvider) Name() IdentityProvider {
	return IdentityProviderWechat
}

// AuthCodeURL builds the WeChat OAuth2 authorization URL.
// WeChat uses web.weixin.qq.com for web OAuth2.
func (p *WechatProvider) AuthCodeURL(state string) string {
	params := url.Values{
		"appid":         {p.appID},
		"redirect_uri":  {p.redirectURI},
		"response_type": {"code"},
		"scope":         {"snsapi_login"},
		"state":         {state},
	}
	return "https://open.weixin.qq.com/connect/qrconnect?" + params.Encode()
}

// Exchange performs the WeChat OAuth2 token exchange and user info fetch.
//
// WeChat flow:
//  1. GET https://api.weixin.qq.com/sns/oauth2/access_token
//     ?appid=APPID&secret=SECRET&code=CODE&grant_type=authorization_code
//     → returns { access_token, openid, ... }
//
//  2. GET https://api.weixin.qq.com/sns/userinfo
//     ?access_token=TOKEN&openid=OPENID&lang=zh_CN
//     → returns { nickname, headimgurl, ... }
func (p *WechatProvider) Exchange(ctx context.Context, code string) (*OAuthUserInfo, error) {
	// Step 1: Exchange code for access_token + openid
	tokenURL := fmt.Sprintf(
		"https://api.weixin.qq.com/sns/oauth2/access_token?appid=%s&secret=%s&code=%s&grant_type=authorization_code",
		p.appID, p.appSecret, code,
	)

	tokenBody, err := p.doGet(ctx, tokenURL)
	if err != nil {
		return nil, fmt.Errorf("%w: token request failed: %v", ErrOAuthInvalidCode, err)
	}

	var tokenResp wechatTokenResponse
	if err := json.Unmarshal(tokenBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("%w: failed to parse token response: %v", ErrOAuthInvalidCode, err)
	}

	if tokenResp.Errcode != 0 {
		return nil, fmt.Errorf("%w: wechat error %d: %s", ErrOAuthInvalidCode, tokenResp.Errcode, tokenResp.Errmsg)
	}

	if tokenResp.AccessToken == "" || tokenResp.OpenID == "" {
		return nil, fmt.Errorf("%w: missing access_token or openid", ErrOAuthInvalidCode)
	}

	// Step 2: Fetch user info
	userInfoURL := fmt.Sprintf(
		"https://api.weixin.qq.com/sns/userinfo?access_token=%s&openid=%s&lang=zh_CN",
		tokenResp.AccessToken, tokenResp.OpenID,
	)

	userBody, err := p.doGet(ctx, userInfoURL)
	if err != nil {
		return nil, fmt.Errorf("wechat: failed to fetch user info: %v", err)
	}

	var userResp wechatUserResponse
	if err := json.Unmarshal(userBody, &userResp); err != nil {
		return nil, fmt.Errorf("wechat: failed to parse user info: %v", err)
	}

	if userResp.Errcode != 0 {
		return nil, fmt.Errorf("wechat: user info error %d: %s", userResp.Errcode, userResp.Errmsg)
	}

	return &OAuthUserInfo{
		Provider:    IdentityProviderWechat,
		ProviderUID: tokenResp.OpenID,
		DisplayName: userResp.Nickname,
		AvatarURL:   userResp.HeadImgURL,
	}, nil
}

// --- WeChat API response types ---

type wechatTokenResponse struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	OpenID       string `json:"openid"`
	Scope        string `json:"scope"`
	UnionID      string `json:"unionid,omitempty"`
	Errcode      int    `json:"errcode"`
	Errmsg       string `json:"errmsg"`
}

type wechatUserResponse struct {
	OpenID     string `json:"openid"`
	Nickname   string `json:"nickname"`
	HeadImgURL string `json:"headimgurl"`
	Sex        int    `json:"sex"`
	Province   string `json:"province"`
	City       string `json:"city"`
	Country    string `json:"country"`
	Errcode    int    `json:"errcode"`
	Errmsg     string `json:"errmsg"`
}

func (p *WechatProvider) doGet(ctx context.Context, urlStr string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return nil, err
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}

	return body, nil
}

// --- CSRF state helper ---

// GenerateOAuthState creates a random hex state token for CSRF protection.
func GenerateOAuthState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("auth: failed to generate OAuth state: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// ParseWechatCallbackQuery extracts code and state from a WeChat OAuth callback URL query string.
func ParseWechatCallbackQuery(query string) (code, state string, err error) {
	params, err := url.ParseQuery(query)
	if err != nil {
		return "", "", fmt.Errorf("auth: failed to parse OAuth callback: %w", err)
	}

	code = strings.TrimSpace(params.Get("code"))
	state = strings.TrimSpace(params.Get("state"))

	if code == "" {
		return "", "", fmt.Errorf("%w: missing code parameter", ErrOAuthInvalidCode)
	}

	return code, state, nil
}
