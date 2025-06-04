package audio

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"Bt1QFM/core/utils"
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
				log.Printf("下载音频文件失败: %v", err)
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

// GetProcessingStatus 获取处理状态
func (p *MP3Processor) GetProcessingStatus(songID string) *ProcessingStatus {
	if status, exists := p.processingStatus[songID]; exists {
		return status
	}
	return nil
}

// SetProcessingStatus 设置处理状态
func (p *MP3Processor) SetProcessingStatus(songID string, isProcessing bool, err error) {
	p.processingStatus[songID] = &ProcessingStatus{
		IsProcessing: isProcessing,
		Error:        err,
		RetryCount:   0,
		MaxRetries:   3,
	}
}

// UpdateProcessingStatus 更新处理状态
func (p *MP3Processor) UpdateProcessingStatus(songID string, err error) {
	if status, exists := p.processingStatus[songID]; exists {
		status.Error = err
		if err != nil {
			status.RetryCount++
		} else {
			status.IsProcessing = false
		}
	}
}

// ClearProcessingStatus 清除处理状态
func (p *MP3Processor) ClearProcessingStatus(songID string) {
	delete(p.processingStatus, songID)
}

// ProcessToHLS 将 MP3 文件转换为 HLS 格式
func (p *MP3Processor) ProcessToHLS(inputFile, outputM3U8, segmentPattern, hlsBaseURL, audioBitrate, hlsSegmentTime string) (float32, error) {
	log.Printf("Processing Netease MP3 %s to HLS. Output M3U8: %s, Segments: %s, Base URL: %s",
		inputFile, outputM3U8, segmentPattern, hlsBaseURL)

	// 确保输出目录存在
	outputDir := filepath.Dir(outputM3U8)
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return 0, fmt.Errorf("failed to create output directory %s: %w", outputDir, err)
	}

	// 获取音频时长
	duration, err := p.GetAudioDuration(inputFile)
	if err != nil {
		log.Printf("Warning: could not get audio duration for %s: %v. Proceeding without duration.", inputFile, err)
	}

	// 构建 FFmpeg 参数
	args := []string{
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

	log.Printf("Executing FFmpeg command: %s %s", p.ffmpegPath, strings.Join(args, " "))

	if err := cmd.Run(); err != nil {
		return 0, fmt.Errorf("ffmpeg execution failed for %s: %w\nFFmpeg Error: %s", inputFile, err, stderr.String())
	}

	log.Printf("Successfully transcoded Netease MP3 %s to HLS: %s", inputFile, outputM3U8)
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
