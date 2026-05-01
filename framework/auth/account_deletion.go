package auth

import (
	"context"
	"fmt"
	"time"
)

// --- E4-S7: Account Deletion (Request → 30-day cool-down → Hard delete) ---

// DeleteAccount initiates account deletion.
// The user's password is verified to confirm identity.
// The account is soft-deleted (status=deleted, deleted_at set) with a 30-day cool-down.
// During the cool-down, the user can call UndoDeleteAccount to restore the account.
// After the cool-down, a scheduled cleanup job permanently removes the account.
func (s *service) DeleteAccount(ctx context.Context, userID string, req DeleteAccountRequest) error {
	if req.Password == "" {
		return ErrPasswordRequiredForDelete
	}

	user, err := s.store.UserRepo().GetByIDIncludingDeleted(ctx, userID)
	if err != nil {
		return ErrUserNotFound
	}

	switch user.Status {
	case UserStatusDeleted:
		return ErrAccountDeletionPending
	case UserStatusSuspended:
		return ErrUserSuspended
	}

	// Verify password to confirm identity (skip for OAuth-only accounts without password)
	if user.PasswordHash != "" {
		ok, err := s.hasher.Verify(req.Password, user.PasswordHash)
		if err != nil || !ok {
			return ErrInvalidCredentials
		}
	}

	// Perform soft delete
	now := time.Now()
	user.Status = UserStatusDeleted
	user.DeletedAt = &now
	user.UpdatedAt = now

	if err := s.store.UserRepo().Update(ctx, user); err != nil {
		return fmt.Errorf("auth: failed to soft-delete user: %w", err)
	}

	// Revoke all sessions — user is logged out everywhere
	_ = s.store.SessionRepo().DeleteByUserID(ctx, userID)

	return nil
}

// UndoDeleteAccount restores a soft-deleted account within the cool-down period.
// Returns ErrAccountDeletionExpired if the 30-day window has passed.
func (s *service) UndoDeleteAccount(ctx context.Context, userID string) error {
	user, err := s.store.UserRepo().GetByIDIncludingDeleted(ctx, userID)
	if err != nil {
		return ErrUserNotFound
	}

	if user.Status != UserStatusDeleted {
		return ErrAccountNotDeleted
	}

	// Check cool-down period
	if user.DeletedAt != nil && time.Since(*user.DeletedAt) > s.config.AccountDeletionCoolDown {
		return ErrAccountDeletionExpired
	}

	// Restore the account
	now := time.Now()
	user.Status = UserStatusActive
	user.DeletedAt = nil
	user.UpdatedAt = now

	if err := s.store.UserRepo().Update(ctx, user); err != nil {
		return fmt.Errorf("auth: failed to restore user account: %w", err)
	}

	return nil
}

// CleanupExpiredDeletions permanently removes all accounts whose soft-delete
// cool-down period has expired. This should be called by a scheduled job.
// Returns the number of permanently deleted accounts.
func (s *service) CleanupExpiredDeletions(ctx context.Context) (int64, error) {
	cutoff := time.Now().Add(-s.config.AccountDeletionCoolDown)

	// Get all soft-deleted users whose cool-down has expired
	users, err := s.store.UserRepo().GetSoftDeletedUsers(ctx, cutoff)
	if err != nil {
		return 0, fmt.Errorf("auth: failed to query soft-deleted users: %w", err)
	}

	var deleted int64
	for _, user := range users {
		// Hard delete: remove all related data first, then the user record
		_ = s.store.SessionRepo().DeleteByUserID(ctx, user.ID)
		_ = s.store.IdentityRepo().DeleteByUserID(ctx, user.ID)

		if err := s.store.UserRepo().HardDelete(ctx, user.ID); err != nil {
			// Log but continue — don't let one failure block others
			continue
		}
		deleted++
	}

	return deleted, nil
}
