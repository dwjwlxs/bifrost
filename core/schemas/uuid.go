package schemas

import "github.com/google/uuid"

// NewID returns a new UUID v7 as a string.
// UUID v7 is time-ordered, making it more index-friendly than v4
// while still providing sufficient uniqueness for distributed systems.
func NewID() string {
	return uuid.Must(uuid.NewV7()).String()
}

// NewUUID returns a new UUID v7 as a uuid.UUID value.
// Use this when you need the raw UUID type rather than a string.
func NewUUID() uuid.UUID {
	return uuid.Must(uuid.NewV7())
}
