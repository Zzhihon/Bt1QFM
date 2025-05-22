package model

import (
	"database/sql"
	"time"
)

// User represents a user in the system.
type User struct {
	ID           int64          `json:"id"`
	Username     string         `json:"username"`
	Email        string         `json:"email"`
	PasswordHash string         `json:"-"`                     // Not exposed in API responses
	Phone        sql.NullString `json:"phone,omitempty"`       // 支持NULL值
	Preferences  sql.NullString `json:"preferences,omitempty"` // 支持NULL值
	CreatedAt    time.Time      `json:"createdAt"`
	UpdatedAt    time.Time      `json:"updatedAt"`
}
