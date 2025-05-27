package repository

import (
	"Bt1QFM/db"
	"Bt1QFM/model"
	"database/sql"
	"fmt"
	"strconv"
	"time"
)

type NeteaseSongRepository struct {
	DB *sql.DB
}

func NewNeteaseSongRepository() *NeteaseSongRepository {
	return &NeteaseSongRepository{DB: db.DB}
}

// InsertNeteaseSong 插入一条网易云歌曲记录
func (repo *NeteaseSongRepository) InsertNeteaseSong(song *model.NeteaseSongDB) (int64, error) {
	// 截断过长的URL，保留前500个字符
	if len(song.FilePath) > 500 {
		song.FilePath = song.FilePath[:500]
	}

	query := `INSERT INTO netease_song (id, title, artist, album, file_path, cover_art_path, hls_playlist_path, duration, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	now := time.Now()
	res, err := repo.DB.Exec(query,
		song.ID,
		song.Title,
		song.Artist,
		song.Album,
		song.FilePath,
		song.CoverArtPath,
		song.HLSPlaylistPath,
		song.Duration,
		now,
		now,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateNeteaseSongHLS 更新netease_song表中的hls_playlist_path字段
func (repo *NeteaseSongRepository) UpdateNeteaseSongHLS(songID string, hlsPath string) error {
	query := `UPDATE netease_song SET hls_playlist_path = ? WHERE id = ?`
	_, err := repo.DB.Exec(query, hlsPath, songID)
	return err
}

// GetNeteaseSongByID 根据ID获取网易云歌曲信息
func (repo *NeteaseSongRepository) GetNeteaseSongByID(songID string) (*model.NeteaseSongDB, error) {
	// 将字符串ID转换为int64
	id, err := strconv.ParseInt(songID, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid song ID: %w", err)
	}

	query := `SELECT id, title, artist, album, file_path, cover_art_path, hls_playlist_path, duration, created_at, updated_at 
		FROM netease_song WHERE id = ?`

	var song model.NeteaseSongDB
	err = repo.DB.QueryRow(query, id).Scan(
		&song.ID,
		&song.Title,
		&song.Artist,
		&song.Album,
		&song.FilePath,
		&song.CoverArtPath,
		&song.HLSPlaylistPath,
		&song.Duration,
		&song.CreatedAt,
		&song.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &song, nil
}

// UpdateNeteaseSong 更新网易云歌曲信息
func (repo *NeteaseSongRepository) UpdateNeteaseSong(song *model.NeteaseSongDB) (bool, error) {
	// 截断过长的URL，保留前500个字符
	if len(song.FilePath) > 500 {
		song.FilePath = song.FilePath[:500]
	}

	query := `UPDATE netease_song 
		SET title = ?, artist = ?, album = ?, file_path = ?, 
			cover_art_path = ?, hls_playlist_path = ?, duration = ?, updated_at = ?
		WHERE id = ?`

	now := time.Now()
	result, err := repo.DB.Exec(query,
		song.Title,
		song.Artist,
		song.Album,
		song.FilePath,
		song.CoverArtPath,
		song.HLSPlaylistPath,
		song.Duration,
		now,
		song.ID,
	)
	if err != nil {
		return false, err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}

	return rowsAffected > 0, nil
}
