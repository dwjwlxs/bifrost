// Package email provides email sending functionality for Bifrost.
package email

import (
	"fmt"
	"strings"
	"sync"

	"github.com/go-mail/mail/v2"
)

// Config holds SMTP configuration.
type Config struct {
	Host     string // SMTP server host (e.g., "smtp.gmail.com")
	Port     int    // SMTP server port (e.g., 587 for TLS, 465 for SSL)
	Username string // SMTP auth username
	Password string // SMTP auth password (or app password)
	From     string // Sender email address
	UseTLS   bool   // Use TLS (port 587)
	UseSSL   bool   // Use SSL (port 465)
	AppURL   string // Base URL for constructing invite links (e.g., "https://app.bifrost.ai")
}

// Interface for email sender (allows swapping implementations).
type Sender interface {
	Send(to, subject, body string) error
}

func NewSender(config Config) Sender {
	return &EmailSender{config: config}
}

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

	return d.DialAndSend(m)
}

// NoOpSender is a sender that logs emails instead of sending them.
// Useful for development and testing.
type NoOpSender struct {
	mu     sync.Mutex
	emails []NoOpEmail
}

// NoOpEmail represents a logged email.
type NoOpEmail struct {
	To      string
	Subject string
	Body    string
}

// NewNoOpSender creates a sender that logs emails instead of sending.
func NewNoOpSender() Sender {
	return &NoOpSender{}
}

// Send logs the email instead of sending it.
func (s *NoOpSender) Send(to, subject, body string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.emails = append(s.emails, NoOpEmail{
		To:      to,
		Subject: subject,
		Body:    body,
	})
	fmt.Printf("[EMAIL] To: %s, Subject: %s\n", to, subject)
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
