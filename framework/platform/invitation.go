package platform

import (
	"bytes"
	"fmt"
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

	// Send invitation email asynchronously — failures are non-fatal
	if s.messageSender != nil && s.platformURL != "" {
		acceptURL := fmt.Sprintf("%s/invitation/%s", s.platformURL, token)
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
