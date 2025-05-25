package netease

import (
	"encoding/json"
	"fmt"
	"strconv"

	"Bt1QFM/model"
)

// GetLyric 获取歌词
func (c *Client) GetLyric(songID string) (*model.NeteaseLyric, error) {
	url := fmt.Sprintf("%s/lyric?id=%s", c.baseURL, songID)
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Lrc struct {
			Lyric string `json:"lyric"`
		} `json:"lrc"`
		Tlyric struct {
			Lyric string `json:"lyric"`
		} `json:"tlyric"`
		Code int `json:"code"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	// 将string类型的songID转换为int64
	id, err := strconv.ParseInt(songID, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("无效的歌曲ID: %w", err)
	}

	lyric := &model.NeteaseLyric{
		SongID:     id,
		Lyric:      result.Lrc.Lyric,
		TransLyric: result.Tlyric.Lyric,
	}

	return lyric, nil
}
