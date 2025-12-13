package netease

import (
	"bytes"
	// "context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"Bt1QFM/config"
	"Bt1QFM/core/audio"
	"Bt1QFM/logger"
	"Bt1QFM/model"
	"Bt1QFM/repository"
	// "Bt1QFM/storage"

	// "github.com/minio/minio-go/v7"
)

// NeteaseHandler 处理网易云音乐相关的请求
type NeteaseHandler struct {
	client       *Client
	mp3Processor *audio.MP3Processor
	config       *config.Config
}

// NewNeteaseHandler 创建新的网易云音乐处理器
func NewNeteaseHandler(baseURL string, cfg *config.Config) *NeteaseHandler {
	client := NewClient()
	client.SetBaseURL(baseURL)
	return &NeteaseHandler{
		client:       client,
		mp3Processor: audio.NewMP3Processor(cfg.FFmpegPath),
		config:       cfg,
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
	VideoURL string   `json:"videoUrl,omitempty"` // 动态封面视频URL
}

// HandleSearch 处理搜索请求
func (h *NeteaseHandler) HandleSearch(w http.ResponseWriter, r *http.Request) {
	// 获取查询参数 - 同时支持 q 和 keywords 两种参数名
	query := r.URL.Query().Get("q")
	if query == "" {
		query = r.URL.Query().Get("keywords")
	}
	if query == "" {
		logger.Error("[HandleSearch] 错误: 缺少搜索关键词")
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "请提供搜索关键词",
		})
		return
	}

	// 获取 limit 参数，默认为 3
	limit := 3
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := parseLimit(limitStr); err == nil && l > 0 {
			limit = l
			if limit > 50 {
				limit = 50 // 最大限制50
			}
		}
	}

	logger.Info("[HandleSearch] 开始搜索歌曲", logger.String("query", query), logger.Int("limit", limit))

	// 使用已实现的SearchSongs函数
	result, err := h.client.SearchSongs(query, limit, 0, h.mp3Processor, h.config.StaticDir)
	if err != nil {
		logger.Error("[HandleSearch] 搜索失败", logger.ErrorField(err))
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "搜索失败: " + err.Error(),
		})
		return
	}

	logger.Info("[HandleSearch] 搜索成功", logger.Int("songs_count", len(result.Songs)))

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

		logger.Debug("[HandleSearch] 处理歌曲", logger.String("name", song.Name), logger.Int64("id", song.ID))

		// 获取动态封面
		videoURL, err := h.client.GetDynamicCover(fmt.Sprintf("%d", song.ID))
		if err != nil {
			logger.Warn("[HandleSearch] 获取动态封面失败", logger.Int64("song_id", song.ID), logger.ErrorField(err))
			// 继续处理，不中断流程
		}

		item := SearchSongItem{
			ID:       song.ID,
			Name:     song.Name,
			Artists:  artistNames,
			Album:    song.Album.Name,
			Duration: song.Duration,
			PicURL:   song.Album.PicURL,
			VideoURL: videoURL,
		}
		response.Data = append(response.Data, item)
	}

	// 返回结果
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
	logger.Info("[HandleSearch] 搜索请求处理完成")
}

// checkAndUpdateHLS 异步检查并更新HLS路径
func (h *NeteaseHandler) checkAndUpdateHLS(songID string) {
	logger.Info("[checkAndUpdateHLS] 开始检查歌曲HLS路径", logger.String("song_id", songID))

	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Error("[checkAndUpdateHLS] 发生panic", logger.String("song_id", songID), logger.Any("panic", r))
			}
		}()

		if songID == "" {
			logger.Error("[checkAndUpdateHLS] 歌曲ID为空")
			return
		}

		logger.Debug("[checkAndUpdateHLS] 创建仓库实例", logger.String("song_id", songID))
		repo := repository.NewNeteaseSongRepository()
		if repo == nil {
			logger.Error("[checkAndUpdateHLS] 创建仓库失败", logger.String("song_id", songID))
			return
		}

		// 检查数据库中是否存在该歌曲
		logger.Debug("[checkAndUpdateHLS] 查询数据库中的歌曲信息", logger.String("song_id", songID))
		song, err := repo.GetNeteaseSongByID(songID)
		if err != nil {
			logger.Error("[checkAndUpdateHLS] 获取歌曲信息失败", logger.String("song_id", songID), logger.ErrorField(err))
			return
		}

		if song == nil {
			logger.Info("[checkAndUpdateHLS] 数据库中不存在该歌曲，需要创建新记录", logger.String("song_id", songID))
		} else {
			logger.Debug("[checkAndUpdateHLS] 数据库中的歌曲信息",
				logger.Int64("id", song.ID),
				logger.String("title", song.Title),
				logger.String("hls_path", song.HLSPlaylistPath))
		}

		// 如果歌曲不存在或HLS路径为空，则调用GetSongURL更新
		if song == nil || song.HLSPlaylistPath == "" {
			logger.Info("[checkAndUpdateHLS] 开始调用GetSongURL更新歌曲信息", logger.String("song_id", songID))
			url, err := h.client.GetSongURL(songID)
			if err != nil {
				logger.Error("[checkAndUpdateHLS] 更新歌曲信息失败", logger.String("song_id", songID), logger.ErrorField(err))
				return
			}
			logger.Debug("[checkAndUpdateHLS] GetSongURL返回URL", logger.String("song_id", songID), logger.String("url", url))

			// 再次检查数据库更新情况
			updatedSong, err := repo.GetNeteaseSongByID(songID)
			if err != nil {
				logger.Error("[checkAndUpdateHLS] 更新后查询歌曲信息失败", logger.String("song_id", songID), logger.ErrorField(err))
				return
			}
			if updatedSong != nil {
				logger.Info("[checkAndUpdateHLS] 更新后的歌曲信息",
					logger.Int64("id", updatedSong.ID),
					logger.String("title", updatedSong.Title),
					logger.String("hls_path", updatedSong.HLSPlaylistPath))
			} else {
				logger.Warn("[checkAndUpdateHLS] 更新后未找到歌曲信息", logger.String("song_id", songID))
			}
		} else {
			logger.Info("[checkAndUpdateHLS] 歌曲HLS路径已存在，无需更新",
				logger.String("song_id", songID),
				logger.String("hls_path", song.HLSPlaylistPath))
		}
	}()
}

// HandleCommand 处理命令请求


// HandleSongDetail handles requests for Netease song details.
func (h *NeteaseHandler) HandleSongDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 获取歌曲ID
	ids := r.URL.Query().Get("ids")
	if ids == "" {
		http.Error(w, "Missing required parameter: ids", http.StatusBadRequest)
		return
	}

	// 直接调用网易云API（通过本地代理3000端口）获取原始响应
	url := fmt.Sprintf("%s/song/detail?ids=%s", h.client.BaseURL, ids)
	req, err := h.client.createRequest("GET", url)
	if err != nil {
		logger.Error("[HandleSongDetail] Failed to create request", logger.String("ids", ids), logger.ErrorField(err))
		http.Error(w, fmt.Sprintf("Failed to create request: %v", err), http.StatusInternalServerError)
		return
	}

	resp, err := h.client.HTTPClient.Do(req)
	if err != nil {
		logger.Error("[HandleSongDetail] Request to proxy failed", logger.String("ids", ids), logger.ErrorField(err))
		http.Error(w, fmt.Sprintf("Request to proxy failed: %v", err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// 读取原始响应数据
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.Error("[HandleSongDetail] Failed to read response body", logger.String("ids", ids), logger.ErrorField(err))
		http.Error(w, fmt.Sprintf("Failed to read response body: %v", err), http.StatusInternalServerError)
		return
	}

	// 定义一个临时 struct 来匹配网易云 API 的原始结构
	var tempResult struct {
		Songs []struct {
			ID       int64                 `json:"id"`
			Name     string                `json:"name"`
			Artists  []model.NeteaseArtist `json:"ar"` // 使用 model.NeteaseArtist，但 tag 是 ar
			Album    model.NeteaseAlbum    `json:"al"` // 使用 model.NeteaseAlbum，但 tag 是 al
			Duration int                   `json:"dt"` // 使用 dt
			URL      string                `json:"url"`
			CoverURL string                `json:"coverUrl"`
		} `json:"songs"`
		Code int `json:"code"`
	}

	// 将读取的body重新放入响应体，以便NewDecoder读取
	resp.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	// 解析到临时 struct
	if err := json.NewDecoder(resp.Body).Decode(&tempResult); err != nil {
		logger.Error("[HandleSongDetail] Failed to decode JSON response", logger.String("ids", ids), logger.ErrorField(err))
		http.Error(w, fmt.Sprintf("Failed to decode JSON: %v", err), http.StatusInternalServerError)
		return
	}

	// 构建符合前端期望的响应结构
	response := struct {
		Success bool               `json:"success"`
		Data    *model.NeteaseSong `json:"data"`
	}{
		Success: false, // 默认失败
		Data:    nil,
	}

	// 如果解析成功且有歌曲数据，手动映射到 model.NeteaseSong 结构
	if tempResult.Code == 200 && len(tempResult.Songs) > 0 {
		originalSong := tempResult.Songs[0]
		// 手动创建并填充 model.NeteaseSong 结构
		response.Data = &model.NeteaseSong{
			ID:       originalSong.ID,
			Name:     originalSong.Name,
			Artists:  originalSong.Artists,
			Album:    originalSong.Album,
			Duration: originalSong.Duration,
			URL:      originalSong.URL,
			CoverURL: originalSong.Album.PicURL, // 使用 Album 中的 picUrl 作为 CoverURL
			// CreatedAt 可以根据需要设置或忽略
		}
		response.Success = true
	} else {
		logger.Warn("[HandleSongDetail] Proxy returned non-200 code or empty songs list", logger.String("ids", ids))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleDynamicCover handles requests for Netease dynamic song cover.
func (h *NeteaseHandler) HandleDynamicCover(w http.ResponseWriter, r *http.Request) {
	logger.Info("[HandleDynamicCover] Handling dynamic cover request")

	if r.Method != http.MethodGet {
		http.Error(w, "Only GET method is allowed", http.StatusMethodNotAllowed)
		logger.Error("[HandleDynamicCover] Method not allowed for dynamic cover")
		return
	}

	ids := r.URL.Query().Get("id")
	if ids == "" {
		http.Error(w, "Missing 'id' parameter", http.StatusBadRequest)
		logger.Error("[HandleDynamicCover] Missing 'id' parameter for dynamic cover")
		return
	}

	// 假设 GetDynamicCover 只需要一个 ID
	coverURL, err := h.client.GetDynamicCover(ids)

	// 构建符合前端期望的 JSON 响应结构
	response := struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			VideoPlayURL string `json:"videoPlayUrl"`
		} `json:"data"`
	}{
		Code:    200, // 默认成功
		Message: "",
		Data: struct {
			VideoPlayURL string `json:"videoPlayUrl"`
		}{
			VideoPlayURL: coverURL,
		},
	}

	if err != nil {
		logger.Error("[HandleDynamicCover] Error getting dynamic cover", logger.String("id", ids), logger.ErrorField(err))
		response.Code = 500 // 或者根据错误类型设置其他状态码
		response.Message = fmt.Sprintf("Failed to get dynamic cover: %v", err)
		response.Data.VideoPlayURL = "" // 错误时清空URL
		http.Error(w, response.Message, http.StatusInternalServerError)
		return // 发生错误时提前返回
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		logger.Error("[HandleDynamicCover] Error encoding JSON response", logger.ErrorField(err))
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}

	logger.Info("[HandleDynamicCover] Successfully returned dynamic cover", logger.String("id", ids))
}

// parseLimit 解析limit参数
func parseLimit(s string) (int, error) {
	return strconv.Atoi(s)
}
