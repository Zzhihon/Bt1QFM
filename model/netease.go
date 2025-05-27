package model

import "time"

// NeteaseAlbum 网易云音乐专辑信息
type NeteaseAlbum struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	PicURL string `json:"picUrl"`
}

// NeteaseArtist 网易云音乐艺术家信息
type NeteaseArtist struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// NeteaseSong 网易云音乐歌曲信息
type NeteaseSong struct {
	ID        int64           `json:"id"`
	Name      string          `json:"name"`
	Artists   []NeteaseArtist `json:"artists"`
	Album     NeteaseAlbum    `json:"album"`
	Duration  int             `json:"duration"` // 时长（毫秒）
	URL       string          `json:"url"`      // 播放地址
	CoverURL  string          `json:"coverUrl"` // 封面图片地址
	CreatedAt time.Time       `json:"createdAt"`
}

// NeteaseSearchResult 搜索结果
type NeteaseSearchResult struct {
	Songs []NeteaseSong `json:"songs"`
	Total int           `json:"total"`
}

// NeteaseLyric 歌词信息
type NeteaseLyric struct {
	SongID     int64     `json:"songId"`
	Lyric      string    `json:"lyric"`      // 原歌词
	TransLyric string    `json:"transLyric"` // 翻译歌词
	CreatedAt  time.Time `json:"createdAt"`
}

// NeteasePlaylist 歌单信息
type NeteasePlaylist struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CoverURL    string    `json:"coverUrl"`
	TrackCount  int       `json:"trackCount"`
	PlayCount   int       `json:"playCount"`
	CreatedAt   time.Time `json:"createdAt"`
}

// NeteaseSongDB 用于数据库存储网易云音乐歌曲
// 字段与netease_song表对应
// 注意：与NeteaseSong区分，NeteaseSong用于API返回，NeteaseSongDB用于数据库
type NeteaseSongDB struct {
	ID              int64     `json:"id" db:"id"`
	Title           string    `json:"title" db:"title"`
	Artist          string    `json:"artist" db:"artist"`
	Album           string    `json:"album" db:"album"`
	FilePath        string    `json:"filePath" db:"file_path"`
	CoverArtPath    string    `json:"coverArtPath" db:"cover_art_path"`
	HLSPlaylistPath string    `json:"hlsPlaylistPath" db:"hls_playlist_path"`
	Duration        float64   `json:"duration" db:"duration"`
	CreatedAt       time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt       time.Time `json:"updatedAt" db:"updated_at"`
}
