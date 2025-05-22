package repository

import (
	"context"
	"database/sql"
	"time"

	"Bt1QFM/logger"
	"Bt1QFM/model"
)

// AlbumRepository 定义专辑相关的数据库操作接口
type AlbumRepository interface {
	// CreateAlbum 创建新专辑
	CreateAlbum(ctx context.Context, album *model.Album) (int64, error)

	// GetAlbumByID 根据ID获取专辑信息
	GetAlbumByID(ctx context.Context, id int64) (*model.Album, error)

	// GetAlbumsByUserID 获取用户的所有专辑
	GetAlbumsByUserID(ctx context.Context, userID int64) ([]*model.Album, error)

	// UpdateAlbum 更新专辑信息
	UpdateAlbum(ctx context.Context, album *model.Album) error

	// DeleteAlbum 删除专辑
	DeleteAlbum(ctx context.Context, id int64) error

	// AddTrackToAlbum 添加歌曲到专辑
	AddTrackToAlbum(ctx context.Context, albumID, trackID int64, position int) error

	// RemoveTrackFromAlbum 从专辑中移除歌曲
	RemoveTrackFromAlbum(ctx context.Context, albumID, trackID int64) error

	// GetAlbumTracks 获取专辑中的所有歌曲
	GetAlbumTracks(ctx context.Context, albumID int64) ([]*model.Track, error)

	// UpdateTrackPosition 更新专辑中歌曲的位置
	UpdateTrackPosition(ctx context.Context, albumID, trackID int64, newPosition int) error
}

// MySQLAlbumRepository MySQL实现的专辑仓库
type MySQLAlbumRepository struct {
	db *sql.DB
}

// NewMySQLAlbumRepository 创建新的MySQL专辑仓库实例
func NewMySQLAlbumRepository(db *sql.DB) *MySQLAlbumRepository {
	return &MySQLAlbumRepository{db: db}
}

// CreateAlbum 创建新专辑
func (r *MySQLAlbumRepository) CreateAlbum(ctx context.Context, album *model.Album) (int64, error) {
	logger.Debug("Creating new album",
		logger.String("artist", album.Artist),
		logger.String("name", album.Name),
		logger.Int64("userId", album.UserID),
	)

	query := `
		INSERT INTO albums (user_id, artist, name, cover_path, release_time, genre, description, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	now := time.Now()
	result, err := r.db.ExecContext(ctx, query,
		album.UserID,
		album.Artist,
		album.Name,
		album.CoverPath,
		album.ReleaseTime,
		album.Genre,
		album.Description,
		now,
		now,
	)
	if err != nil {
		logger.Error("Failed to create album",
			logger.String("artist", album.Artist),
			logger.String("name", album.Name),
			logger.ErrorField(err),
		)
		return 0, err
	}

	id, err := result.LastInsertId()
	if err != nil {
		logger.Error("Failed to get last insert ID",
			logger.String("artist", album.Artist),
			logger.String("name", album.Name),
			logger.ErrorField(err),
		)
		return 0, err
	}

	logger.Info("Album created successfully",
		logger.Int64("albumId", id),
		logger.String("artist", album.Artist),
		logger.String("name", album.Name),
	)
	return id, nil
}

// GetAlbumByID 根据ID获取专辑信息
func (r *MySQLAlbumRepository) GetAlbumByID(ctx context.Context, id int64) (*model.Album, error) {
	logger.Debug("Getting album by ID", logger.Int64("albumId", id))

	query := `
		SELECT id, user_id, artist, name, cover_path, release_time, genre, description, created_at, updated_at
		FROM albums
		WHERE id = ?
	`

	album := &model.Album{}
	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&album.ID,
		&album.UserID,
		&album.Artist,
		&album.Name,
		&album.CoverPath,
		&album.ReleaseTime,
		&album.Genre,
		&album.Description,
		&album.CreatedAt,
		&album.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			logger.Warn("Album not found", logger.Int64("albumId", id))
			return nil, nil
		}
		logger.Error("Failed to get album",
			logger.Int64("albumId", id),
			logger.ErrorField(err),
		)
		return nil, err
	}

	logger.Debug("Album retrieved successfully",
		logger.Int64("albumId", id),
		logger.String("artist", album.Artist),
		logger.String("name", album.Name),
	)
	return album, nil
}

// GetAlbumsByUserID 获取用户的所有专辑
func (r *MySQLAlbumRepository) GetAlbumsByUserID(ctx context.Context, userID int64) ([]*model.Album, error) {
	logger.Debug("Getting albums by user ID", logger.Int64("userId", userID))

	query := `
		SELECT id, user_id, artist, name, cover_path, release_time, genre, description, created_at, updated_at
		FROM albums
		WHERE user_id = ?
		ORDER BY created_at DESC
	`

	rows, err := r.db.QueryContext(ctx, query, userID)
	if err != nil {
		logger.Error("Failed to query albums",
			logger.Int64("userId", userID),
			logger.ErrorField(err),
		)
		return nil, err
	}
	defer rows.Close()

	var albums []*model.Album
	for rows.Next() {
		album := &model.Album{}
		err := rows.Scan(
			&album.ID,
			&album.UserID,
			&album.Artist,
			&album.Name,
			&album.CoverPath,
			&album.ReleaseTime,
			&album.Genre,
			&album.Description,
			&album.CreatedAt,
			&album.UpdatedAt,
		)
		if err != nil {
			logger.Error("Failed to scan album row",
				logger.Int64("userId", userID),
				logger.ErrorField(err),
			)
			return nil, err
		}
		albums = append(albums, album)
	}

	logger.Info("Retrieved albums successfully",
		logger.Int64("userId", userID),
		logger.Int("count", len(albums)),
	)
	return albums, nil
}

// UpdateAlbum 更新专辑信息
func (r *MySQLAlbumRepository) UpdateAlbum(ctx context.Context, album *model.Album) error {
	logger.Debug("Updating album",
		logger.Int64("albumId", album.ID),
		logger.String("artist", album.Artist),
		logger.String("name", album.Name),
	)

	query := `
		UPDATE albums
		SET artist = ?, name = ?, cover_path = ?, release_time = ?, genre = ?, description = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`

	_, err := r.db.ExecContext(ctx, query,
		album.Artist,
		album.Name,
		album.CoverPath,
		album.ReleaseTime,
		album.Genre,
		album.Description,
		time.Now(),
		album.ID,
		album.UserID,
	)
	if err != nil {
		logger.Error("Failed to update album",
			logger.Int64("albumId", album.ID),
			logger.String("artist", album.Artist),
			logger.String("name", album.Name),
			logger.ErrorField(err),
		)
		return err
	}

	logger.Info("Album updated successfully",
		logger.Int64("albumId", album.ID),
		logger.String("artist", album.Artist),
		logger.String("name", album.Name),
	)
	return nil
}

// DeleteAlbum 删除专辑
func (r *MySQLAlbumRepository) DeleteAlbum(ctx context.Context, id int64) error {
	logger.Debug("Deleting album", logger.Int64("albumId", id))

	query := `DELETE FROM albums WHERE id = ?`
	_, err := r.db.ExecContext(ctx, query, id)
	if err != nil {
		logger.Error("Failed to delete album",
			logger.Int64("albumId", id),
			logger.ErrorField(err),
		)
		return err
	}

	logger.Info("Album deleted successfully", logger.Int64("albumId", id))
	return nil
}

// AddTrackToAlbum 添加歌曲到专辑
func (r *MySQLAlbumRepository) AddTrackToAlbum(ctx context.Context, albumID, trackID int64, position int) error {
	logger.Debug("Adding track to album",
		logger.Int64("albumId", albumID),
		logger.Int64("trackId", trackID),
		logger.Int("position", position),
	)

	query := `
		INSERT INTO album_tracks (album_id, track_id, position, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
	`

	now := time.Now()
	_, err := r.db.ExecContext(ctx, query, albumID, trackID, position, now, now)
	if err != nil {
		logger.Error("Failed to add track to album",
			logger.Int64("albumId", albumID),
			logger.Int64("trackId", trackID),
			logger.ErrorField(err),
		)
		return err
	}

	logger.Info("Track added to album successfully",
		logger.Int64("albumId", albumID),
		logger.Int64("trackId", trackID),
		logger.Int("position", position),
	)
	return nil
}

// RemoveTrackFromAlbum 从专辑中移除歌曲
func (r *MySQLAlbumRepository) RemoveTrackFromAlbum(ctx context.Context, albumID, trackID int64) error {
	logger.Debug("Removing track from album",
		logger.Int64("albumId", albumID),
		logger.Int64("trackId", trackID),
	)

	query := `DELETE FROM album_tracks WHERE album_id = ? AND track_id = ?`
	_, err := r.db.ExecContext(ctx, query, albumID, trackID)
	if err != nil {
		logger.Error("Failed to remove track from album",
			logger.Int64("albumId", albumID),
			logger.Int64("trackId", trackID),
			logger.ErrorField(err),
		)
		return err
	}

	logger.Info("Track removed from album successfully",
		logger.Int64("albumId", albumID),
		logger.Int64("trackId", trackID),
	)
	return nil
}

// GetAlbumTracks 获取专辑中的所有歌曲
func (r *MySQLAlbumRepository) GetAlbumTracks(ctx context.Context, albumID int64) ([]*model.Track, error) {
	logger.Debug("Getting album tracks", logger.Int64("albumId", albumID))

	query := `
		SELECT t.id, t.user_id, t.title, t.artist, t.album, t.file_path, t.cover_art_path, 
			   t.hls_playlist_path, t.duration, t.created_at, t.updated_at
		FROM tracks t
		JOIN album_tracks at ON t.id = at.track_id
		WHERE at.album_id = ?
		ORDER BY at.position
	`

	rows, err := r.db.QueryContext(ctx, query, albumID)
	if err != nil {
		logger.Error("Failed to query album tracks",
			logger.Int64("albumId", albumID),
			logger.ErrorField(err),
		)
		return nil, err
	}
	defer rows.Close()

	var tracks []*model.Track
	for rows.Next() {
		track := &model.Track{}
		err := rows.Scan(
			&track.ID,
			&track.UserID,
			&track.Title,
			&track.Artist,
			&track.Album,
			&track.FilePath,
			&track.CoverArtPath,
			&track.HLSPlaylistPath,
			&track.Duration,
			&track.CreatedAt,
			&track.UpdatedAt,
		)
		if err != nil {
			logger.Error("Failed to scan track row",
				logger.Int64("albumId", albumID),
				logger.ErrorField(err),
			)
			return nil, err
		}
		tracks = append(tracks, track)
	}

	logger.Info("Retrieved album tracks successfully",
		logger.Int64("albumId", albumID),
		logger.Int("count", len(tracks)),
	)
	return tracks, nil
}

// UpdateTrackPosition 更新专辑中歌曲的位置
func (r *MySQLAlbumRepository) UpdateTrackPosition(ctx context.Context, albumID, trackID int64, newPosition int) error {
	logger.Debug("Updating track position",
		logger.Int64("albumId", albumID),
		logger.Int64("trackId", trackID),
		logger.Int("newPosition", newPosition),
	)

	query := `
		UPDATE album_tracks
		SET position = ?, updated_at = ?
		WHERE album_id = ? AND track_id = ?
	`

	_, err := r.db.ExecContext(ctx, query, newPosition, time.Now(), albumID, trackID)
	if err != nil {
		logger.Error("Failed to update track position",
			logger.Int64("albumId", albumID),
			logger.Int64("trackId", trackID),
			logger.ErrorField(err),
		)
		return err
	}

	logger.Info("Track position updated successfully",
		logger.Int64("albumId", albumID),
		logger.Int64("trackId", trackID),
		logger.Int("newPosition", newPosition),
	)
	return nil
}
