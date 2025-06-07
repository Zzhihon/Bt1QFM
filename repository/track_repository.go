package repository

import (
	"database/sql"
	"fmt"
	"time"

	"Bt1QFM/db"
	"Bt1QFM/logger"
	"Bt1QFM/model"
)

// TrackRepository defines the interface for track data operations.
type TrackRepository interface {
	CreateTrack(track *model.Track) (int64, error)
	GetTrackByID(id int64) (*model.Track, error)
	GetAllTracksByUserID(userID int64) ([]*model.Track, error)
	UpdateTrackHLSPath(trackID int64, hlsPath string, duration float32) error
	UpdateTrackCoverArtPath(trackID int64, coverPath string) error
	GetTrackByUserIDAndFilePath(userID int64, filePath string) (*model.Track, error)
	BeginTx() (*sql.Tx, error)
	RollbackTx(tx *sql.Tx)
	CommitTx(tx *sql.Tx) error
	CreateTrackWithTx(tx *sql.Tx, track *model.Track) (int64, error)
	DeleteTrackWithTx(tx *sql.Tx, trackID int64) error
	UpdateTrackStatus(trackID int64, status string) error
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
	query := `INSERT INTO tracks (title, artist, album, cover_art_path, hls_playlist_path, duration, user_id, created_at, updated_at)
	           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	stmt, err := r.DB.Prepare(query)
	if err != nil {
		return 0, fmt.Errorf("failed to prepare statement for CreateTrack: %w", err)
	}
	defer stmt.Close()

	now := time.Now()
	res, err := stmt.Exec(track.Title, track.Artist, track.Album, track.CoverArtPath, track.HLSPlaylistPath, track.Duration, track.UserID, now, now)
	if err != nil {
		return 0, fmt.Errorf("failed to execute CreateTrack: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("failed to get last insert ID for CreateTrack: %w", err)
	}
	logger.Info("Track created", logger.Int64("trackId", id), logger.String("title", track.Title))
	return id, nil
}

// GetTrackByID retrieves a track by its ID.
func (r *mysqlTrackRepository) GetTrackByID(id int64) (*model.Track, error) {
	query := `SELECT id, user_id, title, artist, album, cover_art_path, hls_playlist_path, duration, created_at, updated_at 
	           FROM tracks WHERE id = ?`
	row := r.DB.QueryRow(query, id)

	track := &model.Track{}
	err := row.Scan(&track.ID, &track.UserID, &track.Title, &track.Artist, &track.Album, &track.CoverArtPath, &track.HLSPlaylistPath, &track.Duration, &track.CreatedAt, &track.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // Track not found
		}
		return nil, fmt.Errorf("failed to scan track by ID %d: %w", id, err)
	}
	return track, nil
}

// GetAllTracks retrieves all tracks from the database.
func (r *mysqlTrackRepository) GetAllTracksByUserID(userID int64) ([]*model.Track, error) {
	query := `SELECT id, user_id, title, artist, album, cover_art_path, hls_playlist_path, duration, created_at, updated_at 
	           FROM tracks WHERE user_id = ? ORDER BY created_at DESC`
	rows, err := r.DB.Query(query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query tracks for user ID %d: %w", userID, err)
	}
	defer rows.Close()

	tracks := make([]*model.Track, 0)
	for rows.Next() {
		track := &model.Track{}
		err := rows.Scan(&track.ID, &track.UserID, &track.Title, &track.Artist, &track.Album, &track.CoverArtPath, &track.HLSPlaylistPath, &track.Duration, &track.CreatedAt, &track.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan track in GetAllTracksByUserID: %w", err)
		}
		tracks = append(tracks, track)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error during rows iteration in GetAllTracksByUserID: %w", err)
	}

	return tracks, nil
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
	logger.Info("HLS path updated", logger.Int64("trackId", trackID), logger.String("path", hlsPath))
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
	logger.Info("Cover art path updated", logger.Int64("trackId", trackID), logger.String("path", coverPath))
	return nil
}

// GetTrackByFilePath retrieves a track by its file path to check for existence.
func (r *mysqlTrackRepository) GetTrackByUserIDAndFilePath(userID int64, filePath string) (*model.Track, error) {
	// 由于file_path字段已被移除，这个方法需要重新实现
	// 暂时返回nil表示未找到
	return nil, nil
}

// BeginTx 开始一个新的事务
func (r *mysqlTrackRepository) BeginTx() (*sql.Tx, error) {
	return r.DB.Begin()
}

// RollbackTx 回滚事务
func (r *mysqlTrackRepository) RollbackTx(tx *sql.Tx) {
	if tx != nil {
		tx.Rollback()
	}
}

// CommitTx 提交事务
func (r *mysqlTrackRepository) CommitTx(tx *sql.Tx) error {
	return tx.Commit()
}

// CreateTrackWithTx 在事务中创建新曲目
func (r *mysqlTrackRepository) CreateTrackWithTx(tx *sql.Tx, track *model.Track) (int64, error) {
	query := `INSERT INTO tracks (title, artist, album, cover_art_path, hls_playlist_path, duration, user_id, created_at, updated_at)
	           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	stmt, err := tx.Prepare(query)
	if err != nil {
		return 0, fmt.Errorf("failed to prepare statement for CreateTrackWithTx: %w", err)
	}
	defer stmt.Close()

	now := time.Now()
	res, err := stmt.Exec(track.Title, track.Artist, track.Album, track.CoverArtPath, track.HLSPlaylistPath, track.Duration, track.UserID, now, now)
	if err != nil {
		return 0, fmt.Errorf("failed to execute CreateTrackWithTx: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("failed to get last insert ID for CreateTrackWithTx: %w", err)
	}
	logger.Info("Track created with transaction", logger.Int64("trackId", id), logger.String("title", track.Title))
	return id, nil
}

// DeleteTrackWithTx 在事务中删除曲目
func (r *mysqlTrackRepository) DeleteTrackWithTx(tx *sql.Tx, trackID int64) error {
	query := `DELETE FROM tracks WHERE id = ?`
	stmt, err := tx.Prepare(query)
	if err != nil {
		return fmt.Errorf("failed to prepare statement for DeleteTrackWithTx: %w", err)
	}
	defer stmt.Close()

	_, err = stmt.Exec(trackID)
	if err != nil {
		return fmt.Errorf("failed to execute DeleteTrackWithTx: %w", err)
	}
	return nil
}

// UpdateTrackStatus updates the processing status for a given track ID.
func (r *mysqlTrackRepository) UpdateTrackStatus(trackID int64, status string) error {
	query := `UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?`
	stmt, err := r.DB.Prepare(query)
	if err != nil {
		return fmt.Errorf("failed to prepare statement for UpdateTrackStatus: %w", err)
	}
	defer stmt.Close()

	_, err = stmt.Exec(status, time.Now(), trackID)
	if err != nil {
		return fmt.Errorf("failed to execute UpdateTrackStatus for track ID %d: %w", trackID, err)
	}
	logger.Info("Track status updated", logger.Int64("trackId", trackID), logger.String("status", status))
	return nil
}
