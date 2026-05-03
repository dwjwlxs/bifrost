package messenger

import (
	"sync"

	"github.com/maximhq/bifrost/core/schemas"
)

// Config holds SMTP configuration.
type Config struct {
	Host     string // SMTP server host (e.g., "smtp.gmail.com")
	Port     int    // SMTP server port (e.g., 587 for TLS, 465 for SSL)
	Username string // SMTP auth username (or email)
	Password string // SMTP auth password (or app password)
	From     string // Sender email address
	UseTLS   bool   // Use TLS (port 587)
	UseSSL   bool   // Use SSL (port 465)

	Logger schemas.Logger
}

// Interface for email sender (allows swapping implementations).
type Sender interface {
	Send(to, subject, body string) error
}

func NewSender(config Config) Sender {
	return &EmailSender{config: config}
}

// NoOpSender is a sender that logs emails instead of sending them.
// Useful for development and testing.
type NoOpSender struct {
	mu     sync.Mutex
	emails []NoOpEmail
	logger schemas.Logger
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
	return nil
}

func (s *NoOpSender) GetBy(email string) string {
	for _, e := range s.emails {
		if e.To == email {
			return email
		}
	}
	return ""
}
