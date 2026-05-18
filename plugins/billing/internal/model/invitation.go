package model

// InviteData holds data for invite email template.
type InviteData struct {
	InviterName string // Name of the person who sent the invite
	OrgName     string // Organization name
	TeamName    string // Team name (optional)
	Role        string // Role the invitee will have
	AcceptURL   string // URL to accept the invite
	ExpiresIn   string // When the invite expires
}
