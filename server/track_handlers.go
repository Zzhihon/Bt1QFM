package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
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
	trackRepo       repository.TrackRepository
	userRepo        repository.UserRepository
	albumRepo       repository.AlbumRepository
	audioProcessor  *audio.FFmpegProcessor
	mp3Processor    *audio.MP3Processor
	streamProcessor *audio.StreamProcessor
	cfg             *config.Config
}

// NewAPIHandler 创建新的API处理器
func NewAPIHandler(
	trackRepo repository.TrackRepository,
	userRepo repository.UserRepository,
	albumRepo repository.AlbumRepository,
	audioProcessor *audio.FFmpegProcessor,
	streamProcessor *audio.StreamProcessor,
	cfg *config.Config,
) *APIHandler {
	return &APIHandler{
		trackRepo:       trackRepo,
		userRepo:        userRepo,
		albumRepo:       albumRepo,
		audioProcessor:  audioProcessor,
		mp3Processor:    audio.NewMP3Processor(audioProcessor.FFmpegPath()),
		streamProcessor: streamProcessor,
		cfg:             cfg,
	}
}

var nonAlphaNumeric = regexp.MustCompile(`[^a-zA-Z0-9_\-\.]`)
var multipleSpaces = regexp.MustCompile(`\s+`)

func generateUniqueSuffix() string {
	b := make([]byte, 4)
	rand.Read(b)
	return hex.EncodeToString(b)
}

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

	// Prevent overly long filenames (e.g., 100 chars max for the prefix)
	maxLength := 100
	if len(base) > maxLength {
		base = base[:maxLength]
	}
	// Ensure it's not empty after sanitization
	if base == "" {
		base = "fallback_filename"
	}

	return base
}

// UploadResult 表示上传操作的结果
type UploadResult struct {
	Success bool
	Error   error
	Path    string
}

// UploadConfig 定义上传配置
type UploadConfig struct {
	MaxFileSize   int64
	AllowedTypes  []string
	MaxConcurrent int
	UploadTimeout time.Duration
	RetryAttempts int
	RetryDelay    time.Duration
}

// DefaultUploadConfig 返回默认的上传配置
func DefaultUploadConfig() *UploadConfig {
	return &UploadConfig{
		MaxFileSize: 100 << 20, // 100MB
		AllowedTypes: []string{
			"audio/mpeg", "audio/mp3",    // MP3
			"audio/wav", "audio/x-wav",   // WAV
			"audio/flac", "audio/x-flac", // FLAC
			"audio/aac",                  // AAC
			"audio/mp4",                  // M4A
		},
		MaxConcurrent: 5,
		UploadTimeout: 5 * time.Minute,
		RetryAttempts: 3,
		RetryDelay:    time.Second,
	}
}

// uploadSemaphore 用于控制并发上传
var uploadSemaphore = make(chan struct{}, DefaultUploadConfig().MaxConcurrent)

// UploadTrackHandler handles audio file uploads and metadata.
func (h *APIHandler) UploadTrackHandler(w http.ResponseWriter, r *http.Request) {
	logger.Info("开始处理上传请求",
		logger.String("method", r.Method),
		logger.String("path", r.URL.Path),
		logger.String("remoteAddr", r.RemoteAddr),
		logger.String("userAgent", r.UserAgent()),
		logger.Int64("contentLength", r.ContentLength),
	)

	config := DefaultUploadConfig()

	// 检查请求大小
	if r.ContentLength > config.MaxFileSize {
		logger.Warn("请求体过大，拒绝处理",
			logger.Int64("contentLength", r.ContentLength),
			logger.Int64("maxSize", config.MaxFileSize))
		http.Error(w, fmt.Sprintf("Request too large. Maximum size is %d MB", config.MaxFileSize>>20), http.StatusRequestEntityTooLarge)
		return
	}

	// 获取信号量，控制并发
	select {
	case uploadSemaphore <- struct{}{}:
		defer func() { <-uploadSemaphore }()
	default:
		logger.Warn("服务器繁忙，拒绝新的上传请求")
		http.Error(w, "Server is busy, please try again later", http.StatusServiceUnavailable)
		return
	}

	if r.Method != http.MethodPost {
		logger.Warn("不支持的请求方法", logger.String("method", r.Method))
		http.Error(w, "Only POST method is allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get user ID from context
	userID, err := GetUserIDFromContext(r.Context())
	if err != nil {
		logger.Error("获取用户ID失败", logger.ErrorField(err))
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	logger.Info("获取用户信息成功", logger.Int64("userId", userID))

	// 解析表单 - 增加超时和错误处理
	parseStart := time.Now()
	logger.Info("开始解析表单",
		logger.Int64("contentLength", r.ContentLength),
		logger.String("contentType", r.Header.Get("Content-Type")))

	// 创建带超时的上下文
	parseCtx, cancel := context.WithTimeout(r.Context(), config.UploadTimeout)
	defer cancel()

	// 使用通道来处理解析操作，以便能够应用超时
	parseResult := make(chan error, 1)
	go func() {
		// 设置较大的内存限制来处理大文件
		err := r.ParseMultipartForm(config.MaxFileSize)
		parseResult <- err
	}()

	// 等待解析完成或超时
	select {
	case err := <-parseResult:
		if err != nil {
			// 检查是否是网络相关错误
			if strings.Contains(err.Error(), "i/o timeout") ||
				strings.Contains(err.Error(), "read tcp") ||
				strings.Contains(err.Error(), "connection reset") {
				logger.Error("网络连接问题导致表单解析失败",
					logger.ErrorField(err),
					logger.String("remoteAddr", r.RemoteAddr),
					logger.Int64("contentLength", r.ContentLength),
					logger.Duration("parseTime", time.Since(parseStart)))
				http.Error(w, "Network connection issue. Please check your connection and try again.", http.StatusRequestTimeout)
				return
			}

			// 检查是否是请求体过大的问题
			if strings.Contains(err.Error(), "request body too large") ||
				strings.Contains(err.Error(), "multipart message too large") {
				logger.Error("请求体过大导致表单解析失败",
					logger.ErrorField(err),
					logger.Int64("contentLength", r.ContentLength),
					logger.Int64("maxSize", config.MaxFileSize))
				http.Error(w, fmt.Sprintf("File too large. Maximum size is %d MB", config.MaxFileSize>>20), http.StatusRequestEntityTooLarge)
				return
			}

			logger.Error("解析表单失败",
				logger.ErrorField(err),
				logger.String("remoteAddr", r.RemoteAddr),
				logger.Int64("contentLength", r.ContentLength),
				logger.Duration("parseTime", time.Since(parseStart)))
			http.Error(w, "Failed to parse upload form. Please check your file and try again.", http.StatusBadRequest)
			return
		}
	case <-parseCtx.Done():
		logger.Error("表单解析超时",
			logger.String("remoteAddr", r.RemoteAddr),
			logger.Int64("contentLength", r.ContentLength),
			logger.Duration("timeout", config.UploadTimeout),
			logger.Duration("elapsed", time.Since(parseStart)))
		http.Error(w, "Upload timeout. Please try with a smaller file or check your connection.", http.StatusRequestTimeout)
		return
	}

	logger.Info("解析表单完成",
		logger.Duration("耗时", time.Since(parseStart)),
		logger.Int64("contentLength", r.ContentLength))

	// 获取并验证音频文件
	validateStart := time.Now()
	trackFile, trackHeader, err := r.FormFile("trackFile")
	if err != nil {
		logger.Error("获取音频文件失败",
			logger.ErrorField(err),
			logger.String("remoteAddr", r.RemoteAddr))
		if err == http.ErrMissingFile {
			http.Error(w, "Missing audio file. Please select a file to upload.", http.StatusBadRequest)
		} else {
			http.Error(w, "Failed to process uploaded file.", http.StatusBadRequest)
		}
		return
	}
	defer trackFile.Close()

	// 验证文件大小
	if trackHeader.Size > config.MaxFileSize {
		logger.Warn("文件过大",
			logger.Int64("size", trackHeader.Size),
			logger.Int64("maxSize", config.MaxFileSize),
			logger.String("filename", trackHeader.Filename))
		http.Error(w, fmt.Sprintf("File too large. Maximum size is %d MB", config.MaxFileSize>>20), http.StatusBadRequest)
		return
	}

	// 验证文件类型
	contentType := trackHeader.Header.Get("Content-Type")
	validType := false
	for _, t := range config.AllowedTypes {
		if contentType == t {
			validType = true
			break
		}
	}
	if !validType {
		logger.Warn("不支持的文件类型",
			logger.String("contentType", contentType),
			logger.String("filename", trackHeader.Filename))
		http.Error(w, "Invalid file type. Supported formats: MP3, WAV, FLAC, AAC, M4A.", http.StatusBadRequest)
		return
	}
	logger.Info("文件验证完成",
		logger.Duration("耗时", time.Since(validateStart)),
		logger.Int64("fileSize", trackHeader.Size),
		logger.String("contentType", contentType),
		logger.String("filename", trackHeader.Filename))

	// 获取其他表单数据
	title := r.FormValue("title")
	if title == "" {
		logger.Warn("缺少标题字段")
		http.Error(w, "Missing 'title' in form", http.StatusBadRequest)
		return
	}
	artist := r.FormValue("artist")
	album := r.FormValue("album")
	logger.Info("获取元数据完成",
		logger.String("title", title),
		logger.String("artist", artist),
		logger.String("album", album))

	// 生成安全的文件名
	generateStart := time.Now()
	safeBaseFilename := generateSafeFilenamePrefix(title, artist, album)
	trackFileExt := filepath.Ext(trackHeader.Filename)
	if trackFileExt == "" {
		trackFileExt = ".dat"
	}
	trackStoreFileName := safeBaseFilename + trackFileExt

	// 设置文件路径
	minioTrackPath := "audio/" + trackStoreFileName
	trackFilePath := "/static/audio/" + trackStoreFileName
	logger.Info("生成文件名完成",
		logger.Duration("耗时", time.Since(generateStart)),
		logger.String("safeFilename", safeBaseFilename),
		logger.String("minioPath", minioTrackPath))

	// 处理封面图片（如果存在）
	var coverArtServePath string
	coverFile, coverHeader, err := r.FormFile("coverFile")
	if err == nil {
		defer coverFile.Close()

		// 验证封面文件
		if coverHeader.Size > 10<<20 { // 10MB
			logger.Warn("封面文件过大", logger.Int64("size", coverHeader.Size))
			http.Error(w, "Cover file too large", http.StatusBadRequest)
			return
		}

		coverContentType := coverHeader.Header.Get("Content-Type")
		if !strings.HasPrefix(coverContentType, "image/") {
			logger.Warn("不支持的封面文件类型", logger.String("contentType", coverContentType))
			http.Error(w, "Invalid cover file type", http.StatusBadRequest)
			return
		}

		coverFileExt := filepath.Ext(coverHeader.Filename)
		if coverFileExt == "" {
			coverFileExt = ".jpg"
		}
		coverStoreFileName := safeBaseFilename + coverFileExt
		minioCoverPath := "covers/" + coverStoreFileName
		coverArtServePath = "/static/covers/" + coverStoreFileName

		// 上传封面到MinIO
		if err := h.uploadFileToMinio(coverFile, minioCoverPath, coverContentType); err != nil {
			logger.Error("上传封面到MinIO失败", logger.ErrorField(err))
			http.Error(w, "Failed to upload cover to MinIO", http.StatusInternalServerError)
			return
		}
		logger.Info("封面文件上传成功", logger.String("path", minioCoverPath))
	} else if err != http.ErrMissingFile {
		logger.Error("处理封面文件失败", logger.ErrorField(err))
		http.Error(w, fmt.Sprintf("Error processing cover file: %v", err), http.StatusBadRequest)
		return
	}

	// 开始数据库事务
	dbStart := time.Now()
	tx, err := h.trackRepo.BeginTx()
	if err != nil {
		logger.Error("开始数据库事务失败", logger.ErrorField(err))
		http.Error(w, fmt.Sprintf("Failed to begin transaction: %v", err), http.StatusInternalServerError)
		return
	}
	defer h.trackRepo.RollbackTx(tx)

	// 创建track记录
	newTrack := &model.Track{
		UserID:       userID,
		Title:        title,
		Artist:       artist,
		Album:        album,
		FilePath:     trackFilePath,
		CoverArtPath: coverArtServePath,
		Status:       "processing", // 添加状态字段
		Source:       "library",    // 标记来源为library
	}

	// 在事务中创建曲目
	trackID, err := h.trackRepo.CreateTrackWithTx(tx, newTrack)
	if err != nil {
		logger.Error("创建曲目记录失败",
			logger.ErrorField(err),
			logger.Int64("userId", userID))
		if strings.Contains(strings.ToLower(err.Error()), "unique constraint") || strings.Contains(strings.ToLower(err.Error()), "duplicate entry") {
			http.Error(w, fmt.Sprintf("Failed to create track: A track with a similar name or file path already exists for your account. Original error: %v", err), http.StatusConflict)
		} else {
			http.Error(w, fmt.Sprintf("Failed to create track entry in database: %v", err), http.StatusInternalServerError)
		}
		return
	}
	newTrack.ID = trackID
	logger.Info("创建曲目记录成功",
		logger.Int64("trackId", trackID),
		logger.Duration("耗时", time.Since(dbStart)))

	// 提交事务
	commitStart := time.Now()
	if err := h.trackRepo.CommitTx(tx); err != nil {
		logger.Error("提交事务失败", logger.ErrorField(err))
		http.Error(w, fmt.Sprintf("Failed to commit transaction: %v", err), http.StatusInternalServerError)
		return
	}
	logger.Info("事务提交成功", logger.Duration("耗时", time.Since(commitStart)))

	// 立即返回响应
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Track upload started",
		"trackId": trackID,
		"track":   newTrack,
	})

	// 将文件内容读取到缓冲区，避免文件关闭后无法读取
	fileBuffer := &bytes.Buffer{}
	if _, err := io.Copy(fileBuffer, trackFile); err != nil {
		logger.Error("读取文件到缓冲区失败",
			logger.ErrorField(err),
			logger.Int64("trackId", trackID))
		h.trackRepo.UpdateTrackStatus(trackID, "failed")
		return
	}

	// 启动异步处理
	go func() {
		// 处理音频文件上传
		if err := h.processAudioFileAsync(fileBuffer, trackHeader, minioTrackPath, contentType, trackID, safeBaseFilename); err != nil {
			logger.Error("异步处理音频文件失败",
				logger.ErrorField(err),
				logger.Int64("trackId", trackID))
			// 更新track状态为失败
			h.trackRepo.UpdateTrackStatus(trackID, "failed")
			return
		}
		// 更新track状态为完成
		h.trackRepo.UpdateTrackStatus(trackID, "completed")
	}()
}

// processAudioFileAsync 异步处理音频文件
func (h *APIHandler) processAudioFileAsync(fileBuffer *bytes.Buffer, trackHeader *multipart.FileHeader, minioTrackPath, contentType string, trackID int64, safeBaseFilename string) error {
	// 创建临时文件
	tempFile, err := os.CreateTemp("", "upload-*")
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %v", err)
	}
	tempFilePath := tempFile.Name()

	// 延迟删除临时文件（300秒后）
	go func(filePath string) {
		time.Sleep(300 * time.Second)
		if err := os.Remove(filePath); err != nil {
			logger.Warn("删除临时文件失败",
				logger.String("path", filePath),
				logger.ErrorField(err))
		} else {
			logger.Info("临时文件已清理", logger.String("path", filePath))
		}
	}(tempFilePath)

	defer tempFile.Close()

	// 将缓冲区内容写入临时文件
	if _, err := io.Copy(tempFile, fileBuffer); err != nil {
		return fmt.Errorf("写入缓冲区到临时文件失败: %v", err)
	}

	// 重置文件指针
	if _, err := tempFile.Seek(0, 0); err != nil {
		return fmt.Errorf("重置文件指针失败: %v", err)
	}


	// 使用共享的流处理器处理音频（避免每次创建新实例）
	streamID := strconv.FormatInt(trackID, 10)

	// 重置文件指针以供流处理使用
	if _, err := tempFile.Seek(0, 0); err != nil {
		return fmt.Errorf("重置文件指针失败: %v", err)
	}

	// 启动流处理
	if err := h.streamProcessor.StreamProcess(context.Background(), streamID, tempFilePath, false); err != nil {
		logger.Error("流处理失败",
			logger.Int64("trackId", trackID),
			logger.ErrorField(err))
		return fmt.Errorf("流处理失败: %v", err)
	}

	// 生成HLS流
	hlsStreamDir := filepath.Join("streams", safeBaseFilename)
	m3u8ServePath := "/static/" + strings.ReplaceAll(filepath.ToSlash(hlsStreamDir), "\\", "/") + "/playlist.m3u8"

	// 更新数据库中的HLS路径
	if err := h.trackRepo.UpdateTrackHLSPath(trackID, m3u8ServePath, 0); err != nil {
		logger.Error("更新HLS路径失败",
			logger.ErrorField(err),
			logger.Int64("trackId", trackID),
			logger.String("path", m3u8ServePath))
		return fmt.Errorf("更新HLS路径失败: %v", err)
	}

	return nil
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

	// 获取includeAlbum参数（是否包含专辑来源的tracks）
	includeAlbum := r.URL.Query().Get("includeAlbum") == "true"

	tracks, err := h.trackRepo.GetAllTracksByUserID(userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to retrieve tracks for user %d: %v", userID, err), http.StatusInternalServerError)
		return
	}

	// 根据includeAlbum参数过滤
	if !includeAlbum {
		filteredTracks := make([]*model.Track, 0)
		for _, track := range tracks {
			if track.Source == "library" || track.Source == "" {
				filteredTracks = append(filteredTracks, track)
			}
		}
		tracks = filteredTracks
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tracks)
}

// StreamHandler serves the HLS playlist for a given track ID.

// UploadCoverHandler 处理封面图片上传
func (h *APIHandler) UploadCoverHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	const maxFileSize = 10 << 20 // 10MB
	if err := r.ParseMultipartForm(maxFileSize); err != nil {
		logger.Error("解析表单失败", logger.ErrorField(err))
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	artist := r.FormValue("artist")
	album := r.FormValue("album")
	if artist == "" || album == "" {
		logger.Warn("缺少必要字段",
			logger.Bool("hasArtist", artist != ""),
			logger.Bool("hasAlbum", album != ""))
		http.Error(w, "Artist and album are required", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("cover")
	if err != nil {
		logger.Error("获取文件失败", logger.ErrorField(err))
		http.Error(w, "Failed to get cover file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	if header.Size > maxFileSize {
		logger.Warn("文件过大", logger.Int64("size", header.Size))
		http.Error(w, "File too large", http.StatusBadRequest)
		return
	}

	contentType := header.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		logger.Warn("不支持的文件类型", logger.String("contentType", contentType))
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
		logger.Error("上传到MinIO失败", logger.ErrorField(err))
		http.Error(w, "Failed to upload cover to MinIO", http.StatusInternalServerError)
		return
	}

	response := map[string]string{
		"coverPath": servePath,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
	logger.Info("封面上传成功",
		logger.String("artist", artist),
		logger.String("album", album),
		logger.String("path", minioCoverPath))
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

// downloadFileFromMinio 从MinIO下载文件到本地
func (h *APIHandler) downloadFileFromMinio(objectPath, localPath string) error {
	client := storage.GetMinioClient()
	if client == nil {
		return fmt.Errorf("MinIO client not initialized")
	}

	cfg := config.Load()
	// 增加超时时间到5分钟，适应大文件下载
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	logger.Info("开始从MinIO下载文件",
		logger.String("objectPath", objectPath),
		logger.String("localPath", localPath))

	// 获取文件信息
	stat, err := client.StatObject(ctx, cfg.MinioBucket, objectPath, minio.StatObjectOptions{})
	if err != nil {
		return fmt.Errorf("failed to get object stat from MinIO: %v", err)
	}
	logger.Info("文件信息",
		logger.Int64("size", stat.Size),
		logger.Float64("sizeMB", float64(stat.Size)/(1024*1024)))

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

	// 使用更大的缓冲区进行复制，并添加进度监控
	buffer := make([]byte, 1024*1024) // 1MB缓冲区
	var totalBytes int64
	startTime := time.Now()

	for {
		n, readErr := object.Read(buffer)
		if n > 0 {
			written, writeErr := localFile.Write(buffer[:n])
			if writeErr != nil {
				return fmt.Errorf("failed to write to local file: %v", writeErr)
			}
			totalBytes += int64(written)

			// 每10MB记录一次进度
			if totalBytes%(10*1024*1024) == 0 || (totalBytes > 0 && totalBytes%1024*1024 < int64(n)) {
				elapsed := time.Since(startTime)
				progress := float64(totalBytes) / float64(stat.Size) * 100
				speed := float64(totalBytes) / elapsed.Seconds() / (1024 * 1024) // MB/s
				logger.Info("下载进度",
					logger.Float64("progress", progress),
					logger.Int64("totalBytes", totalBytes),
					logger.Int64("fileSize", stat.Size),
					logger.Float64("speed", speed))
			}
		}

		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return fmt.Errorf("failed to read from MinIO: %v", readErr)
		}

		// 检查上下文是否已取消
		select {
		case <-ctx.Done():
			return fmt.Errorf("download cancelled: %v", ctx.Err())
		default:
		}
	}

	elapsed := time.Since(startTime)
	avgSpeed := float64(totalBytes) / elapsed.Seconds() / (1024 * 1024)
	logger.Info("下载完成",
		logger.Int64("totalBytes", totalBytes),
		logger.Duration("elapsed", elapsed),
		logger.Float64("avgSpeed", avgSpeed))

	return nil
}

// RegisterRoutes 注册API路由
func (h *APIHandler) RegisterRoutes(router *mux.Router) {
	// 音轨相关路由
	router.HandleFunc("/tracks", h.UploadTrackHandler).Methods(http.MethodPost)
	router.HandleFunc("/tracks", h.GetTracksHandler).Methods(http.MethodGet)
	router.HandleFunc("/tracks/{id}", h.DeleteTrackHandler).Methods(http.MethodDelete)

	// 封面上传路由
	router.HandleFunc("/upload/cover", h.UploadCoverHandler).Methods(http.MethodPost)

	// 更新音轨顺序
	router.HandleFunc("/albums/{id}/tracks/{track_id}/position", h.UpdateTrackPositionHandler).Methods(http.MethodPut)

	// 静态文件服务（MinIO）
	router.PathPrefix("/static/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		objectPath := strings.TrimPrefix(r.URL.Path, "/static/")
		client := storage.GetMinioClient()
		if client == nil {
			http.Error(w, "MinIO client not available", http.StatusInternalServerError)
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		object, err := client.GetObject(ctx, h.cfg.MinioBucket, objectPath, minio.GetObjectOptions{})
		if err != nil {
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
		defer object.Close()

		var contentType string
		if strings.HasPrefix(objectPath, "covers/") {
			contentType = "image/jpeg"
		} else if strings.HasPrefix(objectPath, "audio/") {
			contentType = "audio/mpeg"
		} else {
			contentType = "application/octet-stream"
		}

		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Cache-Control", "public, max-age=31536000") // 缓存一年

		_, err = io.Copy(w, object)
		if err != nil {
			logger.Error("Error serving file from MinIO", logger.ErrorField(err))
		}
	})
}

// DeleteTrackHandler 软删除track（设置state=0）
func (h *APIHandler) DeleteTrackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 获取用户ID
	userID, err := GetUserIDFromContext(r.Context())
	if err != nil {
		logger.Error("获取用户ID失败", logger.ErrorField(err))
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// 获取track ID
	vars := mux.Vars(r)
	trackID, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		logger.Error("Invalid track ID",
			logger.String("id", vars["id"]),
			logger.ErrorField(err))
		http.Error(w, "Invalid track ID", http.StatusBadRequest)
		return
	}

	// 验证track是否属于当前用户
	track, err := h.trackRepo.GetTrackByID(trackID)
	if err != nil {
		logger.Error("获取track失败",
			logger.Int64("trackId", trackID),
			logger.ErrorField(err))
		http.Error(w, "Failed to get track", http.StatusInternalServerError)
		return
	}

	if track == nil {
		http.Error(w, "Track not found", http.StatusNotFound)
		return
	}

	if track.UserID != userID {
		logger.Warn("用户尝试删除不属于自己的track",
			logger.Int64("userId", userID),
			logger.Int64("trackId", trackID),
			logger.Int64("trackUserId", track.UserID))
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// 软删除track（设置state=0）
	if err := h.trackRepo.UpdateTrackState(trackID, 0); err != nil {
		logger.Error("软删除track失败",
			logger.Int64("trackId", trackID),
			logger.ErrorField(err))
		http.Error(w, "Failed to delete track", http.StatusInternalServerError)
		return
	}

	logger.Info("Track软删除成功",
		logger.Int64("trackId", trackID),
		logger.Int64("userId", userID))

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Track deleted successfully",
	})
}
