package model

import "time"

// User represents a user in the system.
type User struct {
	ID           int64     `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"` // Not exposed in API responses
	Phone        string    `json:"phone,omitempty"`
	Preferences  string    `json:"preferences,omitempty"` // Could be JSON string or other format
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}
