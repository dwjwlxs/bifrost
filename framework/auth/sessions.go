package auth

import (
	"context"
	"time"
)

// --- ListSessions ---

func (s *service) ListSessions(ctx context.Context, userID string) ([]*SessionInfo, error) {
	sessions, err := s.store.SessionRepo().GetByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	result := make([]*SessionInfo, 0, len(sessions))
	for _, sess := range sessions {
		// Skip expired sessions
		if now.After(sess.ExpiresAt) {
			continue
		}
		result = append(result, &SessionInfo{
			ID:         sess.ID,
			DeviceInfo: sess.DeviceInfo,
			IPAddress:  sess.IPAddress,
			ExpiresAt:  sess.ExpiresAt,
			CreatedAt:  sess.CreatedAt,
		})
	}

	return result, nil
}

// --- RevokeSession ---

func (s *service) RevokeSession(ctx context.Context, userID string, sessionID string) error {
	session, err := s.store.SessionRepo().GetByID(ctx, sessionID)
	if err != nil || session == nil {
		return ErrSessionNotFound
	}

	// Verify ownership
	if session.UserID != userID {
		return ErrNotSessionOwner
	}

	return s.store.SessionRepo().Delete(ctx, sessionID)
}
