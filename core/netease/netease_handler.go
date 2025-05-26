package netease

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
)

// NeteaseHandler 处理网易云音乐相关的请求
type NeteaseHandler struct {
	client *Client
}

// NewNeteaseHandler 创建新的网易云音乐处理器
func NewNeteaseHandler(baseURL string) *NeteaseHandler {
	client := NewClient()
	client.SetBaseURL(baseURL)
	return &NeteaseHandler{
		client: client,
	}
}

// SearchResponse 搜索响应结构
type SearchResponse struct {
	Success bool             `json:"success"`
	Data    []SearchSongItem `json:"data"`
	Error   string           `json:"error,omitempty"`
}

// SearchSongItem 搜索结果项
type SearchSongItem struct {
	ID       int64    `json:"id"`
	Name     string   `json:"name"`
	Artists  []string `json:"artists"`
	Album    string   `json:"album"`
	Duration int      `json:"duration"`
	URL      string   `json:"url,omitempty"`
	PicURL   string   `json:"picUrl,omitempty"`
}

// HandleSearch 处理搜索请求
func (h *NeteaseHandler) HandleSearch(w http.ResponseWriter, r *http.Request) {
	// 获取查询参数
	query := r.URL.Query().Get("q")
	if query == "" {
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "请提供搜索关键词",
		})
		return
	}

	log.Printf("开始搜索歌曲: %s", query)

	// 使用已实现的SearchSongs函数
	result, err := h.client.SearchSongs(query, 5, 0)
	if err != nil {
		log.Printf("搜索失败: %v", err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "搜索失败: " + err.Error(),
		})
		return
	}

	log.Printf("搜索成功，找到 %d 首歌曲", len(result.Songs))

	// 转换结果格式
	response := SearchResponse{
		Success: true,
		Data:    make([]SearchSongItem, 0, len(result.Songs)),
	}

	for _, song := range result.Songs {
		// 获取艺术家名称
		artistNames := make([]string, len(song.Artists))
		for i, artist := range song.Artists {
			artistNames[i] = artist.Name
		}

		log.Printf("处理歌曲: %s, 专辑封面URL: %s", song.Name, song.Album.PicURL)

		item := SearchSongItem{
			ID:       song.ID,
			Name:     song.Name,
			Artists:  artistNames,
			Album:    song.Album.Name,
			Duration: song.Duration,
			PicURL:   song.Album.PicURL,
		}
		response.Data = append(response.Data, item)
	}

	// 返回结果
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
	log.Printf("搜索请求处理完成")
}

// HandleCommand 处理命令请求
func (h *NeteaseHandler) HandleCommand(w http.ResponseWriter, r *http.Request) {
	// 获取命令文本
	command := r.URL.Query().Get("command")
	if command == "" {
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "请提供命令",
		})
		return
	}

	log.Printf("收到前端请求: %s", r.URL.String())
	log.Printf("处理命令: %s", command)

	// 解析命令
	parts := strings.Fields(command)
	if len(parts) < 2 || parts[0] != "/netease" {
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "无效的命令格式，请使用 /netease [歌曲ID]",
		})
		return
	}

	// 提取歌曲ID
	songIDStr := parts[1]
	songID, err := strconv.ParseInt(songIDStr, 10, 64)
	if err != nil {
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "无效的歌曲ID: " + err.Error(),
		})
		return
	}

	log.Printf("准备转发请求到网易云API，歌曲ID: %s", songIDStr)
	log.Printf("目标URL: %s/song/url?id=%s", h.client.BaseURL, songIDStr)

	// 使用已实现的GetSongURL函数
	url, err := h.client.GetSongURL(songIDStr)
	if err != nil {
		// 记录错误日志
		log.Printf("获取歌曲URL失败: %v", err)

		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "获取播放地址失败: " + err.Error(),
		})
		return
	}

	log.Printf("成功获取歌曲URL: %s", url)

	// 返回结果
	response := SearchResponse{
		Success: true,
		Data: []SearchSongItem{
			{
				ID:  songID,
				URL: url,
			},
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
	log.Printf("请求处理完成，已返回结果")
}
