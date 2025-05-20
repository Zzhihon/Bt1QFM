package repository

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	"Bt1QFM/internal/db"
	"Bt1QFM/internal/model"
)

// TrackRepository defines the interface for track data operations.
type TrackRepository interface {
	CreateTrack(track *model.Track) (int64, error)
	GetTrackByID(id int64) (*model.Track, error)
	GetAllTracks() ([]*model.Track, error)
	UpdateTrackHLSPath(trackID int64, hlsPath string, duration float32) error
	UpdateTrackCoverArtPath(trackID int64, coverPath string) error
	GetTrackByFilePath(filePath string) (*model.Track, error)
}

// mysqlTrackRepository implements TrackRepository for MySQL.
type mysqlTrackRepository struct {
	DB *sql.DB
}

// NewMySQLTrackRepository creates a new instance of mysqlTrackRepository.
func NewMySQLTrackRepository() TrackRepository {
	return &mysqlTrackRepository{DB: db.DB}
}

// CreateTrack adds a new track to the database.
func (r *mysqlTrackRepository) CreateTrack(track *model.Track) (int64, error) {
	query := `INSERT INTO tracks (title, artist, album, file_path, cover_art_path, hls_playlist_path, duration, created_at, updated_at)
	           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	stmt, err := r.DB.Prepare(query)
	if err != nil {
		return 0, fmt.Errorf("failed to prepare statement for CreateTrack: %w", err)
	}
	defer stmt.Close()

	now := time.Now()
	res, err := stmt.Exec(track.Title, track.Artist, track.Album, track.FilePath, track.CoverArtPath, track.HLSPlaylistPath, track.Duration, now, now)
	if err != nil {
		return 0, fmt.Errorf("failed to execute CreateTrack: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("failed to get last insert ID for CreateTrack: %w", err)
	}
	log.Printf("Track created with ID: %d, Title: %s", id, track.Title)
	return id, nil
}

// GetTrackByID retrieves a track by its ID.
func (r *mysqlTrackRepository) GetTrackByID(id int64) (*model.Track, error) {
	query := `SELECT id, title, artist, album, file_path, cover_art_path, hls_playlist_path, duration, created_at, updated_at 
	           FROM tracks WHERE id = ?`
	row := r.DB.QueryRow(query, id)

	track := &model.Track{}
	err := row.Scan(&track.ID, &track.Title, &track.Artist, &track.Album, &track.FilePath, &track.CoverArtPath, &track.HLSPlaylistPath, &track.Duration, &track.CreatedAt, &track.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // Track not found
		}
		return nil, fmt.Errorf("failed to scan track by ID %d: %w", id, err)
	}
	return track, nil
}

// GetAllTracks retrieves all tracks from the database.
func (r *mysqlTrackRepository) GetAllTracks() ([]*model.Track, error) {
	query := `SELECT id, title, artist, album, file_path, cover_art_path, hls_playlist_path, duration, created_at, updated_at 
	           FROM tracks ORDER BY created_at DESC`
	rows, err := r.DB.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query all tracks: %w", err)
	}
	defer rows.Close()

	tracks := make([]*model.Track, 0) // Initialize as an empty slice
	for rows.Next() {
		track := &model.Track{}
		err := rows.Scan(&track.ID, &track.Title, &track.Artist, &track.Album, &track.FilePath, &track.CoverArtPath, &track.HLSPlaylistPath, &track.Duration, &track.CreatedAt, &track.UpdatedAt)
		if err != nil {
			// Return nil for tracks in case of a scan error to indicate partial/failure
			return nil, fmt.Errorf("failed to scan track in GetAllTracks: %w", err)
		}
		tracks = append(tracks, track)
	}

	if err = rows.Err(); err != nil {
		// Return nil for tracks in case of row iteration error
		return nil, fmt.Errorf("error during rows iteration in GetAllTracks: %w", err)
	}

	return tracks, nil // Will be an empty slice if no rows, or populated slice
}

// UpdateTrackHLSPath updates the HLS playlist path and duration for a given track ID.
func (r *mysqlTrackRepository) UpdateTrackHLSPath(trackID int64, hlsPath string, duration float32) error {
	query := `UPDATE tracks SET hls_playlist_path = ?, duration = ?, updated_at = ? WHERE id = ?`
	stmt, err := r.DB.Prepare(query)
	if err != nil {
		return fmt.Errorf("failed to prepare statement for UpdateTrackHLSPath: %w", err)
	}
	defer stmt.Close()

	_, err = stmt.Exec(hlsPath, duration, time.Now(), trackID)
	if err != nil {
		return fmt.Errorf("failed to execute UpdateTrackHLSPath for track ID %d: %w", trackID, err)
	}
	log.Printf("HLS path updated for track ID: %d to %s", trackID, hlsPath)
	return nil
}

// UpdateTrackCoverArtPath updates the cover art path for a given track ID.
func (r *mysqlTrackRepository) UpdateTrackCoverArtPath(trackID int64, coverPath string) error {
	query := `UPDATE tracks SET cover_art_path = ?, updated_at = ? WHERE id = ?`
	stmt, err := r.DB.Prepare(query)
	if err != nil {
		return fmt.Errorf("failed to prepare statement for UpdateTrackCoverArtPath: %w", err)
	}
	defer stmt.Close()

	_, err = stmt.Exec(coverPath, time.Now(), trackID)
	if err != nil {
		return fmt.Errorf("failed to execute UpdateTrackCoverArtPath for track ID %d: %w", trackID, err)
	}
	log.Printf("Cover art path updated for track ID: %d to %s", trackID, coverPath)
	return nil
}

// GetTrackByFilePath retrieves a track by its file path to check for existence.
func (r *mysqlTrackRepository) GetTrackByFilePath(filePath string) (*model.Track, error) {
	query := `SELECT id, title, artist, album, file_path, cover_art_path, hls_playlist_path, duration, created_at, updated_at 
	           FROM tracks WHERE file_path = ?`
	row := r.DB.QueryRow(query, filePath)

	track := &model.Track{}
	err := row.Scan(&track.ID, &track.Title, &track.Artist, &track.Album, &track.FilePath, &track.CoverArtPath, &track.HLSPlaylistPath, &track.Duration, &track.CreatedAt, &track.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // Track not found
		}
		return nil, fmt.Errorf("failed to scan track by file_path %s: %w", filePath, err)
	}
	return track, nil
}
