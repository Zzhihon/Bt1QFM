package server

import (
	"bytes"
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
	"time"

	"Bt1QFM/config"
	"Bt1QFM/core/audio"
	"Bt1QFM/logger"
	"Bt1QFM/model"
	"Bt1QFM/repository"
	"Bt1QFM/storage"

	"github.com/gorilla/mux"
	"github.com/minio/minio-go/v7"
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
	
	// MinIO路径：audio/文件名
	minioTrackPath := "audio/" + trackStoreFileName
	// 数据库存储路径（保持原格式，前端通过这个路径访问）
	trackFilePath := "/static/audio/" + trackStoreFileName

	// Handle cover art (optional)
	var coverArtServePath string
	var coverFile multipart.File
	var coverHeader *multipart.FileHeader

	coverFile, coverHeader, err = r.FormFile("coverFile")
	if err == nil {
		defer coverFile.Close()
		coverFileExt := filepath.Ext(coverHeader.Filename)
		if coverFileExt == "" {
			coverFileExt = ".jpg"
		}
		coverStoreFileName := safeBaseFilename + coverFileExt
		// MinIO路径：covers/文件名
		minioCoverPath := "covers/" + coverStoreFileName
		coverArtServePath = "/static/covers/" + coverStoreFileName

		// Upload cover to MinIO
		if err := h.uploadFileToMinio(coverFile, minioCoverPath, "image/jpeg"); err != nil {
			http.Error(w, fmt.Sprintf("Failed to upload cover to MinIO: %v", err), http.StatusInternalServerError)
			return
		}
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
		FilePath:     trackFilePath,
		CoverArtPath: coverArtServePath,
	}

	trackID, err := h.trackRepo.CreateTrack(newTrack)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique constraint") || strings.Contains(strings.ToLower(err.Error()), "duplicate entry") {
			http.Error(w, fmt.Sprintf("Failed to create track: A track with a similar name or file path already exists for your account. Original error: %v", err), http.StatusConflict)
		} else {
			http.Error(w, fmt.Sprintf("Failed to create track entry in database: %v", err), http.StatusInternalServerError)
		}
		return
	}
	newTrack.ID = trackID

	// Upload track file to MinIO
	if err := h.uploadFileToMinio(trackFile, minioTrackPath, "audio/mpeg"); err != nil {
		log.Printf("Error uploading track file %s to MinIO after DB entry: %v. DB entry ID: %d needs cleanup.", minioTrackPath, err, trackID)
		http.Error(w, fmt.Sprintf("Failed to upload track file: %v. Database entry created but file upload failed.", err), http.StatusInternalServerError)
		return
	}

	// 生成 HLS 播放列表路径
	safeStreamDirName := generateSafeFilenamePrefix(title, artist, album)
	hlsStreamDir := filepath.Join("streams", safeStreamDirName)
	m3u8ServePath := "/static/" + strings.ReplaceAll(filepath.ToSlash(hlsStreamDir), "\\", "/") + "/playlist.m3u8"

	// 更新数据库中的 HLS 播放列表路径
	if err := h.trackRepo.UpdateTrackHLSPath(trackID, m3u8ServePath, 0); err != nil {
		log.Printf("Warning: Failed to update HLS path in database: %v", err)
	}

	log.Printf("Successfully uploaded and saved track: ID %d, UserID: %d, Title '%s', MinIO Path '%s', Cover '%s', HLS '%s'",
		trackID, newTrack.UserID, newTrack.Title, minioTrackPath, newTrack.CoverArtPath, m3u8ServePath)

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"message": "Track uploaded successfully", "trackId": trackID, "track": newTrack})
}

// uploadFileToMinio 上传文件到MinIO
func (h *APIHandler) uploadFileToMinio(file multipart.File, objectPath, contentType string) error {
	client := storage.GetMinioClient()
	if client == nil {
		return fmt.Errorf("MinIO client not initialized")
	}

	cfg := config.Load()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 重置文件指针到开始位置
	if seeker, ok := file.(io.Seeker); ok {
		seeker.Seek(0, io.SeekStart)
	}

	// 读取文件内容到缓冲区
	buffer := &bytes.Buffer{}
	size, err := io.Copy(buffer, file)
	if err != nil {
		return fmt.Errorf("failed to read file: %v", err)
	}

	opts := minio.PutObjectOptions{
		ContentType:      contentType,
		DisableMultipart: true,
	}

	_, err = client.PutObject(ctx, cfg.MinioBucket, objectPath, bytes.NewReader(buffer.Bytes()), size, opts)
	if err != nil {
		return fmt.Errorf("failed to upload to MinIO: %v", err)
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

	// MinIO中的音频文件路径
	minioAudioPath := "audio/" + generateSafeFilenamePrefix(track.Title, track.Artist, track.Album) + filepath.Ext(track.FilePath)
	// MinIO中的HLS流目录
	minioHLSDir := "streams/" + safeStreamDirName
	// 临时本地HLS处理目录
	localHLSDir := filepath.Join(h.cfg.StaticDir, "streams", safeStreamDirName)
	m3u8LocalPath := filepath.Join(localHLSDir, "playlist.m3u8")
	segmentLocalPattern := filepath.Join(localHLSDir, "segment_%03d.ts")
	hlsBaseURL := "/static/streams/" + safeStreamDirName + "/"
	m3u8ServePath := "/static/streams/" + safeStreamDirName + "/playlist.m3u8"

	// 检查MinIO中是否已存在HLS播放列表
	client := storage.GetMinioClient()
	cfg := config.Load()
	ctx := context.Background()
	
	minioM3U8Path := minioHLSDir + "/playlist.m3u8"
	_, err = client.StatObject(ctx, cfg.MinioBucket, minioM3U8Path, minio.StatObjectOptions{})
	hlsExistsInMinio := err == nil

	if !hlsExistsInMinio {
		log.Printf("HLS playlist not found in MinIO for track ID %d (%s). Generating...", trackID, safeStreamDirName)

		// 确保本地临时目录存在
		if err := os.MkdirAll(localHLSDir, 0755); err != nil {
			http.Error(w, fmt.Sprintf("Failed to create local HLS directory for track %d: %v", trackID, err), http.StatusInternalServerError)
			return
		}

		// 从MinIO下载原始音频文件到临时位置
		tempAudioPath := filepath.Join(h.cfg.StaticDir, "temp", safeStreamDirName+filepath.Ext(track.FilePath))
		if err := os.MkdirAll(filepath.Dir(tempAudioPath), 0755); err != nil {
			http.Error(w, fmt.Sprintf("Failed to create temp directory: %v", err), http.StatusInternalServerError)
			return
		}

		// 从MinIO下载音频文件
		err = h.downloadFileFromMinio(minioAudioPath, tempAudioPath)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to download audio from MinIO: %v", err), http.StatusInternalServerError)
			return
		}
		defer os.Remove(tempAudioPath) // 清理临时文件

		// 使用临时文件进行HLS转码
		duration, procErr := h.audioProcessor.ProcessToHLS(tempAudioPath, m3u8LocalPath, segmentLocalPattern, hlsBaseURL, h.cfg.AudioBitrate, h.cfg.HLSSegmentTime)
		if procErr != nil {
			http.Error(w, fmt.Sprintf("Failed to process audio to HLS for track %d: %v", trackID, procErr), http.StatusInternalServerError)
			return
		}

		// 上传HLS文件到MinIO
		if err := h.uploadHLSToMinio(localHLSDir, minioHLSDir); err != nil {
			log.Printf("Warning: Failed to upload HLS files to MinIO: %v", err)
		}

		// 更新数据库
		if err := h.trackRepo.UpdateTrackHLSPath(trackID, m3u8ServePath, duration); err != nil {
			log.Printf("Error updating HLS path for track ID %d in DB: %v. Continuing anyway.", trackID, err)
		}
		track.HLSPlaylistPath = m3u8ServePath
		track.Duration = duration

		// 清理本地HLS文件
		defer os.RemoveAll(localHLSDir)
	}

	// 从MinIO提供M3U8文件
	object, err := client.GetObject(ctx, cfg.MinioBucket, minioM3U8Path, minio.GetObjectOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get HLS playlist from MinIO: %v", err), http.StatusInternalServerError)
		return
	}
	defer object.Close()

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	
	_, err = io.Copy(w, object)
	if err != nil {
		log.Printf("Error serving HLS playlist: %v", err)
	}
	
	log.Printf("Served HLS playlist from MinIO for track ID %d (%s)", trackID, safeStreamDirName)
}

// downloadFileFromMinio 从MinIO下载文件到本地
func (h *APIHandler) downloadFileFromMinio(objectPath, localPath string) error {
	client := storage.GetMinioClient()
	if client == nil {
		return fmt.Errorf("MinIO client not initialized")
	}

	cfg := config.Load()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	object, err := client.GetObject(ctx, cfg.MinioBucket, objectPath, minio.GetObjectOptions{})
	if err != nil {
		return fmt.Errorf("failed to get object from MinIO: %v", err)
	}
	defer object.Close()

	localFile, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("failed to create local file: %v", err)
	}
	defer localFile.Close()

	_, err = io.Copy(localFile, object)
	if err != nil {
		return fmt.Errorf("failed to copy file: %v", err)
	}

	return nil
}

// uploadHLSToMinio 上传HLS文件到MinIO
func (h *APIHandler) uploadHLSToMinio(localDir, minioDir string) error {
	client := storage.GetMinioClient()
	if client == nil {
		return fmt.Errorf("MinIO client not initialized")
	}

	cfg := config.Load()
	ctx := context.Background()

	return filepath.Walk(localDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		relPath, err := filepath.Rel(localDir, path)
		if err != nil {
			return err
		}

		minioPath := minioDir + "/" + strings.ReplaceAll(relPath, "\\", "/")

		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()

		var contentType string
		if strings.HasSuffix(path, ".m3u8") {
			contentType = "application/vnd.apple.mpegurl"
		} else if strings.HasSuffix(path, ".ts") {
			contentType = "video/MP2T"
		} else {
			contentType = "application/octet-stream"
		}

		opts := minio.PutObjectOptions{
			ContentType:      contentType,
			DisableMultipart: true,
		}

		_, err = client.PutObject(ctx, cfg.MinioBucket, minioPath, file, info.Size(), opts)
		if err != nil {
			return fmt.Errorf("failed to upload %s to MinIO: %v", minioPath, err)
		}

		log.Printf("Uploaded HLS file to MinIO: %s", minioPath)
		return nil
	})
}

// UploadCoverHandler 处理封面图片上传
func (h *APIHandler) UploadCoverHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	const maxFileSize = 10 << 20 // 10MB
	if err := r.ParseMultipartForm(maxFileSize); err != nil {
		log.Printf("[UploadCover] 解析表单失败: %v", err)
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	artist := r.FormValue("artist")
	album := r.FormValue("album")
	if artist == "" || album == "" {
		log.Printf("[UploadCover] 缺少必要字段 - Artist: %v, Album: %v", artist != "", album != "")
		http.Error(w, "Artist and album are required", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("cover")
	if err != nil {
		log.Printf("[UploadCover] 获取文件失败: %v", err)
		http.Error(w, "Failed to get cover file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	if header.Size > maxFileSize {
		log.Printf("[UploadCover] 文件过大: %d bytes", header.Size)
		http.Error(w, "File too large", http.StatusBadRequest)
		return
	}

	contentType := header.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		log.Printf("[UploadCover] 不支持的文件类型: %s", contentType)
		http.Error(w, "Only image files are allowed", http.StatusBadRequest)
		return
	}

	safeFilename := generateSafeFilenamePrefix(artist, album, "")
	coverFilename := fmt.Sprintf("%s_cover%s", safeFilename, filepath.Ext(header.Filename))

	// MinIO路径和服务路径
	minioCoverPath := "covers/" + coverFilename
	servePath := "/static/covers/" + coverFilename

	// 上传到MinIO
	if err := h.uploadFileToMinio(file, minioCoverPath, contentType); err != nil {
		log.Printf("[UploadCover] 上传到MinIO失败: %v", err)
		http.Error(w, "Failed to upload cover to MinIO", http.StatusInternalServerError)
		return
	}

	response := map[string]string{
		"coverPath": servePath,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
	log.Printf("[UploadCover] 成功上传封面到MinIO - Artist: %s, Album: %s, Path: %s", artist, album, minioCoverPath)
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
