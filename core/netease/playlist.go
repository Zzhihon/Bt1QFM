package netease

import (
	"encoding/json"
	"fmt"

	"Bt1QFM/logger"
	"Bt1QFM/model"
)

// GetPlaylistDetail 获取歌单详情
func (c *Client) GetPlaylistDetail(playlistID string) (*model.NeteasePlaylist, error) {
	url := fmt.Sprintf("%s/playlist/detail?id=%s", c.BaseURL, playlistID)
	logger.Info("[GetPlaylistDetail] 获取歌单详情", logger.String("playlist_id", playlistID))
	resp, err := c.HTTPClient.Get(url)
	if err != nil {
		logger.Error("[GetPlaylistDetail] 请求失败", logger.String("playlist_id", playlistID), logger.ErrorField(err))
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Playlist model.NeteasePlaylist `json:"playlist"`
		Code     int                   `json:"code"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		logger.Error("[GetPlaylistDetail] 解析响应失败", logger.String("playlist_id", playlistID), logger.ErrorField(err))
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	logger.Info("[GetPlaylistDetail] 成功获取歌单详情", logger.String("playlist_id", playlistID), logger.String("name", result.Playlist.Name))
	return &result.Playlist, nil
}

// GetPlaylistTracks 获取歌单中的歌曲列表
func (c *Client) GetPlaylistTracks(playlistID string) ([]model.NeteaseSong, error) {
	url := fmt.Sprintf("%s/playlist/track/all?id=%s", c.BaseURL, playlistID)
	logger.Info("[GetPlaylistTracks] 获取歌单歌曲列表", logger.String("playlist_id", playlistID))
	resp, err := c.HTTPClient.Get(url)
	if err != nil {
		logger.Error("[GetPlaylistTracks] 请求失败", logger.String("playlist_id", playlistID), logger.ErrorField(err))
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Songs []model.NeteaseSong `json:"songs"`
		Code  int                 `json:"code"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		logger.Error("[GetPlaylistTracks] 解析响应失败", logger.String("playlist_id", playlistID), logger.ErrorField(err))
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	logger.Info("[GetPlaylistTracks] 成功获取歌单歌曲", logger.String("playlist_id", playlistID), logger.Int("songs_count", len(result.Songs)))
	return result.Songs, nil
}
