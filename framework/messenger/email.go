package messenger

import (
	"fmt"
	"strings"

	"github.com/go-mail/mail/v2"
)

// EmailSender handles email sending using go-mail/mail.
type EmailSender struct {
	config Config
}

// Send sends an email with the given recipient, subject, and HTML body.
// Uses go-mail/mail for SMTP handling.
func (s *EmailSender) Send(to, subject, htmlBody string) error {
	m := mail.NewMessage()
	m.SetHeader("From", s.config.From)
	m.SetHeader("To", to)
	m.SetHeader("Subject", subject)
	m.SetBody("text/html", htmlBody)

	d := mail.NewDialer(s.config.Host, s.config.Port, s.config.Username, s.config.Password)

	if s.config.UseSSL {
		d.SSL = true
	}
	if s.config.UseTLS {
		d.StartTLSPolicy = mail.MandatoryStartTLS
	}

	if err := d.DialAndSend(m); err != nil {
		s.config.Logger.Error("failed to send email: %v, %v, %v", to, subject, err)
		return err
	}
	s.config.Logger.Debug("email sent successfully: %v, %v, %v", to, subject, htmlBody)
	return nil
}

// ValidateConfig checks if the SMTP config is valid.
// Username is optional — some local SMTP relays do not require auth.
func ValidateConfig(cfg Config) error {
	if cfg.Host == "" {
		return fmt.Errorf("SMTP host is required")
	}
	if cfg.Port == 0 {
		return fmt.Errorf("SMTP port is required")
	}
	if cfg.From == "" {
		return fmt.Errorf("From address is required")
	}
	return nil
}

// ParseAddress parses a full email address "Name <email@example.com>" into parts.
func ParseAddress(addr string) (name, email string, err error) {
	// Handle "Name <email@example.com>" format
	if strings.Contains(addr, "<") {
		parts := strings.Split(addr, "<")
		name = strings.TrimSpace(parts[0])
		email = strings.TrimSuffix(parts[1], ">")
		email = strings.TrimSpace(email)
	} else {
		email = strings.TrimSpace(addr)
	}

	if email == "" {
		return "", "", fmt.Errorf("invalid email address: %s", addr)
	}

	return name, email, nil
}
