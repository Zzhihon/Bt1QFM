package model

import "time"

// Track represents an audio track in the music library.
type Track struct {
	ID              int64     `json:"id"`
	UserID          int64     `json:"userId"`
	Title           string    `json:"title"`
	Artist          string    `json:"artist"`
	Album           string    `json:"album"`
	FilePath        string    `json:"-"`               // Path to the original audio file, not exposed in API directly
	CoverArtPath    string    `json:"coverArtPath"`    // Relative path to cover art, served via static server
	HLSPlaylistPath string    `json:"hlsPlaylistPath"` // Relative path to HLS playlist, served via static server
	Duration        float32   `json:"duration"`        // Duration in seconds
	Status          string    `json:"status"`          // Track processing status: processing, completed, failed
	State           int8      `json:"state"`           // 0=soft deleted, 1=normal
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}
