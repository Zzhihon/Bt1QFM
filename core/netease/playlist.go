package netease

import (
	"encoding/json"
	"fmt"

	"Bt1QFM/model"
)

// GetPlaylistDetail 获取歌单详情
func (c *Client) GetPlaylistDetail(playlistID string) (*model.NeteasePlaylist, error) {
	url := fmt.Sprintf("%s/playlist/detail?id=%s", c.baseURL, playlistID)
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Playlist model.NeteasePlaylist `json:"playlist"`
		Code     int                   `json:"code"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	return &result.Playlist, nil
}

// GetPlaylistTracks 获取歌单中的歌曲列表
func (c *Client) GetPlaylistTracks(playlistID string) ([]model.NeteaseSong, error) {
	url := fmt.Sprintf("%s/playlist/track/all?id=%s", c.baseURL, playlistID)
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Songs []model.NeteaseSong `json:"songs"`
		Code  int                 `json:"code"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	return result.Songs, nil
}
