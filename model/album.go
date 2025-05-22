package model

import (
	"database/sql"
	"time"
)

// Album 表示一张专辑
type Album struct {
	ID          int64          `json:"id"`
	UserID      int64          `json:"userId"`
	Artist      string         `json:"artist"`
	Name        string         `json:"name"`
	CoverPath   string         `json:"coverPath"`
	ReleaseTime time.Time      `json:"releaseTime"`
	Genre       string         `json:"genre"`
	Description sql.NullString `json:"description"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
}

// AlbumTrack 表示专辑中的一首歌曲
type AlbumTrack struct {
	ID        int64     `json:"id"`
	AlbumID   int64     `json:"albumId"`
	TrackID   int64     `json:"trackId"`
	Position  int       `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// AlbumWithTracks 包含专辑信息和其包含的歌曲
type AlbumWithTracks struct {
	Album  Album    `json:"album"`
	Tracks []*Track `json:"tracks"`
}
