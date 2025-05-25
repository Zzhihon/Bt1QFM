package netease

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"Bt1QFM/model"
)

// GetSongURL 获取歌曲URL
func (c *Client) GetSongURL(songID string) (string, error) {
	url := fmt.Sprintf("%s/song/url?id=%s", c.BaseURL, songID)
	resp, err := c.HTTPClient.Get(url)
	if err != nil {
		return "", fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	// 检查响应状态码
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("API返回错误状态码: %d", resp.StatusCode)
	}

	var result struct {
		Data []struct {
			ID  int64  `json:"id"`
			URL string `json:"url"`
		} `json:"data"`
		Code int    `json:"code"`
		Msg  string `json:"msg,omitempty"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("解析响应失败: %w", err)
	}

	// 检查API返回码
	if result.Code != 200 {
		return "", fmt.Errorf("API返回错误: %s (code: %d)", result.Msg, result.Code)
	}

	if len(result.Data) == 0 {
		return "", fmt.Errorf("未找到歌曲数据")
	}

	if result.Data[0].URL == "" {
		return "", fmt.Errorf("歌曲URL为空，可能是版权限制")
	}

	return result.Data[0].URL, nil
}

// GetSongDetail 获取歌曲详情
func (c *Client) GetSongDetail(songID string) (*model.NeteaseSong, error) {
	url := fmt.Sprintf("%s/song/detail?ids=%s", c.BaseURL, songID)
	resp, err := c.HTTPClient.Get(url)
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

	if len(result.Songs) > 0 {
		return &result.Songs[0], nil
	}

	return nil, fmt.Errorf("未找到歌曲")
}

// SearchSongs 搜索歌曲
func (c *Client) SearchSongs(keyword string, limit, offset int) (*model.NeteaseSearchResult, error) {
	params := url.Values{}
	params.Set("keywords", keyword)
	params.Set("limit", fmt.Sprintf("%d", limit))
	params.Set("offset", fmt.Sprintf("%d", offset))

	url := fmt.Sprintf("%s/search?%s", c.BaseURL, params.Encode())
	resp, err := c.HTTPClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Result model.NeteaseSearchResult `json:"result"`
		Code   int                       `json:"code"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	return &result.Result, nil
}
