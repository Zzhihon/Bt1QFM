package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"Bt1QFM/config"
	"Bt1QFM/core/audio"
	"Bt1QFM/core/auth"
	"Bt1QFM/db"
	"Bt1QFM/model"
	"Bt1QFM/repository"
)

// APIHandler holds dependencies for HTTP handlers.
type APIHandler struct {
	trackRepo repository.TrackRepository
	userRepo  repository.UserRepository
	ap        audio.Processor
	cfg       *config.Config
}

// NewAPIHandler creates a new APIHandler.
func NewAPIHandler(trackRepo repository.TrackRepository, userRepo repository.UserRepository, ap audio.Processor, cfg *config.Config) *APIHandler {
	return &APIHandler{trackRepo: trackRepo, userRepo: userRepo, ap: ap, cfg: cfg}
}

var nonAlphaNumeric = regexp.MustCompile(`[^a-zA-Z0-9_\-\.]`)
var multipleSpaces = regexp.MustCompile(`\s+`)

func generateSafeFilenamePrefix(title, artist, album string) string {
	// Fallback for empty title
	if strings.TrimSpace(title) == "" {
		title = "Untitled_Track"
	}

	var parts []string
	if strings.TrimSpace(artist) != "" {
		parts = append(parts, strings.TrimSpace(artist))
	}
	if strings.TrimSpace(album) != "" {
		parts = append(parts, strings.TrimSpace(album))
	}
	parts = append(parts, strings.TrimSpace(title))

	base := strings.Join(parts, " - ")

	// Replace multiple spaces with a single underscore
	base = multipleSpaces.ReplaceAllString(base, "_")
	// Replace known problematic characters or any non-alphanumeric (excluding _, -, .)
	base = nonAlphaNumeric.ReplaceAllString(base, "")

	// Prevent overly long filenames (e.g., 150 chars max for the prefix)
	maxLength := 150
	if len(base) > maxLength {
		base = base[:maxLength]
	}
	// Ensure it's not empty after sanitization
	if base == "" {
		base = "fallback_filename"
	}
	return base
}

// UploadTrackHandler handles audio file uploads and metadata.
// Expected multipart form fields:
// - trackFile: the audio file (WAV, MP3, etc.)
// - title: track title
// - artist: track artist (optional)
// - album: track album (optional)
// - coverFile: cover art image (JPEG, PNG, optional)
func (h *APIHandler) UploadTrackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Only POST method is allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get user ID from context (set by AuthMiddleware)
	userID, err := GetUserIDFromContext(r.Context())
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil { // 32MB max memory
		http.Error(w, fmt.Sprintf("Failed to parse multipart form: %v", err), http.StatusBadRequest)
		return
	}

	trackFile, trackHeader, err := r.FormFile("trackFile")
	if err != nil {
		http.Error(w, "Missing 'trackFile' in form", http.StatusBadRequest)
		return
	}
	defer trackFile.Close()

	title := r.FormValue("title")
	if title == "" {
		http.Error(w, "Missing 'title' in form", http.StatusBadRequest)
		return
	}
	artist := r.FormValue("artist")
	album := r.FormValue("album")

	// Generate safe base filename from metadata
	safeBaseFilename := generateSafeFilenamePrefix(title, artist, album)
	trackFileExt := filepath.Ext(trackHeader.Filename)
	if trackFileExt == "" {
		trackFileExt = ".dat" // Fallback extension
	}
	trackStoreFileName := safeBaseFilename + trackFileExt
	trackFilePath := filepath.Join(h.cfg.AudioUploadDir, trackStoreFileName)

	// Handle cover art (optional) - determine path first
	var coverArtDiskPath string  // Full disk path for saving cover, e.g., static/covers/...
	var coverArtServePath string // Relative path for client/DB, e.g., /static/covers/...
	var coverFile multipart.File
	var coverHeader *multipart.FileHeader

	coverFile, coverHeader, err = r.FormFile("coverFile")
	if err == nil {
		defer coverFile.Close()
		coverFileExt := filepath.Ext(coverHeader.Filename)
		if coverFileExt == "" {
			coverFileExt = ".jpg" // Fallback extension
		}
		coverStoreFileName := safeBaseFilename + coverFileExt
		coverArtDiskPath = filepath.Join(h.cfg.StaticDir, "covers", coverStoreFileName)
		coverArtServePath = "/static/covers/" + coverStoreFileName
	} else if err != http.ErrMissingFile {
		http.Error(w, fmt.Sprintf("Error processing cover file: %v", err), http.StatusBadRequest)
		return
	}

	// Create track entry with determined paths
	newTrack := &model.Track{
		UserID:       userID,
		Title:        title,
		Artist:       artist,
		Album:        album,
		FilePath:     trackFilePath,     // e.g., uploads/audio/Artist-Album-Title.wav
		CoverArtPath: coverArtServePath, // e.g., /static/covers/Artist-Album-Title.jpg or empty
		// Duration and HLSPlaylistPath will be set after transcoding
	}

	trackID, err := h.trackRepo.CreateTrack(newTrack)
	if err != nil {
		// Check if the error is due to UNIQUE constraint violation on (user_id, file_path)
		if strings.Contains(strings.ToLower(err.Error()), "unique constraint") || strings.Contains(strings.ToLower(err.Error()), "duplicate entry") {
			http.Error(w, fmt.Sprintf("Failed to create track: A track with a similar name or file path already exists for your account. Original error: %v", err), http.StatusConflict)
		} else {
			http.Error(w, fmt.Sprintf("Failed to create track entry in database: %v", err), http.StatusInternalServerError)
		}
		return
	}
	newTrack.ID = trackID // Assign the generated ID

	// Save the track file
	if err := saveUploadedFile(trackFile, trackFilePath); err != nil {
		// If saving fails, we should ideally delete the DB entry or mark it as invalid.
		// For now, log and return error. A more robust solution would handle this rollback.
		log.Printf("Error saving track file %s after DB entry: %v. DB entry ID: %d needs cleanup.", trackFilePath, err, trackID)
		http.Error(w, fmt.Sprintf("Failed to save track file: %v. Database entry created but file save failed.", err), http.StatusInternalServerError)
		return
	}

	// Save cover art if provided and path was determined
	if coverFile != nil && coverArtDiskPath != "" {
		coverDestDir := filepath.Dir(coverArtDiskPath)
		if err := os.MkdirAll(coverDestDir, 0755); err != nil {
			http.Error(w, fmt.Sprintf("Failed to create cover art directory: %v", err), http.StatusInternalServerError)
			// File already saved, DB entry exists. This is a partial failure.
			return
		}
		if err := saveUploadedFile(coverFile, coverArtDiskPath); err != nil {
			http.Error(w, fmt.Sprintf("Failed to save cover art: %v", err), http.StatusInternalServerError)
			// File already saved, DB entry exists. This is a partial failure.
			return
		}
	}
	// No need for a separate DB update for paths if they were set correctly in CreateTrack.
	// If cover art was processed *after* initial CreateTrack, we might need an update for coverArtPath if it wasn't set.
	// However, our current logic sets coverArtServePath in newTrack before CreateTrack.

	log.Printf("Successfully uploaded and saved track: ID %d, UserID: %d, Title '%s', File '%s', Cover '%s'",
		trackID, newTrack.UserID, newTrack.Title, newTrack.FilePath, newTrack.CoverArtPath)

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"message": "Track uploaded successfully", "trackId": trackID, "track": newTrack})
}

func saveUploadedFile(file multipart.File, destPath string) error {
	destFile, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("failed to create destination file %s: %w", destPath, err)
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, file)
	if err != nil {
		return fmt.Errorf("failed to copy uploaded file to %s: %w", destPath, err)
	}
	return nil
}

// GetTracksHandler retrieves and returns a list of all tracks for the current user.
func (h *APIHandler) GetTracksHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Only GET method is allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get user ID from context (set by AuthMiddleware)
	userID, err := GetUserIDFromContext(r.Context())
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	tracks, err := h.trackRepo.GetAllTracksByUserID(userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to retrieve tracks for user %d: %v", userID, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tracks)
}

// StreamHandler serves the HLS playlist for a given track ID.
// It triggers transcoding if the HLS playlist doesn't exist.
// URL: /stream/{trackID}/playlist.m3u8
func (h *APIHandler) StreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Only GET method is allowed", http.StatusMethodNotAllowed)
		return
	}

	// TODO: When full auth is implemented, verify if the authenticated user has access to this trackID.
	// For now, any valid trackID can be streamed.

	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/stream/"), "/")
	if len(pathParts) < 2 || pathParts[1] != "playlist.m3u8" {
		http.Error(w, "Invalid stream URL. Expected /stream/{trackID}/playlist.m3u8", http.StatusBadRequest)
		return
	}

	trackIDStr := pathParts[0]
	trackID, err := strconv.ParseInt(trackIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid track ID format", http.StatusBadRequest)
		return
	}

	track, err := h.trackRepo.GetTrackByID(trackID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get track details for ID %d: %v", trackID, err), http.StatusInternalServerError)
		return
	}
	if track == nil {
		http.Error(w, fmt.Sprintf("Track with ID %d not found", trackID), http.StatusNotFound)
		return
	}

	// Generate safe base filename from track metadata for HLS stream directory
	safeStreamDirName := generateSafeFilenamePrefix(track.Title, track.Artist, track.Album)

	// Define HLS paths using the safe name
	// hlsStreamDir is relative to StaticDir, e.g., "streams/Artist-Album-Title"
	hlsStreamDir := filepath.Join("streams", safeStreamDirName)
	// m3u8DiskPath is the full disk path, e.g., "static/streams/Artist-Album-Title/playlist.m3u8"
	m3u8DiskPath := filepath.Join(h.cfg.StaticDir, hlsStreamDir, "playlist.m3u8")
	// segmentDiskPattern is the full disk path pattern, e.g., "static/streams/Artist-Album-Title/segment_%03d.ts"
	segmentDiskPattern := filepath.Join(h.cfg.StaticDir, hlsStreamDir, "segment_%03d.ts")
	// hlsBaseURL is the URL base for segments in M3U8, e.g., "/static/streams/Artist-Album-Title/"
	// Ensure forward slashes for URL
	hlsBaseURL := "/static/" + strings.ReplaceAll(filepath.ToSlash(hlsStreamDir), "\\", "/") + "/"
	// m3u8ServePath is the relative path for client requests and DB storage, e.g. /static/streams/Artist-Album-Title/playlist.m3u8
	m3u8ServePath := "/static/" + strings.ReplaceAll(filepath.ToSlash(hlsStreamDir), "\\", "/") + "/playlist.m3u8"

	// Check if M3U8 already exists
	if _, err := os.Stat(m3u8DiskPath); os.IsNotExist(err) {
		log.Printf("HLS playlist %s not found for track ID %d (%s). Generating...", m3u8DiskPath, trackID, safeStreamDirName)

		// Ensure the specific stream directory exists within static/streams/
		if err := os.MkdirAll(filepath.Dir(m3u8DiskPath), 0755); err != nil {
			http.Error(w, fmt.Sprintf("Failed to create HLS stream directory for track %d: %v", trackID, err), http.StatusInternalServerError)
			return
		}

		duration, procErr := h.ap.ProcessToHLS(track.FilePath, m3u8DiskPath, segmentDiskPattern, hlsBaseURL, h.cfg.AudioBitrate, h.cfg.HLSSegmentTime)
		if procErr != nil {
			http.Error(w, fmt.Sprintf("Failed to process audio to HLS for track %d: %v", trackID, procErr), http.StatusInternalServerError)
			return
		}

		// Update database with HLS playlist path and duration
		if err := h.trackRepo.UpdateTrackHLSPath(trackID, m3u8ServePath, duration); err != nil {
			log.Printf("Error updating HLS path for track ID %d in DB: %v. Continuing anyway.", trackID, err)
		}
		track.HLSPlaylistPath = m3u8ServePath // Update in-memory track object for current request
		track.Duration = duration
	} else if err != nil {
		http.Error(w, fmt.Sprintf("Error checking HLS playlist for track %d: %v", trackID, err), http.StatusInternalServerError)
		return
	}

	if track.HLSPlaylistPath == "" {
		log.Printf("Track %d HLS path was empty in DB, but m3u8 may exist or was just generated. Using: %s", trackID, m3u8ServePath)
		track.HLSPlaylistPath = m3u8ServePath
		if track.Duration == 0 {
			duration, durErr := h.ap.GetAudioDuration(track.FilePath)
			if durErr == nil && duration > 0 {
				if errDb := h.trackRepo.UpdateTrackHLSPath(trackID, m3u8ServePath, duration); errDb != nil {
					log.Printf("Error updating HLS path (with duration) for track ID %d in DB: %v.", trackID, errDb)
				}
				track.Duration = duration
			}
		}
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	http.ServeFile(w, r, m3u8DiskPath)
	log.Printf("Served HLS playlist %s for track ID %d (%s)", m3u8DiskPath, trackID, safeStreamDirName)
}

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
	playlist, err := db.GetPlaylist(ctx, userID)
	if err != nil {
		log.Printf("Error getting playlist for user %d: %v", userID, err)
		http.Error(w, fmt.Sprintf("Failed to get playlist: %v", err), http.StatusInternalServerError)
		return
	}

	// 为每首歌添加完整信息（如果需要）
	enhancedPlaylist := make([]map[string]interface{}, 0, len(playlist))
	for _, item := range playlist {
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
		} else {
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

// AddAllTracksToPlaylist 将用户的所有歌曲添加到播放列表
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

// UploadCoverHandler 处理专辑封面上传
func (h *APIHandler) UploadCoverHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 解析multipart表单
	err := r.ParseMultipartForm(10 << 20) // 10MB
	if err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	// 获取表单数据
	artist := r.FormValue("artist")
	album := r.FormValue("album")
	if artist == "" || album == "" {
		http.Error(w, "Artist and album are required", http.StatusBadRequest)
		return
	}

	// 获取封面文件
	file, header, err := r.FormFile("cover")
	if err != nil {
		http.Error(w, "Failed to get cover file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// 生成安全的文件名
	safeFilename := generateSafeFilenamePrefix(artist, album, "")
	coverFilename := fmt.Sprintf("%s_cover%s", safeFilename, filepath.Ext(header.Filename))
	coverPath := filepath.Join(h.cfg.CoverUploadDir, coverFilename)

	// 保存封面文件
	err = saveUploadedFile(file, coverPath)
	if err != nil {
		http.Error(w, "Failed to save cover file", http.StatusInternalServerError)
		return
	}

	// 返回封面路径
	response := map[string]string{
		"coverPath": "/static/covers/" + coverFilename,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// LoginRequest represents the login request body
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// RegisterRequest represents the registration request body
type RegisterRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Email    string `json:"email"`
	Phone    string `json:"phone"`
}

// LoginHandler handles user login requests
func (h *APIHandler) LoginHandler(w http.ResponseWriter, r *http.Request) {
	log.Printf("收到登录请求: %s", r.RemoteAddr)

	if r.Method != http.MethodPost {
		log.Printf("无效的请求方法: %s", r.Method)
		http.Error(w, "Only POST method is allowed", http.StatusMethodNotAllowed)
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("解析请求体失败: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate request
	if req.Username == "" || req.Password == "" {
		log.Printf("用户名或密码为空: username=%s, password=%s", req.Username, "***")
		http.Error(w, "Username and password are required", http.StatusBadRequest)
		return
	}

	log.Printf("尝试登录用户: %s", req.Username)

	// Get user from database
	user, err := h.userRepo.GetUserByUsername(req.Username)
	if err != nil {
		log.Printf("查询用户失败: username=%s, error=%v", req.Username, err)
		http.Error(w, "Invalid username or password", http.StatusUnauthorized)
		return
	}

	// Check if user exists
	if user == nil {
		log.Printf("用户不存在: username=%s", req.Username)
		http.Error(w, "Invalid username or password", http.StatusUnauthorized)
		return
	}

	// Verify password
	if !auth.VerifyPassword(req.Password, user.PasswordHash) {
		log.Printf("密码验证失败: username=%s", req.Username)
		http.Error(w, "Invalid username or password", http.StatusUnauthorized)
		return
	}

	log.Printf("密码验证成功: username=%s", req.Username)

	// Generate JWT token
	token, err := auth.GenerateToken(user.ID, user.Username)
	if err != nil {
		log.Printf("生成token失败: username=%s, error=%v", req.Username, err)
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	log.Printf("登录成功: username=%s, userID=%d", req.Username, user.ID)

	// Return user info and token
	userResponse := map[string]interface{}{
		"id":       user.ID,
		"username": user.Username,
		"email":    user.Email,
	}

	// 只有当Phone字段有效时才添加到响应中
	if user.Phone.Valid {
		userResponse["phone"] = user.Phone.String
	}

	// 只有当Preferences字段有效时才添加到响应中
	if user.Preferences.Valid {
		userResponse["preferences"] = user.Preferences.String
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token": token,
		"user":  userResponse,
	})
}

// RegisterHandler handles user registration requests
func (h *APIHandler) RegisterHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Only POST method is allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate request
	if req.Username == "" || req.Password == "" || req.Email == "" {
		http.Error(w, "Username, password and email are required", http.StatusBadRequest)
		return
	}

	// Hash password
	hashedPassword, err := auth.HashPassword(req.Password)
	if err != nil {
		http.Error(w, "Failed to process password", http.StatusInternalServerError)
		return
	}

	// Create user
	user := &model.User{
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: hashedPassword,
	}

	// 只有当Phone字段不为空时才设置
	if req.Phone != "" {
		user.Phone = sql.NullString{
			String: req.Phone,
			Valid:  true,
		}
	}

	userID, err := h.userRepo.CreateUser(user)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate entry") {
			http.Error(w, "Username or email already exists", http.StatusConflict)
		} else {
			http.Error(w, "Failed to create user", http.StatusInternalServerError)
		}
		return
	}

	// Generate JWT token
	token, err := auth.GenerateToken(userID, user.Username)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	// Return user info and token
	userResponse := map[string]interface{}{
		"id":       userID,
		"username": user.Username,
		"email":    user.Email,
	}

	// 只有当Phone字段有效时才添加到响应中
	if user.Phone.Valid {
		userResponse["phone"] = user.Phone.String
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token": token,
		"user":  userResponse,
	})
}

// AuthMiddleware is a middleware function that checks for a valid JWT token
func (h *APIHandler) AuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Get the Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Authorization header is required", http.StatusUnauthorized)
			return
		}

		// Check if the header has the correct format
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
			return
		}

		// Parse and validate the token
		claims, err := auth.ParseToken(parts[1])
		if err != nil {
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}

		// Add user info to the request context
		ctx := context.WithValue(r.Context(), "userID", claims.UserID)
		ctx = context.WithValue(ctx, "username", claims.Username)

		// Call the next handler with the updated context
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

// GetUserIDFromContext extracts the user ID from the request context
func GetUserIDFromContext(ctx context.Context) (int64, error) {
	userID, ok := ctx.Value("userID").(int64)
	if !ok {
		return 0, fmt.Errorf("user ID not found in context")
	}
	return userID, nil
}

// GetUsernameFromContext extracts the username from the request context
func GetUsernameFromContext(ctx context.Context) (string, error) {
	username, ok := ctx.Value("username").(string)
	if !ok {
		return "", fmt.Errorf("username not found in context")
	}
	return username, nil
}
