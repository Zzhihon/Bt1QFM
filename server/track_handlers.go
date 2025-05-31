package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
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
	mp3Processor   *audio.MP3Processor
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
		mp3Processor:   audio.NewMP3Processor(audioProcessor.FFmpegPath()),
		cfg:            cfg,
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
		MaxFileSize:   100 << 20, // 100MB
		AllowedTypes:  []string{"audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp3"},
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
	)

	config := DefaultUploadConfig()

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

	// 解析表单
	parseStart := time.Now()
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		logger.Error("解析表单失败", logger.ErrorField(err))
		http.Error(w, fmt.Sprintf("Failed to parse multipart form: %v", err), http.StatusBadRequest)
		return
	}
	logger.Info("解析表单完成", logger.Duration("耗时", time.Since(parseStart)))

	// 获取并验证音频文件
	validateStart := time.Now()
	trackFile, trackHeader, err := r.FormFile("trackFile")
	if err != nil {
		logger.Error("获取音频文件失败", logger.ErrorField(err))
		http.Error(w, "Missing 'trackFile' in form", http.StatusBadRequest)
		return
	}
	defer trackFile.Close()

	// 验证文件大小
	if trackHeader.Size > config.MaxFileSize {
		logger.Warn("文件过大",
			logger.Int64("size", trackHeader.Size),
			logger.Int64("maxSize", config.MaxFileSize))
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
		logger.Warn("不支持的文件类型", logger.String("contentType", contentType))
		http.Error(w, "Invalid file type", http.StatusBadRequest)
		return
	}
	logger.Info("文件验证完成",
		logger.Duration("耗时", time.Since(validateStart)),
		logger.Int64("fileSize", trackHeader.Size),
		logger.String("contentType", contentType))

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

	// 启动异步处理
	go func() {
		// 处理音频文件上传
		if err := h.processAudioFileAsync(trackFile, trackHeader, minioTrackPath, contentType, trackID, safeBaseFilename); err != nil {
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
func (h *APIHandler) processAudioFileAsync(trackFile multipart.File, trackHeader *multipart.FileHeader, minioTrackPath, contentType string, trackID int64, safeBaseFilename string) error {
	// 创建临时文件
	tempFile, err := os.CreateTemp("", "upload-*")
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %v", err)
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// 将上传的文件复制到临时文件
	if _, err := io.Copy(tempFile, trackFile); err != nil {
		return fmt.Errorf("复制文件到临时文件失败: %v", err)
	}

	// 重置文件指针
	if _, err := tempFile.Seek(0, 0); err != nil {
		return fmt.Errorf("重置文件指针失败: %v", err)
	}

	// 上传到MinIO
	client := storage.GetMinioClient()
	if client == nil {
		return fmt.Errorf("MinIO client not initialized")
	}

	opts := minio.PutObjectOptions{
		ContentType:      contentType,
		DisableMultipart: true,
	}

	_, err = client.PutObject(context.Background(), h.cfg.MinioBucket, minioTrackPath, tempFile, trackHeader.Size, opts)
	if err != nil {
		return fmt.Errorf("上传到MinIO失败: %v", err)
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

	tracks, err := h.trackRepo.GetAllTracksByUserID(userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to retrieve tracks for user %d: %v", userID, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tracks)
}

// StreamHandler serves the HLS playlist for a given track ID.
func (h *APIHandler) StreamHandler(w http.ResponseWriter, r *http.Request) {
	log.Printf("===================== 开始处理流请求 =====================")
	log.Printf("请求路径: %s", r.URL.Path)

	if r.Method != http.MethodGet {
		log.Printf("错误：不支持的请求方法: %s", r.Method)
		http.Error(w, "Only GET method is allowed", http.StatusMethodNotAllowed)
		return
	}

	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/stream/"), "/")
	if len(pathParts) < 2 || pathParts[1] != "playlist.m3u8" {
		log.Printf("错误：无效的流URL格式: %s", r.URL.Path)
		http.Error(w, "Invalid stream URL. Expected /stream/{trackID}/playlist.m3u8", http.StatusBadRequest)
		return
	}

	trackIDStr := pathParts[0]
	trackID, err := strconv.ParseInt(trackIDStr, 10, 64)
	if err != nil {
		log.Printf("错误：无效的track ID格式: %s", trackIDStr)
		http.Error(w, "Invalid track ID format", http.StatusBadRequest)
		return
	}
	log.Printf("解析到track ID: %d", trackID)

	// 检查是否正在处理中
	if status := h.mp3Processor.GetProcessingStatus(trackIDStr); status != nil && status.IsProcessing {
		// 检查文件是否已经存在
		client := storage.GetMinioClient()
		cfg := config.Load()
		ctx := context.Background()

		// 获取track信息
		track, err := h.trackRepo.GetTrackByID(trackID)
		if err != nil {
			log.Printf("错误：获取track详情失败: %v", err)
			http.Error(w, fmt.Sprintf("Failed to get track details for ID %d: %v", trackID, err), http.StatusInternalServerError)
			return
		}
		if track == nil {
			log.Printf("错误：找不到track ID: %d", trackID)
			http.Error(w, fmt.Sprintf("Track with ID %d not found", trackID), http.StatusNotFound)
			return
		}

		// 生成安全的目录名
		safeStreamDirName := generateSafeFilenamePrefix(track.Title, track.Artist, track.Album)
		minioM3U8Path := "streams/" + safeStreamDirName + "/playlist.m3u8"

		// 检查文件是否存在
		_, err = client.StatObject(ctx, cfg.MinioBucket, minioM3U8Path, minio.StatObjectOptions{})
		if err == nil {
			// 文件存在，说明处理已经完成，更新状态
			log.Printf("检测到文件已存在，更新处理状态")
			h.mp3Processor.UpdateProcessingStatus(trackIDStr, nil)
		} else {
			// 文件不存在，确实在处理中
			log.Printf("Track %d 正在处理中，请稍后再试", trackID)
			http.Error(w, "Track is being processed, please try again later", http.StatusServiceUnavailable)
			return
		}
	}

	// 设置处理状态
	h.mp3Processor.SetProcessingStatus(trackIDStr, true, nil)
	log.Printf("已设置处理状态为进行中")

	// 在函数结束时更新处理状态
	success := false
	defer func() {
		if !success {
			h.mp3Processor.UpdateProcessingStatus(trackIDStr, fmt.Errorf("streaming failed"))
			log.Printf("处理失败，已更新状态")
		} else {
			h.mp3Processor.UpdateProcessingStatus(trackIDStr, nil)
			log.Printf("处理成功，已更新状态")
		}
	}()

	track, err := h.trackRepo.GetTrackByID(trackID)
	if err != nil {
		log.Printf("错误：获取track详情失败: %v", err)
		http.Error(w, fmt.Sprintf("Failed to get track details for ID %d: %v", trackID, err), http.StatusInternalServerError)
		return
	}
	if track == nil {
		log.Printf("错误：找不到track ID: %d", trackID)
		http.Error(w, fmt.Sprintf("Track with ID %d not found", trackID), http.StatusNotFound)
		return
	}
	log.Printf("获取到track信息: ID=%d, 标题=%s, 艺术家=%s, 专辑=%s", trackID, track.Title, track.Artist, track.Album)

	// Generate safe base filename from track metadata for HLS stream directory
	safeStreamDirName := generateSafeFilenamePrefix(track.Title, track.Artist, track.Album)
	log.Printf("生成的安全目录名: %s", safeStreamDirName)

	// 确保所有路径都使用正斜杠，避免Windows路径分隔符问题
	audioFileName := generateSafeFilenamePrefix(track.Title, track.Artist, track.Album) + filepath.Ext(track.FilePath)
	minioAudioPath := "audio/" + audioFileName
	minioHLSDir := "streams/" + safeStreamDirName
	minioM3U8Path := minioHLSDir + "/playlist.m3u8"
	log.Printf("文件路径信息:")
	log.Printf("- 数据库中的文件路径: %s", track.FilePath)
	log.Printf("- 生成的文件名: %s", audioFileName)
	log.Printf("- MinIO音频路径: %s", minioAudioPath)
	log.Printf("- MinIO HLS目录: %s", minioHLSDir)
	log.Printf("- MinIO M3U8路径: %s", minioM3U8Path)

	// 本地临时处理目录（仅用于HLS转码输出）
	localHLSDir := filepath.Join(h.cfg.StaticDir, "streams", safeStreamDirName)
	m3u8LocalPath := filepath.Join(localHLSDir, "playlist.m3u8")
	segmentLocalPattern := filepath.Join(localHLSDir, "segment_%03d.ts")
	hlsBaseURL := "/static/streams/" + safeStreamDirName + "/"
	m3u8ServePath := "/static/streams/" + safeStreamDirName + "/playlist.m3u8"
	log.Printf("本地路径: HLS目录=%s, M3U8=%s, 分片模式=%s", localHLSDir, m3u8LocalPath, segmentLocalPattern)

	// 检查MinIO中是否已存在HLS播放列表
	client := storage.GetMinioClient()
	cfg := config.Load()
	ctx := context.Background()

	// 首先检查是否存在旧的错误路径格式（包含反斜杠）
	log.Printf("清理可能存在的重复HLS文件...")
	h.cleanupDuplicateHLSFiles(ctx, client, cfg.MinioBucket, safeStreamDirName)

	_, err = client.StatObject(ctx, cfg.MinioBucket, minioM3U8Path, minio.StatObjectOptions{})
	hlsExistsInMinio := err == nil
	log.Printf("HLS播放列表在MinIO中是否存在: %v (路径: %s)", hlsExistsInMinio, minioM3U8Path)

	if !hlsExistsInMinio {
		log.Printf("HLS播放列表未找到，开始生成...")

		// 确保本地临时目录存在（仅用于HLS输出）
		if err := os.MkdirAll(localHLSDir, 0755); err != nil {
			log.Printf("错误：创建本地HLS目录失败: %v", err)
			http.Error(w, fmt.Sprintf("Failed to create local HLS directory for track %d: %v", trackID, err), http.StatusInternalServerError)
			return
		}
		log.Printf("已创建本地HLS目录: %s", localHLSDir)

		// 创建临时音频文件
		tempAudioPath := filepath.Join(h.cfg.StaticDir, "temp", fmt.Sprintf("audio_%d_%s%s", trackID, safeStreamDirName, filepath.Ext(track.FilePath)))
		if err := os.MkdirAll(filepath.Dir(tempAudioPath), 0755); err != nil {
			log.Printf("错误：创建临时目录失败: %v", err)
			http.Error(w, fmt.Sprintf("Failed to create temp directory: %v", err), http.StatusInternalServerError)
			return
		}
		log.Printf("已创建临时音频文件路径: %s", tempAudioPath)

		// 从MinIO下载音频文件到临时位置
		log.Printf("开始从MinIO下载音频文件...")
		err = h.downloadFileFromMinio(minioAudioPath, tempAudioPath)
		if err != nil {
			log.Printf("错误：从MinIO下载音频文件失败: %v", err)
			http.Error(w, fmt.Sprintf("Failed to download audio from MinIO: %v", err), http.StatusInternalServerError)
			return
		}
		log.Printf("成功下载音频文件到: %s", tempAudioPath)

		// 处理音频文件
		log.Printf("开始处理音频文件为HLS格式...")
		duration, procErr := h.mp3Processor.ProcessToHLS(tempAudioPath, m3u8LocalPath, segmentLocalPattern, hlsBaseURL, h.cfg.AudioBitrate, h.cfg.HLSSegmentTime)
		if procErr != nil {
			log.Printf("错误：处理音频文件失败: %v", procErr)
			// 清理临时文件
			os.Remove(tempAudioPath)
			http.Error(w, fmt.Sprintf("Failed to process audio to HLS for track %d: %v", trackID, procErr), http.StatusInternalServerError)
			return
		}
		log.Printf("成功处理音频文件，时长: %f秒", duration)

		// 立即清理临时音频文件
		os.Remove(tempAudioPath)
		log.Printf("已清理临时音频文件")

		// 上传HLS文件到MinIO
		log.Printf("开始上传HLS文件到MinIO...")
		if err := h.uploadHLSToMinioFixed(localHLSDir, minioHLSDir); err != nil {
			log.Printf("警告：上传HLS文件到MinIO失败: %v", err)
		} else {
			log.Printf("成功上传HLS文件到MinIO")
		}

		log.Printf("HLS播放列表路径: %s", minioM3U8Path)

		// 更新数据库
		log.Printf("更新数据库中的HLS路径...")
		if err := h.trackRepo.UpdateTrackHLSPath(trackID, m3u8ServePath, duration); err != nil {
			log.Printf("警告：更新数据库中的HLS路径失败: %v", err)
		} else {
			log.Printf("成功更新数据库中的HLS路径")
		}
		track.HLSPlaylistPath = m3u8ServePath
		track.Duration = duration

		// 清理本地HLS文件
		defer os.RemoveAll(localHLSDir)
		log.Printf("已安排清理本地HLS文件")
	}

	// 从MinIO提供M3U8文件
	log.Printf("开始从MinIO获取M3U8文件...")
	object, err := client.GetObject(ctx, cfg.MinioBucket, minioM3U8Path, minio.GetObjectOptions{})
	if err != nil {
		log.Printf("错误：从MinIO获取M3U8文件失败: %v", err)
		http.Error(w, fmt.Sprintf("Failed to get HLS playlist from MinIO: %v", err), http.StatusInternalServerError)
		return
	}
	defer object.Close()
	log.Printf("成功获取M3U8文件")

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")

	// 使用带缓冲的写入
	buffer := make([]byte, 32*1024) // 32KB buffer
	writeSuccess := true
	for {
		n, readErr := object.Read(buffer)
		if n > 0 {
			if _, writeErr := w.Write(buffer[:n]); writeErr != nil {
				log.Printf("错误：写入响应失败: %v", writeErr)
				writeSuccess = false
				break
			}
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			log.Printf("错误：读取M3U8文件失败: %v", readErr)
			writeSuccess = false
			break
		}
	}

	if writeSuccess {
		success = true
	}

	log.Printf("===================== 流请求处理完成 =====================")
	log.Printf("已提供HLS播放列表: %s", minioM3U8Path)
}

// uploadHLSToMinioFixed 修复版本的HLS上传函数，确保路径格式正确
func (h *APIHandler) uploadHLSToMinioFixed(localDir, minioDir string) error {
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

		// 确保MinIO路径使用正斜杠，避免Windows路径分隔符问题
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

// cleanupDuplicateHLSFiles 清理重复的HLS文件
func (h *APIHandler) cleanupDuplicateHLSFiles(ctx context.Context, client *minio.Client, bucket, safeStreamDirName string) {
	// 检查可能的重复路径格式
	duplicatePaths := []string{
		"streams\\" + safeStreamDirName + "\\", // Windows风格路径
		"streams/" + safeStreamDirName + "/",   // 正确的路径格式
	}

	correctPath := "streams/" + safeStreamDirName + "/"

	for _, dupPath := range duplicatePaths {
		if dupPath == correctPath {
			continue // 跳过正确的路径
		}

		// 列出该路径下的对象
		objectCh := client.ListObjects(ctx, bucket, minio.ListObjectsOptions{
			Prefix:    dupPath,
			Recursive: true,
		})

		var objectsToDelete []string
		for object := range objectCh {
			if object.Err != nil {
				log.Printf("Error listing objects with prefix %s: %v", dupPath, object.Err)
				continue
			}
			objectsToDelete = append(objectsToDelete, object.Key)
		}

		// 删除重复的对象
		if len(objectsToDelete) > 0 {
			log.Printf("Found %d duplicate HLS files with incorrect path format, cleaning up...", len(objectsToDelete))
			for _, objKey := range objectsToDelete {
				err := client.RemoveObject(ctx, bucket, objKey, minio.RemoveObjectOptions{})
				if err != nil {
					log.Printf("Failed to remove duplicate object %s: %v", objKey, err)
				} else {
					log.Printf("Successfully removed duplicate object: %s", objKey)
				}
			}
		}
	}
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
