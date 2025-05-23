package server

import (

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
	"Bt1QFM/logger"
	"Bt1QFM/model"
	"Bt1QFM/repository"

	"github.com/gorilla/mux"
)

// APIHandler 处理所有API请求
type APIHandler struct {
	trackRepo      repository.TrackRepository
	userRepo       repository.UserRepository
	albumRepo      repository.AlbumRepository
	audioProcessor *audio.FFmpegProcessor
	cfg            *config.Config
}

// NewAPIHandler 创建新的API处理器
func NewAPIHandler(
	trackRepo repository.TrackRepository,
	userRepo repository.UserRepository,
	albumRepo repository.AlbumRepository,
	audioProcessor *audio.FFmpegProcessor,
	cfg *config.Config,
) *APIHandler {
	return &APIHandler{
		trackRepo:      trackRepo,
		userRepo:       userRepo,
		albumRepo:      albumRepo,
		audioProcessor: audioProcessor,
		cfg:            cfg,
	}
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
		// 更新数据库中的封面路径
		if err := h.trackRepo.UpdateTrackCoverArtPath(trackID, coverArtServePath); err != nil {
			log.Printf("Warning: Failed to update cover art path in database: %v", err)
		}
	}

	// 生成 HLS 播放列表路径
	safeStreamDirName := generateSafeFilenamePrefix(title, artist, album)
	hlsStreamDir := filepath.Join("streams", safeStreamDirName)
	m3u8ServePath := "/static/" + strings.ReplaceAll(filepath.ToSlash(hlsStreamDir), "\\", "/") + "/playlist.m3u8"

	// 更新数据库中的 HLS 播放列表路径
	if err := h.trackRepo.UpdateTrackHLSPath(trackID, m3u8ServePath, 0); err != nil {
		log.Printf("Warning: Failed to update HLS path in database: %v", err)
	}

	log.Printf("Successfully uploaded and saved track: ID %d, UserID: %d, Title '%s', File '%s', Cover '%s', HLS '%s'",
		trackID, newTrack.UserID, newTrack.Title, newTrack.FilePath, newTrack.CoverArtPath, m3u8ServePath)

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

		duration, procErr := h.audioProcessor.ProcessToHLS(track.FilePath, m3u8DiskPath, segmentDiskPattern, hlsBaseURL, h.cfg.AudioBitrate, h.cfg.HLSSegmentTime)
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
			duration, durErr := h.audioProcessor.GetAudioDuration(track.FilePath)
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

// UploadCoverHandler 处理封面图片上传
func (h *APIHandler) UploadCoverHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 设置最大文件大小为10MB
	const maxFileSize = 10 << 20 // 10MB
	if err := r.ParseMultipartForm(maxFileSize); err != nil {
		log.Printf("[UploadCover] 解析表单失败: %v", err)
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	// 获取表单数据
	artist := r.FormValue("artist")
	album := r.FormValue("album")
	targetDir := r.FormValue("targetDir") // 获取目标目录
	if artist == "" || album == "" {
		log.Printf("[UploadCover] 缺少必要字段 - Artist: %v, Album: %v", artist != "", album != "")
		http.Error(w, "Artist and album are required", http.StatusBadRequest)
		return
	}

	// 获取封面文件
	file, header, err := r.FormFile("cover")
	if err != nil {
		log.Printf("[UploadCover] 获取文件失败: %v", err)
		http.Error(w, "Failed to get cover file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// 检查文件大小
	if header.Size > maxFileSize {
		log.Printf("[UploadCover] 文件过大: %d bytes", header.Size)
		http.Error(w, "File too large", http.StatusBadRequest)
		return
	}

	// 检查文件类型
	contentType := header.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		log.Printf("[UploadCover] 不支持的文件类型: %s", contentType)
		http.Error(w, "Only image files are allowed", http.StatusBadRequest)
		return
	}

	// 生成安全的文件名
	safeFilename := generateSafeFilenamePrefix(artist, album, "")
	coverFilename := fmt.Sprintf("%s_cover%s", safeFilename, filepath.Ext(header.Filename))

	// 根据目标目录决定存储路径
	var coverPath string
	var servePath string
	if targetDir == "static/cover" {
		// 存储到static/cover目录
		coverPath = filepath.Join(h.cfg.StaticDir, "covers", coverFilename)
		servePath = "/static/covers/" + coverFilename
	} else {
		// 默认存储到上传目录
		coverPath = filepath.Join(h.cfg.CoverUploadDir, coverFilename)
		servePath = "/uploads/covers/" + coverFilename
	}

	// 确保目录存在
	if err := os.MkdirAll(filepath.Dir(coverPath), 0755); err != nil {
		log.Printf("[UploadCover] 创建目录失败: %v", err)
		http.Error(w, "Failed to create directory", http.StatusInternalServerError)
		return
	}

	// 保存封面文件
	destFile, err := os.Create(coverPath)
	if err != nil {
		log.Printf("[UploadCover] 创建文件失败: %v", err)
		http.Error(w, "Failed to save cover file", http.StatusInternalServerError)
		return
	}
	defer destFile.Close()

	// 使用缓冲复制文件
	buf := make([]byte, 32*1024) // 32KB buffer
	_, err = io.CopyBuffer(destFile, file, buf)
	if err != nil {
		log.Printf("[UploadCover] 保存文件失败: %v", err)
		http.Error(w, "Failed to save cover file", http.StatusInternalServerError)
		return
	}

	// 返回封面路径
	response := map[string]string{
		"coverPath": servePath,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
	log.Printf("[UploadCover] 成功上传封面 - Artist: %s, Album: %s, Path: %s", artist, album, coverPath)
}



// UpdateTrackPositionHandler 更新专辑中歌曲的位置
func (h *APIHandler) UpdateTrackPositionHandler(w http.ResponseWriter, r *http.Request) {
	logger.Debug("Handling update track position request",
		logger.String("method", r.Method),
		logger.String("path", r.URL.Path),
	)

	if r.Method != http.MethodPut {
		logger.Warn("Invalid method for update track position",
			logger.String("method", r.Method),
		)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	vars := mux.Vars(r)
	albumID, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		logger.Error("Invalid album ID",
			logger.String("id", vars["id"]),
			logger.ErrorField(err),
		)
		http.Error(w, "Invalid album ID", http.StatusBadRequest)
		return
	}

	trackID, err := strconv.ParseInt(vars["track_id"], 10, 64)
	if err != nil {
		logger.Error("Invalid track ID",
			logger.String("id", vars["track_id"]),
			logger.ErrorField(err),
		)
		http.Error(w, "Invalid track ID", http.StatusBadRequest)
		return
	}

	var req struct {
		NewPosition int `json:"new_position"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		logger.Error("Failed to decode request body",
			logger.ErrorField(err),
		)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	logger.Debug("Updating track position",
		logger.Int64("albumId", albumID),
		logger.Int64("trackId", trackID),
		logger.Int("newPosition", req.NewPosition),
	)

	if err := h.albumRepo.UpdateTrackPosition(r.Context(), albumID, trackID, req.NewPosition); err != nil {
		logger.Error("Failed to update track position",
			logger.Int64("albumId", albumID),
			logger.Int64("trackId", trackID),
			logger.ErrorField(err),
		)
		http.Error(w, "Failed to update track position", http.StatusInternalServerError)
		return
	}

	logger.Info("Track position updated successfully",
		logger.Int64("albumId", albumID),
		logger.Int64("trackId", trackID),
		logger.Int("newPosition", req.NewPosition),
	)
	w.WriteHeader(http.StatusOK)
}
