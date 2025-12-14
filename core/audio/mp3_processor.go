package audio

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"Bt1QFM/core/utils"
	"Bt1QFM/logger"
)

// PreprocessTask 表示预处理任务
type PreprocessTask struct {
	SongID     string
	URL        string
	OutputDir  string
	ResultChan chan<- *PreprocessResult
}

// PreprocessResult 表示预处理结果
type PreprocessResult struct {
	Success bool
	Error   error
}

// MP3Processor 处理网易云音乐的音频文件
type MP3Processor struct {
	ffmpegPath       string
	processingStatus map[string]*ProcessingStatus
	statusMutex      sync.RWMutex // 添加状态锁
	preprocessChan   chan *PreprocessTask
	workerCount      int
	wg               sync.WaitGroup
	stopChan         chan struct{}
}

// ProcessingStatus 表示音频处理状态
type ProcessingStatus struct {
	IsProcessing bool
	Error        error
	RetryCount   int
	MaxRetries   int
	StartTime    time.Time
	SongID       string
	IsNetease    bool
	done         chan struct{} // 添加完成信号
}

// NewMP3Processor 创建一个新的 MP3 处理器
func NewMP3Processor(ffmpegPath string) *MP3Processor {
	processor := &MP3Processor{
		ffmpegPath:       ffmpegPath,
		processingStatus: make(map[string]*ProcessingStatus),
		preprocessChan:   make(chan *PreprocessTask, 10), // 缓冲通道，最多存储10个预处理任务
		workerCount:      2,                              // 默认2个工作协程
		stopChan:         make(chan struct{}),
	}

	// 启动工作池
	processor.startWorkers()

	return processor
}

// GetFFmpegPath 返回 FFmpeg 可执行文件路径
func (p *MP3Processor) GetFFmpegPath() string {
	return p.ffmpegPath
}

// startWorkers 启动工作协程池
func (p *MP3Processor) startWorkers() {
	for i := 0; i < p.workerCount; i++ {
		p.wg.Add(1)
		go p.worker()
	}
}

// worker 工作协程
func (p *MP3Processor) worker() {
	defer p.wg.Done()

	for {
		select {
		case task := <-p.preprocessChan:
			// 检查是否已经在处理中
			if status := p.GetProcessingStatus(task.SongID); status != nil && status.IsProcessing {
				task.ResultChan <- &PreprocessResult{
					Success: false,
					Error:   fmt.Errorf("song is already being processed"),
				}
				continue
			}

			// 设置处理状态
			p.SetProcessingStatus(task.SongID, true, nil)

			// 创建临时目录
			tempDir := filepath.Join(task.OutputDir, "temp", task.SongID)
			if err := os.MkdirAll(tempDir, 0755); err != nil {
				p.UpdateProcessingStatus(task.SongID, err)
				task.ResultChan <- &PreprocessResult{
					Success: false,
					Error:   fmt.Errorf("failed to create temp directory: %w", err),
				}
				continue
			}

			// 下载音频文件
			tempFile := filepath.Join(tempDir, fmt.Sprintf("%s.mp3", task.SongID))
			if err := utils.DownloadFile(task.URL, tempFile); err != nil {
				logger.Error("下载音频文件失败", logger.String("songId", task.SongID), logger.ErrorField(err))
				p.UpdateProcessingStatus(task.SongID, err)
				task.ResultChan <- &PreprocessResult{
					Success: false,
					Error:   fmt.Errorf("failed to download file: %w", err),
				}
				continue
			}

			// 优化MP3文件
			optimizedFile := filepath.Join(tempDir, fmt.Sprintf("%s_optimized.mp3", task.SongID))
			if err := p.OptimizeMP3(tempFile, optimizedFile); err != nil {
				p.UpdateProcessingStatus(task.SongID, err)
				task.ResultChan <- &PreprocessResult{
					Success: false,
					Error:   fmt.Errorf("failed to optimize MP3: %w", err),
				}
				continue
			}

			// 转换为HLS格式
			hlsDir := filepath.Join(task.OutputDir, "streams", "netease", task.SongID)
			if err := os.MkdirAll(hlsDir, 0755); err != nil {
				p.UpdateProcessingStatus(task.SongID, err)
				task.ResultChan <- &PreprocessResult{
					Success: false,
					Error:   fmt.Errorf("failed to create HLS directory: %w", err),
				}
				continue
			}

			outputM3U8 := filepath.Join(hlsDir, "playlist.m3u8")
			segmentPattern := filepath.Join(hlsDir, "segment_%03d.ts")
			hlsBaseURL := fmt.Sprintf("/streams/netease/%s/", task.SongID)

			_, err := p.ProcessToHLS(optimizedFile, outputM3U8, segmentPattern, hlsBaseURL, "192k", "4")
			if err != nil {
				p.UpdateProcessingStatus(task.SongID, err)
				task.ResultChan <- &PreprocessResult{
					Success: false,
					Error:   fmt.Errorf("failed to process to HLS: %w", err),
				}
				continue
			}

			// 清理临时文件
			os.RemoveAll(tempDir)

			// 更新处理状态
			p.UpdateProcessingStatus(task.SongID, nil)

			task.ResultChan <- &PreprocessResult{
				Success: true,
			}

		case <-p.stopChan:
			return
		}
	}
}

// Stop 停止所有工作协程
func (p *MP3Processor) Stop() {
	close(p.stopChan)
	p.wg.Wait()
}

// PreprocessSong 异步预处理歌曲
func (p *MP3Processor) PreprocessSong(songID, url, outputDir string) error {
	resultChan := make(chan *PreprocessResult, 1)

	task := &PreprocessTask{
		SongID:     songID,
		URL:        url,
		OutputDir:  outputDir,
		ResultChan: resultChan,
	}

	p.preprocessChan <- task
	result := <-resultChan

	if !result.Success {
		return result.Error
	}

	return nil
}

// GetProcessingStatus 获取处理状态 - 线程安全
func (p *MP3Processor) GetProcessingStatus(songID string) *ProcessingStatus {
	p.statusMutex.RLock()
	defer p.statusMutex.RUnlock()

	if status, exists := p.processingStatus[songID]; exists {
		return status
	}
	return nil
}

// SetProcessingStatus 设置处理状态 - 线程安全
func (p *MP3Processor) SetProcessingStatus(songID string, isProcessing bool, err error) {
	p.statusMutex.Lock()
	defer p.statusMutex.Unlock()

	if isProcessing {
		// 开始处理
		p.processingStatus[songID] = &ProcessingStatus{
			IsProcessing: true,
			Error:        err,
			RetryCount:   0,
			MaxRetries:   3,
			StartTime:    time.Now(),
			SongID:       songID,
			IsNetease:    strings.HasPrefix(songID, "netease_") || len(songID) < 10, // 简单判断是否为网易云
			done:         make(chan struct{}),
		}
	} else {
		// 处理完成
		if status, exists := p.processingStatus[songID]; exists {
			status.IsProcessing = false
			status.Error = err
			close(status.done)
		}
	}
}

// UpdateProcessingStatus 更新处理状态 - 线程安全
func (p *MP3Processor) UpdateProcessingStatus(songID string, err error) {
	p.statusMutex.Lock()
	defer p.statusMutex.Unlock()

	if status, exists := p.processingStatus[songID]; exists {
		status.Error = err
		if err != nil {
			status.RetryCount++
		} else {
			status.IsProcessing = false
			close(status.done)
		}
	}
}

// ClearProcessingStatus 清除处理状态 - 线程安全
func (p *MP3Processor) ClearProcessingStatus(songID string) {
	p.statusMutex.Lock()
	defer p.statusMutex.Unlock()

	if status, exists := p.processingStatus[songID]; exists {
		if status.IsProcessing {
			status.IsProcessing = false
			close(status.done)
		}
		delete(p.processingStatus, songID)
	}
}

// TryLockProcessing 尝试获取处理锁
func (p *MP3Processor) TryLockProcessing(songID string, isNetease bool) (*ProcessingStatus, bool) {
	p.statusMutex.Lock()
	defer p.statusMutex.Unlock()

	logger.Debug("尝试获取歌曲处理锁",
		logger.String("songId", songID),
		logger.Bool("isNetease", isNetease))

	// 检查是否已经在处理中
	if status, exists := p.processingStatus[songID]; exists && status.IsProcessing {
		logger.Info("歌曲正在处理中，无法获取锁",
			logger.String("songId", songID),
			logger.Bool("isNetease", isNetease),
			logger.Duration("processingDuration", time.Since(status.StartTime)),
			logger.Int("retryCount", status.RetryCount))
		return status, false
	}

	// 创建新的处理状态
	status := &ProcessingStatus{
		IsProcessing: true,
		StartTime:    time.Now(),
		SongID:       songID,
		IsNetease:    isNetease,
		done:         make(chan struct{}),
		MaxRetries:   3,
	}

	p.processingStatus[songID] = status

	logger.Info("成功获取歌曲处理锁",
		logger.String("songId", songID),
		logger.Bool("isNetease", isNetease),
		logger.String("startTime", status.StartTime.Format("2006-01-02 15:04:05")))

	return status, true
}

// ReleaseProcessing 释放处理锁
func (p *MP3Processor) ReleaseProcessing(songID string) {
	p.statusMutex.Lock()
	defer p.statusMutex.Unlock()

	if status, exists := p.processingStatus[songID]; exists {
		processingDuration := time.Since(status.StartTime)

		if status.IsProcessing {
			status.IsProcessing = false
			close(status.done)
		}

		delete(p.processingStatus, songID)

		logger.Info("成功释放歌曲处理锁",
			logger.String("songId", songID),
			logger.Bool("isNetease", status.IsNetease),
			logger.Duration("processingTime", processingDuration),
			logger.Int("retryCount", status.RetryCount),
			logger.Bool("hasError", status.Error != nil))
	} else {
		logger.Warn("尝试释放不存在的处理锁",
			logger.String("songId", songID))
	}
}

// WaitForProcessing 等待处理完成
func (p *MP3Processor) WaitForProcessing(songID string, timeout time.Duration) bool {
	p.statusMutex.RLock()
	status, exists := p.processingStatus[songID]
	p.statusMutex.RUnlock()

	if !exists {
		logger.Debug("歌曲不在处理队列中，直接返回",
			logger.String("songId", songID))
		return true // 没有在处理中，直接返回
	}

	if !status.IsProcessing {
		logger.Debug("歌曲处理已完成，直接返回",
			logger.String("songId", songID),
			logger.Duration("totalProcessingTime", time.Since(status.StartTime)))
		return true
	}

	logger.Info("开始等待歌曲处理完成",
		logger.String("songId", songID),
		logger.Duration("timeout", timeout),
		logger.Duration("alreadyProcessing", time.Since(status.StartTime)))

	select {
	case <-status.done:
		logger.Info("歌曲处理完成",
			logger.String("songId", songID),
			logger.Duration("totalProcessingTime", time.Since(status.StartTime)))
		return true
	case <-time.After(timeout):
		logger.Warn("等待歌曲处理超时",
			logger.String("songId", songID),
			logger.Duration("timeout", timeout),
			logger.Duration("alreadyProcessing", time.Since(status.StartTime)))
		return false
	}
}

// IsProcessing 检查歌曲是否正在处理中
func (p *MP3Processor) IsProcessing(songID string) bool {
	p.statusMutex.RLock()
	defer p.statusMutex.RUnlock()

	status, exists := p.processingStatus[songID]
	isProcessing := exists && status.IsProcessing

	if isProcessing {
		logger.Debug("检测到歌曲正在处理中",
			logger.String("songId", songID),
			logger.Duration("processingDuration", time.Since(status.StartTime)),
			logger.Int("retryCount", status.RetryCount),
			logger.Bool("isNetease", status.IsNetease))
	}

	return isProcessing
}

// CleanupExpiredProcessing 清理过期的处理状态
func (p *MP3Processor) CleanupExpiredProcessing(maxAge time.Duration) {
	p.statusMutex.Lock()
	defer p.statusMutex.Unlock()

	now := time.Now()
	cleanedCount := 0

	for songID, status := range p.processingStatus {
		age := now.Sub(status.StartTime)
		if age > maxAge {
			if status.IsProcessing {
				status.IsProcessing = false
				close(status.done)
			}

			delete(p.processingStatus, songID)
			cleanedCount++

			logger.Warn("清理过期的处理状态",
				logger.String("songId", songID),
				logger.Duration("age", age),
				logger.Duration("maxAge", maxAge),
				logger.Bool("isNetease", status.IsNetease),
				logger.Int("retryCount", status.RetryCount))
		}
	}

	if cleanedCount > 0 {
		logger.Info("处理状态清理完成",
			logger.Int("cleanedCount", cleanedCount),
			logger.Int("remainingCount", len(p.processingStatus)))
	}
}

// ProcessToHLS 将 MP3 文件转换为 HLS 格式
func (p *MP3Processor) ProcessToHLS(inputFile, outputM3U8, segmentPattern, hlsBaseURL, audioBitrate, hlsSegmentTime string) (float32, error) {
	logger.Info("开始MP3到HLS转换",
		logger.String("inputFile", inputFile),
		logger.String("outputM3U8", outputM3U8),
		logger.String("baseURL", hlsBaseURL))

	// 验证输入文件
	if fileInfo, err := os.Stat(inputFile); err != nil {
		return 0, fmt.Errorf("输入文件不可访问 %s: %w", inputFile, err)
	} else if fileInfo.Size() == 0 {
		return 0, fmt.Errorf("输入文件为空 %s", inputFile)
	} else {
		logger.Debug("输入文件验证通过",
			logger.String("inputFile", inputFile),
			logger.Int64("fileSize", fileInfo.Size()))
	}

	// 确保输出目录存在
	outputDir := filepath.Dir(outputM3U8)
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return 0, fmt.Errorf("failed to create output directory %s: %w", outputDir, err)
	}

	// 获取音频时长
	duration, err := p.GetAudioDuration(inputFile)
	if err != nil {
		logger.Warn("无法获取音频时长，继续处理",
			logger.String("file", inputFile),
			logger.ErrorField(err))
	}

	// 构建 FFmpeg 参数
	// 使用多线程加速转码：-threads 0 表示自动检测 CPU 核心数
	args := []string{
		"-threads", "0", // 自动使用所有可用 CPU 核心
		"-i", inputFile,
		"-c:a", "aac", // 使用 AAC 编码
		"-b:a", "192k", // 设置比特率为 192k
		"-ar", "44100", // 设置采样率为 44.1kHz
		"-ac", "2", // 设置为双声道
		"-vn",                 // 不处理视频
		"-map_metadata", "-1", // 移除元数据
		"-hls_time", "4", // 每个分片 4 秒
		"-hls_playlist_type", "vod",
		"-hls_list_size", "0", // 保留所有分片
		"-hls_segment_filename", segmentPattern,
		"-hls_base_url", hlsBaseURL,
		"-f", "hls",
		outputM3U8,
	}

	cmd := exec.Command(p.ffmpegPath, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	logger.Debug("执行FFmpeg命令",
		logger.String("path", p.ffmpegPath),
		logger.String("args", strings.Join(args, " ")))

	// 在执行FFmpeg前再次验证文件
	if _, err := os.Stat(inputFile); err != nil {
		return 0, fmt.Errorf("FFmpeg执行前文件丢失 %s: %w", inputFile, err)
	}

	if err := cmd.Run(); err != nil {
		// 检查文件是否在执行过程中被删除
		if _, statErr := os.Stat(inputFile); statErr != nil {
			return 0, fmt.Errorf("FFmpeg执行期间文件被删除 %s: %w (original error: %v)", inputFile, statErr, err)
		}
		return 0, fmt.Errorf("ffmpeg execution failed for %s: %w\nFFmpeg Error: %s", inputFile, err, stderr.String())
	}

	// 验证输出文件是否生成成功
	if _, err := os.Stat(outputM3U8); err != nil {
		return 0, fmt.Errorf("playlist.m3u8文件未生成 %s: %w", outputM3U8, err)
	}

	// 验证是否有分片文件生成
	segmentFiles, err := filepath.Glob(strings.Replace(segmentPattern, "%03d", "*", 1))
	if err != nil {
		logger.Warn("检查分片文件失败", logger.ErrorField(err))
	} else if len(segmentFiles) == 0 {
		return 0, fmt.Errorf("没有生成分片文件")
	} else {
		logger.Info("FFmpeg处理完成，分片文件已生成",
			logger.String("inputFile", inputFile),
			logger.String("outputM3U8", outputM3U8),
			logger.Int("segmentCount", len(segmentFiles)),
			logger.Float64("duration", float64(duration)))
	}

	return duration, nil
}

// GetAudioDuration 获取音频文件时长
func (p *MP3Processor) GetAudioDuration(inputFile string) (float32, error) {
	ffprobePath := strings.Replace(p.ffmpegPath, "ffmpeg", "ffprobe", 1)

	args := []string{
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "json",
		inputFile,
	}

	cmd := exec.Command(ffprobePath, args...)
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return 0, fmt.Errorf("ffprobe execution failed for %s: %w\nFFprobe Error: %s", inputFile, err, stderr.String())
	}

	var probeData struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}

	if err := json.Unmarshal(out.Bytes(), &probeData); err != nil {
		return 0, fmt.Errorf("failed to unmarshal ffprobe output for %s: %w\nFFprobe Output: %s", inputFile, err, out.String())
	}

	if probeData.Format.Duration == "" {
		return 0, fmt.Errorf("duration not found in ffprobe output for %s\nFFprobe Output: %s", inputFile, out.String())
	}

	duration, err := strconv.ParseFloat(probeData.Format.Duration, 32)
	if err != nil {
		return 0, fmt.Errorf("failed to parse duration string \"%s\" for %s: %w", probeData.Format.Duration, inputFile, err)
	}

	return float32(duration), nil
}

// OptimizeMP3 优化 MP3 文件大小和质量
func (p *MP3Processor) OptimizeMP3(inputFile, outputFile string) error {
	args := []string{
		"-i", inputFile,
		"-c:a", "libmp3lame", // 使用 LAME 编码器
		"-q:a", "2", // 设置质量（0-9，2 是很好的平衡）
		"-ar", "44100", // 设置采样率
		"-ac", "2", // 双声道
		"-map_metadata", "-1", // 移除元数据
		outputFile,
	}

	cmd := exec.Command(p.ffmpegPath, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg execution failed for optimizing %s: %w\nFFmpeg Error: %s", inputFile, err, stderr.String())
	}

	return nil
}
