package netease

import (
	"encoding/json"
	"fmt"
	"log"

	"Bt1QFM/model"
)

// GetPlaylistDetail 获取歌单详情
func (c *Client) GetPlaylistDetail(playlistID string) (*model.NeteasePlaylist, error) {
	url := fmt.Sprintf("%s/playlist/detail?id=%s", c.BaseURL, playlistID)
	log.Printf("[playlist/GetPlaylistDetail] 获取歌单详情 (ID: %s)", playlistID)
	resp, err := c.HTTPClient.Get(url)
	if err != nil {
		log.Printf("[playlist/GetPlaylistDetail] 请求失败 (ID: %s): %v", playlistID, err)
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Playlist model.NeteasePlaylist `json:"playlist"`
		Code     int                   `json:"code"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[playlist/GetPlaylistDetail] 解析响应失败 (ID: %s): %v", playlistID, err)
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	log.Printf("[playlist/GetPlaylistDetail] 成功获取歌单详情 (ID: %s, 名称: %s)", playlistID, result.Playlist.Name)
	return &result.Playlist, nil
}

// GetPlaylistTracks 获取歌单中的歌曲列表
func (c *Client) GetPlaylistTracks(playlistID string) ([]model.NeteaseSong, error) {
	url := fmt.Sprintf("%s/playlist/track/all?id=%s", c.BaseURL, playlistID)
	log.Printf("[playlist/GetPlaylistTracks] 获取歌单歌曲列表 (ID: %s)", playlistID)
	resp, err := c.HTTPClient.Get(url)
	if err != nil {
		log.Printf("[playlist/GetPlaylistTracks] 请求失败 (ID: %s): %v", playlistID, err)
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Songs []model.NeteaseSong `json:"songs"`
		Code  int                 `json:"code"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[playlist/GetPlaylistTracks] 解析响应失败 (ID: %s): %v", playlistID, err)
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	log.Printf("[playlist/GetPlaylistTracks] 成功获取歌单歌曲 (ID: %s, 数量: %d)", playlistID, len(result.Songs))
	return result.Songs, nil
}
