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
