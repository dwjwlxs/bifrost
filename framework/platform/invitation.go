package platform

import (
	"bytes"
	"fmt"
	"text/template"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/messenger"
	"github.com/maximhq/bifrost/framework/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// InvitationService handles invitation creation and acceptance logic.
type InvitationService interface {
	CreateInvitation(teamID string, orgID *string, email, role, inviterName, teamName, orgName string) error
	AcceptInvitation(token, userID, userEmail string) error
}

// NewInvitationService creates a new InvitationService.
func NewInvitationService(db *gorm.DB, messageSender messenger.Sender, platformURL string, logger schemas.Logger) InvitationService {
	return &InvitationServiceImpl{
		db:            db,
		messageSender: messageSender,
		platformURL:   platformURL,
		logger:        logger,
	}
}

type InvitationServiceImpl struct {
	db            *gorm.DB
	messageSender messenger.Sender
	platformURL   string
	logger        schemas.Logger
}

// CreateInvitation creates a pending invitation for a user to join a team.
// teamID is required; orgID may be nil if the team has no parent org.
func (s *InvitationServiceImpl) CreateInvitation(teamID string, orgID *string, email, role, inviterName, teamName, orgName string) error {
	token := schemas.NewID()
	invitation := tables.TablePlatformInvitation{
		ID:        schemas.NewID(),
		TeamID:    &teamID,
		OrgID:     orgID,
		Email:     email,
		Role:      role,
		Token:     token,
		ExpiresAt: time.Now().Add(7 * 24 * time.Hour),
		Accepted:  false,
	}

	if err := s.db.Create(&invitation).Error; err != nil {
		return fmt.Errorf("create invitation record: %w", err)
	}

	s.logger.Debug("user %s invites %s with %s", inviterName, email, token)

	// Send invitation email asynchronously — failures are non-fatal
	if s.messageSender != nil && s.platformURL != "" {
		acceptURL := fmt.Sprintf("%s/platform/invitation/%s", s.platformURL, token)
		inviteData := model.InviteData{
			InviterName: inviterName,
			OrgName:     orgName,
			TeamName:    teamName,
			Role:        role,
			AcceptURL:   acceptURL,
			ExpiresIn:   "7 days",
		}
		subject := "You've been invited to join " + orgName
		if teamName != "" {
			subject = "You've been invited to join " + orgName + " team " + teamName
		}
		if err := s.sendInvitation(email, subject, inviteData); err != nil {
			s.logger.Warn("failed to send invitation email to %s: %v", email, err)
		}
	}

	return nil
}

// AcceptInvitation adds the user to the team/org described by the invitation.
// It verifies that the invitation's email matches the provided userEmail.
func (s *InvitationServiceImpl) AcceptInvitation(token, userID, userEmail string) error {
	var invitation tables.TablePlatformInvitation
	if err := s.db.Where("token = ?", token).First(&invitation).Error; err != nil {
		return fmt.Errorf("invitation not found")
	}

	if invitation.Accepted {
		return fmt.Errorf("invitation already accepted")
	}
	if time.Now().After(invitation.ExpiresAt) {
		return fmt.Errorf("invitation has expired")
	}
	if invitation.Email != userEmail {
		return fmt.Errorf("invitation was sent to a different email address")
	}

	now := time.Now()
	if err := s.db.Transaction(func(tx *gorm.DB) error {

		// Use ON CONFLICT DO NOTHING for atomic upsert (no separate check + create)
		if orgID := invitation.OrgID; orgID != nil && *orgID != "" {
			if err := tx.Clauses(clause.OnConflict{
				DoNothing: true,
			}).Create(&tables.TablePlatformOrgMember{
				OrgID:    *orgID,
				UserID:   userID,
				Role:     model.OrgRoleMember,
				JoinedAt: now,
			}).Error; err != nil {
				return fmt.Errorf("add org member: %w", err)
			}
		}

		if teamID := invitation.TeamID; teamID != nil && *teamID != "" {
			if err := tx.Clauses(clause.OnConflict{
				DoNothing: true,
			}).Create(&tables.TablePlatformTeamMember{
				TeamID:   *teamID,
				UserID:   userID,
				Role:     invitation.Role,
				JoinedAt: now,
			}).Error; err != nil {
				return fmt.Errorf("add team member: %w", err)
			}
		}

		// Mark invitation as accepted
		invitation.Accepted = true
		if err := tx.Save(&invitation).Error; err != nil {
			return fmt.Errorf("mark accepted: %w", err)
		}
		return nil
	}); err != nil {
		return fmt.Errorf("transaction failed: %w", err)
	}

	return nil
}

func (s *InvitationServiceImpl) sendInvitation(recipient, subject string, data model.InviteData) error {
	body, err := s.renderInviteTemplate(data)
	if err != nil {
		return err
	}
	if err := s.messageSender.Send(recipient, subject, body); err != nil {
		s.logger.Error("failed to send invite to %s, %s", recipient, err)
		return err
	}
	s.logger.Debug("send invite to %s, %s", recipient, body)
	return nil
}

func (s *InvitationServiceImpl) renderInviteTemplate(data model.InviteData) (string, error) {
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
        .greeting { font-size: 16px; margin-bottom: 16px; }
        .invite-card { background: white; border-radius: 8px; padding: 24px; margin: 24px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .invite-card h2 { margin: 0 0 8px 0; font-size: 20px; color: #333; }
        .invite-card .org { color: #667eea; font-size: 18px; margin-bottom: 16px; }
        .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { color: #888; font-size: 14px; }
        .detail-value { color: #333; font-size: 14px; font-weight: 500; }
        .cta-wrapper { text-align: center; margin: 28px 0; }
        .cta-button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 36px; border-radius: 8px; font-size: 16px; font-weight: 600; }
        .expiry-note { text-align: center; color: #888; font-size: 13px; margin-top: 16px; }
        .footer { text-align: center; color: #999; font-size: 12px; margin-top: 24px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Bifrost</h1>
        </div>
        <div class="content">
            <p class="greeting">You've been invited to join <strong>{{.OrgName}}</strong></p>
            {{if .TeamName}}
            <p class="greeting">as part of the <strong>{{.TeamName}}</strong> team</p>
            {{end}}
            <div class="invite-card">
                <h2>Invitation Details</h2>
                <div class="detail-row">
                    <span class="detail-label">Role</span>
                    <span class="detail-value">{{.Role}}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Invited by</span>
                    <span class="detail-value">{{.InviterName}}</span>
                </div>
            </div>
            <div class="cta-wrapper">
                <a href="{{.AcceptURL}}" class="cta-button">Accept Invitation</a>
            </div>
            <p class="expiry-note">This invitation will expire in {{.ExpiresIn}}.</p>
            <div class="footer">
                <p>If you didn't expect this invitation, please ignore this email.</p>
            </div>
        </div>
    </div>
</body>
</html>`

	t, err := template.New("invitation").Parse(tmpl)
	if err != nil {
		return "", err
	}

	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", err
	}

	return buf.String(), nil
}
