package server

import (
	"context"
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

	// TODO: Implement actual user authentication. For now, assume user ID 1.
	currentUserID := int64(1)

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
		UserID:       currentUserID,
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

	// TODO: Implement actual user authentication. For now, assume user ID 1.
	currentUserID := int64(1)

	tracks, err := h.trackRepo.GetAllTracksByUserID(currentUserID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to retrieve tracks for user %d: %v", currentUserID, err), http.StatusInternalServerError)
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

	// 获取当前用户ID（实际项目中应该基于认证信息）
	// TODO: 实现更好的用户认证。目前假设用户ID为1。
	currentUserID := int64(1)

	ctx := r.Context()

	switch r.Method {
	case http.MethodGet:
		// 获取播放列表
		h.GetPlaylistHandler(ctx, currentUserID, w, r)
	case http.MethodPost:
		// 添加歌曲到播放列表
		h.AddToPlaylistHandler(ctx, currentUserID, w, r)
	case http.MethodDelete:
		// 可能是从播放列表中删除歌曲或清空播放列表
		if r.URL.Query().Get("clear") == "true" {
			h.ClearPlaylistHandler(ctx, currentUserID, w, r)
		} else {
			h.RemoveFromPlaylistHandler(ctx, currentUserID, w, r)
		}
	case http.MethodPut:
		// 可能是更新播放列表顺序或洗牌
		if r.URL.Query().Get("shuffle") == "true" {
			h.ShufflePlaylistHandler(ctx, currentUserID, w, r)
		} else {
			h.UpdatePlaylistOrderHandler(ctx, currentUserID, w, r)
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

	// 获取当前用户ID（实际项目中应该基于认证信息）
	// TODO: 实现更好的用户认证。目前假设用户ID为1。
	currentUserID := int64(1)

	ctx := r.Context()

	// 首先清空现有播放列表
	if err := db.ClearPlaylist(ctx, currentUserID); err != nil {
		log.Printf("Error clearing playlist before adding all tracks: %v", err)
		http.Error(w, fmt.Sprintf("Failed to clear existing playlist: %v", err), http.StatusInternalServerError)
		return
	}

	// 获取用户的所有歌曲
	tracks, err := h.trackRepo.GetAllTracksByUserID(currentUserID)
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

		if err := db.AddTrackToPlaylist(ctx, currentUserID, item); err != nil {
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
