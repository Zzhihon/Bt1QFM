package audio

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	// "strconv"
	"strings"
	"sync"
	"time"

	"Bt1QFM/cache"
	"Bt1QFM/config"
	"Bt1QFM/logger"
	"Bt1QFM/storage"

	"github.com/minio/minio-go/v7"
)

// StreamProcessor 流处理器
type StreamProcessor struct {
	mp3Processor *MP3Processor
	cfg          *config.Config
	processingMu sync.RWMutex
	processing   map[string]*ProcessingState
}

// ProcessingState 处理状态
type ProcessingState struct {
	IsProcessing bool
	Progress     float64
	Error        error
	StartTime    time.Time
	TempDir      string
	Segments     []string
}

// NewStreamProcessor 创建流处理器
func NewStreamProcessor(mp3Processor *MP3Processor, cfg *config.Config) *StreamProcessor {
	return &StreamProcessor{
		mp3Processor: mp3Processor,
		cfg:          cfg,
		processing:   make(map[string]*ProcessingState),
	}
}

// StreamProcess 处理音频文件，分四个阶段：FFmpeg分片 -> temp存储 -> Redis缓存 -> MinIO持久化
func (sp *StreamProcessor) StreamProcess(ctx context.Context, streamID, inputPath string, isNetease bool) error {
	logger.Info("开始流处理",
		logger.String("streamId", streamID),
		logger.String("inputPath", inputPath),
		logger.Bool("isNetease", isNetease))

	// 检查是否已在处理中
	sp.processingMu.Lock()
	if state, exists := sp.processing[streamID]; exists && state.IsProcessing {
		sp.processingMu.Unlock()
		return fmt.Errorf("stream %s is already being processed", streamID)
	}

	// 设置处理状态
	tempDir := filepath.Join(sp.cfg.StaticDir, "temp", "streams", streamID)
	sp.processing[streamID] = &ProcessingState{
		IsProcessing: true,
		Progress:     0.0,
		StartTime:    time.Now(),
		TempDir:      tempDir,
		Segments:     make([]string, 0),
	}
	sp.processingMu.Unlock()

	// 异步处理
	go func() {
		defer func() {
			sp.processingMu.Lock()
			if state, exists := sp.processing[streamID]; exists {
				state.IsProcessing = false
			}
			sp.processingMu.Unlock()
		}()

		if err := sp.processStream(ctx, streamID, inputPath, tempDir, isNetease); err != nil {
			logger.Error("流处理失败",
				logger.String("streamId", streamID),
				logger.ErrorField(err))

			sp.processingMu.Lock()
			if state, exists := sp.processing[streamID]; exists {
				state.Error = err
			}
			sp.processingMu.Unlock()
		}
	}()

	return nil
}

// StreamProcessSync 同步处理音频文件，等待处理完成后返回
func (sp *StreamProcessor) StreamProcessSync(ctx context.Context, streamID, inputPath string, isNetease bool) error {
	logger.Info("开始同步流处理",
		logger.String("streamId", streamID),
		logger.String("inputPath", inputPath),
		logger.Bool("isNetease", isNetease))

	// 检查是否已在处理中
	sp.processingMu.Lock()
	if state, exists := sp.processing[streamID]; exists && state.IsProcessing {
		sp.processingMu.Unlock()
		return fmt.Errorf("stream %s is already being processed", streamID)
	}

	// 设置处理状态
	tempDir := filepath.Join(sp.cfg.StaticDir, "temp", "streams", streamID)
	sp.processing[streamID] = &ProcessingState{
		IsProcessing: true,
		Progress:     0.0,
		StartTime:    time.Now(),
		TempDir:      tempDir,
		Segments:     make([]string, 0),
	}
	sp.processingMu.Unlock()

	// 同步处理
	defer func() {
		sp.processingMu.Lock()
		if state, exists := sp.processing[streamID]; exists {
			state.IsProcessing = false
		}
		sp.processingMu.Unlock()
	}()

	if err := sp.processStream(ctx, streamID, inputPath, tempDir, isNetease); err != nil {
		logger.Error("同步流处理失败",
			logger.String("streamId", streamID),
			logger.ErrorField(err))

		sp.processingMu.Lock()
		if state, exists := sp.processing[streamID]; exists {
			state.Error = err
		}
		sp.processingMu.Unlock()

		return err
	}

	return nil
}

// processStream 执行实际的流处理
func (sp *StreamProcessor) processStream(ctx context.Context, streamID, inputPath, tempDir string, isNetease bool) error {
	// 验证输入文件是否存在
	if fileInfo, err := os.Stat(inputPath); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("输入文件不存在: %s", inputPath)
		}
		return fmt.Errorf("无法访问输入文件 %s: %w", inputPath, err)
	} else if fileInfo.Size() == 0 {
		return fmt.Errorf("输入文件为空: %s", inputPath)
	} else {
		logger.Info("输入文件验证通过",
			logger.String("streamId", streamID),
			logger.String("inputPath", inputPath),
			logger.Int64("fileSize", fileInfo.Size()))
	}

	// 阶段1：创建临时目录并开始FFmpeg分片处理
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		return fmt.Errorf("创建临时目录失败: %w", err)
	}

	// 设置定时清理（900秒后）
	go func() {
		time.Sleep(900 * time.Second)
		os.RemoveAll(tempDir)
		logger.Info("临时目录已清理", logger.String("streamId", streamID))
	}()

	// 设置HLS输出路径
	outputM3U8 := filepath.Join(tempDir, "playlist.m3u8")
	segmentPattern := filepath.Join(tempDir, "segment_%03d.ts")

	var hlsBaseURL string
	if isNetease {
		hlsBaseURL = fmt.Sprintf("/streams/netease/%s/", streamID)
	} else {
		hlsBaseURL = fmt.Sprintf("/streams/%s/", streamID)
	}

	// 阶段2：实时流式处理，边处理边推送到temp
	logger.Info("开始FFmpeg HLS处理",
		logger.String("streamId", streamID),
		logger.String("inputPath", inputPath),
		logger.String("outputM3U8", outputM3U8))

	// 再次验证文件在FFmpeg处理前是否仍然存在
	if _, err := os.Stat(inputPath); err != nil {
		return fmt.Errorf("FFmpeg处理前文件丢失 %s: %w", inputPath, err)
	}

	duration, err := sp.mp3Processor.ProcessToHLS(inputPath, outputM3U8, segmentPattern, hlsBaseURL, "192k", "4")
	if err != nil {
		return fmt.Errorf("FFmpeg处理失败: %w", err)
	}

	logger.Info("FFmpeg处理完成，temp分片已就绪",
		logger.String("streamId", streamID),
		logger.Float64("duration", float64(duration)))

	// 更新进度 - FFmpeg处理完成，temp文件可用
	sp.processingMu.Lock()
	if state, exists := sp.processing[streamID]; exists {
		state.Progress = 0.7 // temp分片完成70%，可以开始提供服务
	}
	sp.processingMu.Unlock()

	// 阶段3：异步存储分片到Redis（不阻塞主流程）
	go func() {
		logger.Info("开始异步存储分片到Redis",
			logger.String("streamId", streamID))

		if err := sp.storeSegmentsToRedis(streamID, tempDir, isNetease); err != nil {
			logger.Warn("异步存储到Redis失败",
				logger.String("streamId", streamID),
				logger.ErrorField(err))
		} else {
			logger.Info("异步Redis存储完成",
				logger.String("streamId", streamID))

			// 更新进度 - Redis存储完成
			sp.processingMu.Lock()
			if state, exists := sp.processing[streamID]; exists {
				state.Progress = 0.9 // Redis存储完成90%
			}
			sp.processingMu.Unlock()
		}
	}()

	// 阶段4：异步上传到MinIO作为最终备份（不阻塞主流程）
	go func() {
		// 稍微延迟启动MinIO上传，优先处理Redis
		time.Sleep(2 * time.Second)

		logger.Info("开始异步上传到MinIO",
			logger.String("streamId", streamID))

		if err := sp.uploadToMinIO(streamID, tempDir, isNetease); err != nil {
			logger.Warn("异步上传到MinIO失败",
				logger.String("streamId", streamID),
				logger.ErrorField(err))
		} else {
			logger.Info("异步MinIO上传完成",
				logger.String("streamId", streamID))

			// 最终完成
			sp.processingMu.Lock()
			if state, exists := sp.processing[streamID]; exists {
				state.Progress = 1.0
			}
			sp.processingMu.Unlock()
		}
	}()

	logger.Info("主流程处理完成，temp分片已可用",
		logger.String("streamId", streamID),
		logger.Float64("duration", float64(duration)))

	return nil
}

// storeSegmentsToRedis 将分片存储到Redis
func (sp *StreamProcessor) storeSegmentsToRedis(streamID, tempDir string, isNetease bool) error {
	// 存储playlist.m3u8
	m3u8Path := filepath.Join(tempDir, "playlist.m3u8")
	m3u8Data, err := os.ReadFile(m3u8Path)
	if err != nil {
		return fmt.Errorf("读取m3u8文件失败: %w", err)
	}

	cacheKey := fmt.Sprintf("segment:%s:playlist.m3u8", streamID)
	if err := cache.SetSegmentCache(cacheKey, m3u8Data, 1800*time.Second); err != nil {
		return fmt.Errorf("存储m3u8到Redis失败: %w", err)
	}

	// 存储所有.ts分片文件
	segmentFiles, err := filepath.Glob(filepath.Join(tempDir, "*.ts"))
	if err != nil {
		return fmt.Errorf("查找分片文件失败: %w", err)
	}

	for _, segmentFile := range segmentFiles {
		segmentData, err := os.ReadFile(segmentFile)
		if err != nil {
			logger.Warn("读取分片文件失败",
				logger.String("file", segmentFile),
				logger.ErrorField(err))
			continue
		}

		segmentName := filepath.Base(segmentFile)
		cacheKey := fmt.Sprintf("segment:%s:%s", streamID, segmentName)

		if err := cache.SetSegmentCache(cacheKey, segmentData, 1800*time.Second); err != nil {
			logger.Warn("存储分片到Redis失败",
				logger.String("segment", segmentName),
				logger.ErrorField(err))
		}
	}

	logger.Info("分片存储到Redis完成",
		logger.String("streamId", streamID),
		logger.Int("segmentCount", len(segmentFiles)))

	return nil
}

// uploadToMinIO 上传到MinIO
func (sp *StreamProcessor) uploadToMinIO(streamID, tempDir string, isNetease bool) error {
	client := storage.GetMinioClient()
	if client == nil {
		return fmt.Errorf("MinIO客户端未初始化")
	}

	var minioBasePath string
	if isNetease {
		minioBasePath = fmt.Sprintf("streams/netease/%s", streamID)
	} else {
		minioBasePath = fmt.Sprintf("streams/%s", streamID)
	}

	return filepath.Walk(tempDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}

		relPath, err := filepath.Rel(tempDir, path)
		if err != nil {
			return err
		}

		minioPath := minioBasePath + "/" + strings.ReplaceAll(relPath, "\\", "/")

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

		_, err = client.PutObject(context.Background(), sp.cfg.MinioBucket, minioPath, file, info.Size(), opts)
		return err
	})
}

// StreamGet 获取音频分片，优化缓存策略：temp -> Redis -> MinIO
func (sp *StreamProcessor) StreamGet(streamID, fileName string, isNetease bool) ([]byte, string, error) {
	logger.Debug("获取流分片",
		logger.String("streamId", streamID),
		logger.String("fileName", fileName),
		logger.Bool("isNetease", isNetease))

	// 第一级：从temp目录获取（最快，优先级最高）
	tempPath := filepath.Join(sp.cfg.StaticDir, "temp", "streams", streamID, fileName)
	if data, contentType, err := sp.getFromTemp(tempPath, fileName); err == nil {
		logger.Debug("从temp获取成功，立即返回",
			logger.String("streamId", streamID),
			logger.String("fileName", fileName))
		return data, contentType, nil
	}

	logger.Debug("temp目录未找到文件，尝试从缓存获取",
		logger.String("streamId", streamID),
		logger.String("fileName", fileName),
		logger.String("tempPath", tempPath))

	// 第二级：从Redis缓存获取
	cacheKey := fmt.Sprintf("segment:%s:%s", streamID, fileName)
	if data, err := cache.GetSegmentCache(cacheKey); err == nil && len(data) > 0 {
		logger.Debug("从Redis缓存获取成功",
			logger.String("streamId", streamID),
			logger.String("fileName", fileName))
		contentType := sp.getContentType(fileName)
		return data, contentType, nil
	}

	// Redis未命中或获取失败，继续尝试从MinIO获取
	logger.Debug("Redis缓存未命中，尝试从MinIO获取",
		logger.String("streamId", streamID),
		logger.String("fileName", fileName))

	// 第三级：从MinIO获取
	var minioPath string
	if isNetease {
		minioPath = fmt.Sprintf("streams/netease/%s/%s", streamID, fileName)
	} else {
		minioPath = fmt.Sprintf("streams/%s/%s", streamID, fileName)
	}

	if data, contentType, err := sp.getFromMinIO(minioPath, fileName); err == nil {
		logger.Debug("从MinIO获取成功",
			logger.String("streamId", streamID),
			logger.String("fileName", fileName))

		// 异步回填到Redis缓存（仅在Redis可用时）
		go func() {
			if setErr := cache.SetSegmentCache(cacheKey, data, 1800*time.Second); setErr != nil {
				logger.Warn("异步回填Redis缓存失败",
					logger.String("streamId", streamID),
					logger.String("fileName", fileName),
					logger.ErrorField(setErr))
			} else {
				logger.Debug("异步回填Redis缓存成功",
					logger.String("streamId", streamID),
					logger.String("fileName", fileName))
			}
		}()

		return data, contentType, nil
	}

	logger.Warn("所有存储层都未找到分片文件",
		logger.String("streamId", streamID),
		logger.String("fileName", fileName),
		logger.Bool("isNetease", isNetease))

	return nil, "", fmt.Errorf("未找到分片文件: %s", fileName)
}

// getFromTemp 从temp目录获取文件
func (sp *StreamProcessor) getFromTemp(filePath, fileName string) ([]byte, string, error) {
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil, "", err
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, "", err
	}

	contentType := sp.getContentType(fileName)
	return data, contentType, nil
}

// getFromMinIO 从MinIO获取文件
func (sp *StreamProcessor) getFromMinIO(objectPath, fileName string) ([]byte, string, error) {
	client := storage.GetMinioClient()
	if client == nil {
		return nil, "", fmt.Errorf("MinIO客户端未初始化")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	object, err := client.GetObject(ctx, sp.cfg.MinioBucket, objectPath, minio.GetObjectOptions{})
	if err != nil {
		return nil, "", err
	}
	defer object.Close()

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, object); err != nil {
		return nil, "", err
	}

	contentType := sp.getContentType(fileName)
	return buf.Bytes(), contentType, nil
}

// getContentType 获取文件的Content-Type
func (sp *StreamProcessor) getContentType(fileName string) string {
	if strings.HasSuffix(fileName, ".m3u8") {
		return "application/vnd.apple.mpegurl"
	} else if strings.HasSuffix(fileName, ".ts") {
		return "video/MP2T"
	}
	return "application/octet-stream"
}

// GetProcessingState 获取处理状态
func (sp *StreamProcessor) GetProcessingState(streamID string) *ProcessingState {
	sp.processingMu.RLock()
	defer sp.processingMu.RUnlock()

	if state, exists := sp.processing[streamID]; exists {
		return state
	}
	return nil
}
