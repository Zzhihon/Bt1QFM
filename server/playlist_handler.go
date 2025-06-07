package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"

	// "Bt1QFM/db"
	"Bt1QFM/cache"
	"Bt1QFM/repository"
)

// PlaylistHandler 处理播放列表相关的请求
func (h *APIHandler) PlaylistHandler(w http.ResponseWriter, r *http.Request) {
	// 设置CORS头，允许跨域请求
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	// 处理预检请求
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	// 获取当前用户ID（从认证中间件中获取）
	userID, err := GetUserIDFromContext(r.Context())
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	ctx := r.Context()

	switch r.Method {
	case http.MethodGet:
		// 获取播放列表
		h.GetPlaylistHandler(ctx, userID, w, r)
	case http.MethodPost:
		// 添加歌曲到播放列表
		h.AddToPlaylistHandler(ctx, userID, w, r)
	case http.MethodDelete:
		// 可能是从播放列表中删除歌曲或清空播放列表
		if r.URL.Query().Get("clear") == "true" {
			h.ClearPlaylistHandler(ctx, userID, w, r)
		} else {
			h.RemoveFromPlaylistHandler(ctx, userID, w, r)
		}
	case http.MethodPut:
		// 可能是更新播放列表顺序或洗牌
		if r.URL.Query().Get("shuffle") == "true" {
			h.ShufflePlaylistHandler(ctx, userID, w, r)
		} else {
			h.UpdatePlaylistOrderHandler(ctx, userID, w, r)
		}
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// GetPlaylistHandler 返回用户的播放列表
func (h *APIHandler) GetPlaylistHandler(ctx context.Context, userID int64, w http.ResponseWriter, r *http.Request) {
	// 检查用户ID是否有效
	if userID <= 0 {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	// 获取播放列表
	playlist, err := cache.GetPlaylist(ctx, userID)
	if err != nil {
		log.Printf("Error getting playlist for user %d: %v", userID, err)
		http.Error(w, fmt.Sprintf("Failed to get playlist: %v", err), http.StatusInternalServerError)
		return
	}

	// 如果播放列表为空，返回空数组
	if playlist == nil {
		playlist = []cache.PlaylistItem{}
	}

	// 为每首歌添加完整信息（如果需要）
	enhancedPlaylist := make([]map[string]interface{}, 0, len(playlist))
	for _, item := range playlist {
		// 如果是网易云音乐的歌曲
		if item.NeteaseID != 0 {
			enhancedPlaylist = append(enhancedPlaylist, map[string]interface{}{
				"neteaseId":      item.NeteaseID,
				"title":          item.Title,
				"artist":         item.Artist,
				"album":          item.Album,
				"position":       item.Position,
				"hlsPlaylistUrl": fmt.Sprintf("/streams/netease/%d/playlist.m3u8", item.NeteaseID),
			})
			continue
		}

		// 检查trackRepo是否初始化
		if h.trackRepo == nil {
			log.Printf("Error: trackRepo is not initialized")
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		track, err := h.trackRepo.GetTrackByID(item.TrackID)
		if err != nil {
			log.Printf("Warning: Failed to get full info for track %d: %v", item.TrackID, err)
			// 使用现有的播放列表项信息
			enhancedPlaylist = append(enhancedPlaylist, map[string]interface{}{
				"trackId":  item.TrackID,
				"title":    item.Title,
				"artist":   item.Artist,
				"album":    item.Album,
				"position": item.Position,
			})
		} else if track != nil {
			// 使用从数据库获取的完整信息
			enhancedPlaylist = append(enhancedPlaylist, map[string]interface{}{
				"trackId":        track.ID,
				"title":          track.Title,
				"artist":         track.Artist,
				"album":          track.Album,
				"position":       item.Position,
				"coverArtPath":   track.CoverArtPath,
				"hlsPlaylistUrl": fmt.Sprintf("/stream/%d/playlist.m3u8", track.ID),
			})
		} else {
			// 如果track为nil，使用播放列表项的基本信息
			enhancedPlaylist = append(enhancedPlaylist, map[string]interface{}{
				"trackId":  item.TrackID,
				"title":    item.Title,
				"artist":   item.Artist,
				"album":    item.Album,
				"position": item.Position,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"playlist": enhancedPlaylist,
	})
}

// AddToPlaylistHandler 将歌曲添加到播放列表
func (h *APIHandler) AddToPlaylistHandler(ctx context.Context, userID int64, w http.ResponseWriter, r *http.Request) {
	var requestData struct {
		TrackID   int64  `json:"trackId,omitempty"`
		NeteaseID int64  `json:"neteaseId,omitempty"`
		Title     string `json:"title"`
		Artist    string `json:"artist"`
		Album     string `json:"album"`
	}

	// 读取原始请求体
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("[AddToPlaylistHandler] 读取请求体失败: %v", err)
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	log.Printf("[AddToPlaylistHandler] 原始请求体: %s", string(bodyBytes))

	// 重置请求体
	r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	if err := json.NewDecoder(r.Body).Decode(&requestData); err != nil {
		log.Printf("[AddToPlaylistHandler] 解析请求数据失败: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	log.Printf("[AddToPlaylistHandler] 开始处理添加歌曲请求 (用户ID: %d)", userID)
	log.Printf("[AddToPlaylistHandler] 请求数据: {TrackID:%d NeteaseID:%d Title:%s Artist:%s Album:%s}",
		requestData.TrackID, requestData.NeteaseID, requestData.Title, requestData.Artist, requestData.Album)

	// 检查是否提供了有效的ID
	if requestData.TrackID == 0 && requestData.NeteaseID == 0 {
		log.Printf("[AddToPlaylistHandler] 错误: 未提供有效的ID")
		http.Error(w, "Either trackId or neteaseId must be provided", http.StatusBadRequest)
		return
	}

	// 如果是网易云音乐的歌曲
	if requestData.NeteaseID != 0 {
		log.Printf("[AddToPlaylistHandler] 验证网易云音乐歌曲信息 (ID: %d)", requestData.NeteaseID)
		// 验证网易云音乐歌曲信息
		neteaseRepo := repository.NewNeteaseSongRepository()
		song, err := neteaseRepo.GetNeteaseSongByID(fmt.Sprintf("%d", requestData.NeteaseID))
		if err != nil {
			log.Printf("[AddToPlaylistHandler] 获取网易云音乐歌曲信息失败 (ID: %d): %v", requestData.NeteaseID, err)
			http.Error(w, "Failed to get netease song information", http.StatusInternalServerError)
			return
		}
		if song == nil {
			log.Printf("[AddToPlaylistHandler] 网易云音乐歌曲不存在 (ID: %d)", requestData.NeteaseID)
			http.Error(w, "Netease song not found", http.StatusNotFound)
			return
		}

		log.Printf("[AddToPlaylistHandler] 找到网易云音乐歌曲: %s - %s", song.Title, song.Artist)
		// 使用数据库中的信息更新请求数据
		requestData.Title = song.Title
		requestData.Artist = song.Artist
		requestData.Album = song.Album
	} else if requestData.TrackID != 0 {
		log.Printf("[AddToPlaylistHandler] 验证普通歌曲信息 (TrackID: %d)", requestData.TrackID)
		// 如果是普通歌曲，验证歌曲信息
		track, err := h.trackRepo.GetTrackByID(requestData.TrackID)
		if err != nil {
			log.Printf("[AddToPlaylistHandler] 获取普通歌曲信息失败 (ID: %d): %v", requestData.TrackID, err)
			http.Error(w, "Failed to get track information", http.StatusInternalServerError)
			return
		}
		if track == nil {
			log.Printf("[AddToPlaylistHandler] 普通歌曲不存在 (ID: %d)", requestData.TrackID)
			http.Error(w, "Track not found", http.StatusNotFound)
			return
		}
		log.Printf("[AddToPlaylistHandler] 找到普通歌曲: %s - %s", track.Title, track.Artist)
	}

	item := cache.PlaylistItem{
		TrackID:   requestData.TrackID,
		NeteaseID: requestData.NeteaseID,
		Title:     requestData.Title,
		Artist:    requestData.Artist,
		Album:     requestData.Album,
	}

	log.Printf("[AddToPlaylistHandler] 准备添加到播放列表: {TrackID:%d NeteaseID:%d Title:%s Artist:%s Album:%s}",
		item.TrackID, item.NeteaseID, item.Title, item.Artist, item.Album)

	if err := cache.AddTrackToPlaylist(ctx, userID, item); err != nil {
		log.Printf("[AddToPlaylistHandler] 添加到播放列表失败: %v", err)
		http.Error(w, fmt.Sprintf("Failed to add track to playlist: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[AddToPlaylistHandler] 成功添加到播放列表")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Track added to playlist successfully",
	})
}

// RemoveFromPlaylistHandler 从播放列表中删除歌曲
func (h *APIHandler) RemoveFromPlaylistHandler(ctx context.Context, userID int64, w http.ResponseWriter, r *http.Request) {
	// 获取 trackId 或 neteaseId
	trackIDStr := r.URL.Query().Get("trackId")
	neteaseIDStr := r.URL.Query().Get("neteaseId")

	var trackID int64
	var err error

	if trackIDStr != "" {
		trackID, err = strconv.ParseInt(trackIDStr, 10, 64)
		if err != nil {
			http.Error(w, "Invalid track ID format", http.StatusBadRequest)
			return
		}
	} else if neteaseIDStr != "" {
		trackID, err = strconv.ParseInt(neteaseIDStr, 10, 64)
		if err != nil {
			http.Error(w, "Invalid netease ID format", http.StatusBadRequest)
			return
		}
	} else {
		http.Error(w, "Either trackId or neteaseId is required", http.StatusBadRequest)
		return
	}

	if err := cache.RemoveTrackFromPlaylist(ctx, userID, trackID); err != nil {
		log.Printf("Error removing track from playlist: %v", err)
		http.Error(w, fmt.Sprintf("Failed to remove track from playlist: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Track removed from playlist successfully",
	})
}

// ClearPlaylistHandler 清空播放列表
func (h *APIHandler) ClearPlaylistHandler(ctx context.Context, userID int64, w http.ResponseWriter, r *http.Request) {
	if err := cache.ClearPlaylist(ctx, userID); err != nil {
		log.Printf("Error clearing playlist: %v", err)
		http.Error(w, fmt.Sprintf("Failed to clear playlist: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Playlist cleared successfully",
	})
}

// UpdatePlaylistOrderHandler 更新播放列表顺序
func (h *APIHandler) UpdatePlaylistOrderHandler(ctx context.Context, userID int64, w http.ResponseWriter, r *http.Request) {
	var requestData struct {
		TrackIDs []int64 `json:"trackIds"`
	}

	if err := json.NewDecoder(r.Body).Decode(&requestData); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(requestData.TrackIDs) == 0 {
		http.Error(w, "Track IDs list cannot be empty", http.StatusBadRequest)
		return
	}

	if err := cache.UpdatePlaylistOrder(ctx, userID, requestData.TrackIDs); err != nil {
		log.Printf("Error updating playlist order: %v", err)
		http.Error(w, fmt.Sprintf("Failed to update playlist order: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Playlist order updated successfully",
	})
}

// ShufflePlaylistHandler 随机排序播放列表
func (h *APIHandler) ShufflePlaylistHandler(ctx context.Context, userID int64, w http.ResponseWriter, r *http.Request) {
	if err := cache.ShufflePlaylist(ctx, userID); err != nil {
		log.Printf("Error shuffling playlist: %v", err)
		http.Error(w, fmt.Sprintf("Failed to shuffle playlist: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Playlist shuffled successfully",
	})
}

// AddAllTracksToPlaylistHandler 将用户的所有歌曲添加到播放列表
func (h *APIHandler) AddAllTracksToPlaylistHandler(w http.ResponseWriter, r *http.Request) {
	// 设置CORS头，允许跨域请求
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	// 处理预检请求
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Only POST method is allowed", http.StatusMethodNotAllowed)
		return
	}

	// 获取当前用户ID（从认证中间件中获取）
	userID, err := GetUserIDFromContext(r.Context())
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	ctx := r.Context()

	// 首先清空现有播放列表
	if err := cache.ClearPlaylist(ctx, userID); err != nil {
		log.Printf("Error clearing playlist before adding all tracks: %v", err)
		http.Error(w, fmt.Sprintf("Failed to clear existing playlist: %v", err), http.StatusInternalServerError)
		return
	}

	// 获取用户的所有歌曲
	tracks, err := h.trackRepo.GetAllTracksByUserID(userID)
	if err != nil {
		log.Printf("Error getting user tracks: %v", err)
		http.Error(w, fmt.Sprintf("Failed to get user tracks: %v", err), http.StatusInternalServerError)
		return
	}

	addedCount := 0
	for i, track := range tracks {
		item := cache.PlaylistItem{
			TrackID:  track.ID,
			Title:    track.Title,
			Artist:   track.Artist,
			Album:    track.Album,
			Position: i,
		}

		if err := cache.AddTrackToPlaylist(ctx, userID, item); err != nil {
			log.Printf("Warning: Failed to add track %d to playlist: %v", track.ID, err)
			continue
		}
		addedCount++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": fmt.Sprintf("Added %d tracks to playlist", addedCount),
		"count":   addedCount,
	})
}
