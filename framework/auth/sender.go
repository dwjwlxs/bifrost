package auth

import (
	"bytes"
	"context"
	"fmt"
	"text/template"

	"github.com/maximhq/bifrost/framework/email"
)

// MessageSender abstracts the delivery of verification codes (email, SMS, etc.).
// Implementations should be non-blocking and idempotent.
type MessageSender interface {
	// SendVerificationCode delivers a verification code to the recipient.
	// The code is plaintext; the caller should format it for the user.
	SendVerificationCode(ctx context.Context, recipient string, codeType VerificationCodeType, code string) error

	SendInvite(recipient, subject string, data InviteData) error
}

// InviteData holds data for invite email template.
type InviteData struct {
	InviterName string // Name of the person who sent the invite
	OrgName     string // Organization name
	TeamName    string // Team name (optional)
	Role        string // Role the invitee will have
	AcceptURL   string // URL to accept the invite
	ExpiresIn   string // When the invite expires
}

// NoopMessageSender is a no-op sender that discards codes (for testing).
type NoopMessageSender struct{}

var _ MessageSender = (*NoopMessageSender)(nil)

func (NoopMessageSender) SendVerificationCode(_ context.Context, _ string, _ VerificationCodeType, _ string) error {
	return nil
}

func (NoopMessageSender) SendInvite(_, _ string, _ InviteData) error {
	return nil
}

// NewMessageSender creates a new email sender with the given config.
func NewMessageSender(config email.Config) MessageSender {
	return newEmailMessageSender(config)
}

// NewDefaultSender creates a real email sender with localhost:25 defaults.
// Suitable when no explicit SMTP configuration is available.
// Emails will be attempted via a local SMTP relay; failures are non-fatal at the call site.
func NewDefaultSender() MessageSender {
	return newEmailMessageSender(email.Config{
		Host: "localhost",
		Port: 25,
		From: "noreply@localhost",
	})
}

type EmailMessageSender struct {
	config email.Config
	sender email.Sender
}

func newEmailMessageSender(conf email.Config) MessageSender {
	return &EmailMessageSender{
		config: conf,
		sender: email.NewSender(conf),
	}
}

// Send sends email via SMTP.
func (s *EmailMessageSender) Send(recipient, subject, body string) error {
	return s.sender.Send(recipient, subject, body)
}

// SendVerificationCode sends a verification code email via SendGrid.
func (s *EmailMessageSender) SendVerificationCode(ctx context.Context, recipient string, codeType VerificationCodeType, code string) error {
	body, err := s.renderVerificationCodeTemplate(recipient, codeType, code)
	if err != nil {
		return err
	}

	subject := ""
	switch codeType {
	case VerificationCodeTypeEmailVerify:
		subject = "Bifrost — Email Verification Code"
	case VerificationCodeTypePasswordReset:
		subject = "Bifrost — Password Reset Code"
	default:
		return fmt.Errorf("unknown code type: %s", codeType)
	}

	return s.Send(recipient, subject, body)
}

// renderVerificationCodeTemplate renders the verification code email as HTML.
func (s *EmailMessageSender) renderVerificationCodeTemplate(recipient string, codeType VerificationCodeType, code string) (string, error) {
	const tmpl = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 28px; letter-spacing: 2px; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
        .code-box { background: white; border: 2px solid #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0; }
        .code { font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #667eea; }
        .expiry { color: #888; font-size: 14px; margin-top: 8px; }
        .footer { text-align: center; color: #999; font-size: 12px; margin-top: 24px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Bifrost</h1>
        </div>
        <div class="content">
            <p>Hello {{.Username}},</p>
            <p>Your email verification code is:</p>
            <div class="code-box">
                <div class="code">{{.Code}}</div>
                <div class="expiry">This code will expire in 15 minutes.</div>
            </div>
            <div class="footer">
                <p>If you didn't create an account, please ignore this email.</p>
            </div>
        </div>
    </div>
</body>
</html>`

	t, err := template.New("verification").Parse(tmpl)
	if err != nil {
		return "", err
	}

	var buf bytes.Buffer
	if err := t.Execute(&buf, struct {
		Username string
		Code     string
	}{Username: recipient, Code: code}); err != nil {
		return "", err
	}

	return buf.String(), nil
}

// SendInvite sends an invite email via SendGrid.
func (s *EmailMessageSender) SendInvite(recipient, subject string, data InviteData) error {
	body, err := s.renderInviteTemplate(data)
	if err != nil {
		return err
	}
	return s.Send(recipient, subject, body)
}

func (s *EmailMessageSender) renderInviteTemplate(data InviteData) (string, error) {
	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf(`You've been invited to join %s`, data.OrgName))
	if data.TeamName != "" {
		buf.WriteString(fmt.Sprintf(` as part of the %s team`, data.TeamName))
	}
	buf.WriteString(fmt.Sprintf(`.

Role: %s
Invited by: %s
Accept URL: %s
Expires: %s
`, data.Role, data.InviterName, data.AcceptURL, data.ExpiresIn))
	return buf.String(), nil
}
