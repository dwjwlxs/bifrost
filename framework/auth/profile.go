package auth

import (
	"context"
	"fmt"
	"time"
)

// --- GetProfile ---

func (s *service) GetProfile(ctx context.Context, userID string) (*User, error) {
	user, err := s.store.UserRepo().GetByID(ctx, userID)
	if err != nil {
		return nil, ErrUserNotFound
	}
	return user, nil
}

// --- UpdateProfile ---

func (s *service) UpdateProfile(ctx context.Context, userID string, req UpdateProfileRequest) (*User, error) {
	user, err := s.store.UserRepo().GetByID(ctx, userID)
	if err != nil {
		return nil, ErrUserNotFound
	}

	// Check account status
	if user.Status == UserStatusSuspended {
		return nil, ErrUserSuspended
	}
	if user.Status == UserStatusDeleted {
		return nil, ErrUserDeleted
	}

	now := time.Now()

	// Update display name if provided
	if req.DisplayName != nil {
		user.DisplayName = *req.DisplayName
	}

	// Update phone if provided
	if req.Phone != nil {
		user.Phone = *req.Phone
	}

	user.UpdatedAt = now

	if err := s.store.UserRepo().Update(ctx, user); err != nil {
		return nil, fmt.Errorf("auth: failed to update profile: %w", err)
	}

	return user, nil
}
