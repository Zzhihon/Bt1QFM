package repository

import (
	"context"
	"database/sql"
	"time"

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
		return 0, err
	}

	return result.LastInsertId()
}

// GetAlbumByID 根据ID获取专辑信息
func (r *MySQLAlbumRepository) GetAlbumByID(ctx context.Context, id int64) (*model.Album, error) {
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
			return nil, nil
		}
		return nil, err
	}

	return album, nil
}

// GetAlbumsByUserID 获取用户的所有专辑
func (r *MySQLAlbumRepository) GetAlbumsByUserID(ctx context.Context, userID int64) ([]*model.Album, error) {
	query := `
		SELECT id, user_id, artist, name, cover_path, release_time, genre, description, created_at, updated_at
		FROM albums
		WHERE user_id = ?
		ORDER BY created_at DESC
	`

	rows, err := r.db.QueryContext(ctx, query, userID)
	if err != nil {
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
			return nil, err
		}
		albums = append(albums, album)
	}

	return albums, nil
}

// UpdateAlbum 更新专辑信息
func (r *MySQLAlbumRepository) UpdateAlbum(ctx context.Context, album *model.Album) error {
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
	return err
}

// DeleteAlbum 删除专辑
func (r *MySQLAlbumRepository) DeleteAlbum(ctx context.Context, id int64) error {
	query := `DELETE FROM albums WHERE id = ?`
	_, err := r.db.ExecContext(ctx, query, id)
	return err
}

// AddTrackToAlbum 添加歌曲到专辑
func (r *MySQLAlbumRepository) AddTrackToAlbum(ctx context.Context, albumID, trackID int64, position int) error {
	query := `
		INSERT INTO album_tracks (album_id, track_id, position, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
	`

	now := time.Now()
	_, err := r.db.ExecContext(ctx, query, albumID, trackID, position, now, now)
	return err
}

// RemoveTrackFromAlbum 从专辑中移除歌曲
func (r *MySQLAlbumRepository) RemoveTrackFromAlbum(ctx context.Context, albumID, trackID int64) error {
	query := `DELETE FROM album_tracks WHERE album_id = ? AND track_id = ?`
	_, err := r.db.ExecContext(ctx, query, albumID, trackID)
	return err
}

// GetAlbumTracks 获取专辑中的所有歌曲
func (r *MySQLAlbumRepository) GetAlbumTracks(ctx context.Context, albumID int64) ([]*model.Track, error) {
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
			return nil, err
		}
		tracks = append(tracks, track)
	}

	return tracks, nil
}

// UpdateTrackPosition 更新专辑中歌曲的位置
func (r *MySQLAlbumRepository) UpdateTrackPosition(ctx context.Context, albumID, trackID int64, newPosition int) error {
	query := `
		UPDATE album_tracks
		SET position = ?, updated_at = ?
		WHERE album_id = ? AND track_id = ?
	`

	_, err := r.db.ExecContext(ctx, query, newPosition, time.Now(), albumID, trackID)
	return err
}
