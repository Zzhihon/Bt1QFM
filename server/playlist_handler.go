package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"Bt1QFM/db"
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
	playlist, err := db.GetPlaylist(ctx, userID)
	if err != nil {
		log.Printf("Error getting playlist for user %d: %v", userID, err)
		http.Error(w, fmt.Sprintf("Failed to get playlist: %v", err), http.StatusInternalServerError)
		return
	}

	// 如果播放列表为空，返回空数组
	if playlist == nil {
		playlist = []db.PlaylistItem{}
	}

	// 为每首歌添加完整信息（如果需要）
	enhancedPlaylist := make([]map[string]interface{}, 0, len(playlist))
	for _, item := range playlist {
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
		TrackID int64 `json:"trackId"`
	}

	if err := json.NewDecoder(r.Body).Decode(&requestData); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	track, err := h.trackRepo.GetTrackByID(requestData.TrackID)
	if err != nil {
		http.Error(w, "Failed to get track information", http.StatusInternalServerError)
		return
	}
	if track == nil {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	item := db.PlaylistItem{
		TrackID: track.ID,
		Title:   track.Title,
		Artist:  track.Artist,
		Album:   track.Album,
	}

	if err := db.AddTrackToPlaylist(ctx, userID, item); err != nil {
		log.Printf("Error adding track to playlist: %v", err)
		http.Error(w, fmt.Sprintf("Failed to add track to playlist: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Track added to playlist successfully",
	})
}

// RemoveFromPlaylistHandler 从播放列表中删除歌曲
func (h *APIHandler) RemoveFromPlaylistHandler(ctx context.Context, userID int64, w http.ResponseWriter, r *http.Request) {
	trackIDStr := r.URL.Query().Get("trackId")
	if trackIDStr == "" {
		var requestData struct {
			TrackID int64 `json:"trackId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&requestData); err != nil {
			http.Error(w, "Track ID is required", http.StatusBadRequest)
			return
		}
		trackIDStr = strconv.FormatInt(requestData.TrackID, 10)
	}

	trackID, err := strconv.ParseInt(trackIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid track ID format", http.StatusBadRequest)
		return
	}

	if err := db.RemoveTrackFromPlaylist(ctx, userID, trackID); err != nil {
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
	if err := db.ClearPlaylist(ctx, userID); err != nil {
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

	if err := db.UpdatePlaylistOrder(ctx, userID, requestData.TrackIDs); err != nil {
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
	if err := db.ShufflePlaylist(ctx, userID); err != nil {
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
	if err := db.ClearPlaylist(ctx, userID); err != nil {
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
		item := db.PlaylistItem{
			TrackID:  track.ID,
			Title:    track.Title,
			Artist:   track.Artist,
			Album:    track.Album,
			Position: i,
		}

		if err := db.AddTrackToPlaylist(ctx, userID, item); err != nil {
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
