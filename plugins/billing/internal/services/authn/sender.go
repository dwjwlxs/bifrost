package authn

import (
	"bytes"
	"context"
	"fmt"
	"text/template"
)

func (s *service) send(recipient, subject, body string) error {
	return s.codeSender.Send(recipient, subject, body)
}

func (s *service) sendVerificationCode(ctx context.Context, recipient string, codeType VerificationCodeType, code string) error {
	body, err := s.renderVerificationCodeTemplate(recipient, codeType, code)
	if err != nil {
		return err
	}
	s.logger.Debug("send verify_code %s to %s", code, recipient)

	subject := ""
	switch codeType {
	case VerificationCodeTypeEmailVerify:
		subject = "dRouter — Email Verification Code"
	case VerificationCodeTypePasswordReset:
		subject = "dRouter — Password Reset Code"
	default:
		return fmt.Errorf("unknown code type: %s", codeType)
	}

	return s.send(recipient, subject, body)
}

// renderVerificationCodeTemplate renders the verification code email as HTML.
func (s *service) renderVerificationCodeTemplate(recipient string, codeType VerificationCodeType, code string) (string, error) {
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
            <h1>dRouter</h1>
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
