package audio

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"Bt1QFM/cache"
	"Bt1QFM/config"
	"Bt1QFM/logger"
	"Bt1QFM/storage"

	"github.com/fsnotify/fsnotify"
	"github.com/minio/minio-go/v7"
)

// PipelineProcessor 流水线处理器
// 核心思想：边转码边推送，不等全部完成
// 架构：FFmpeg 输出分片 → fsnotify 监听 → WorkerPool 并行处理 → Redis/MinIO
type PipelineProcessor struct {
	ffmpeg      *FFmpegProcessor
	cfg         *config.Config
	workerCount int
}

// SegmentTask 分片处理任务
type SegmentTask struct {
	StreamID    string
	SegmentPath string
	SegmentName string
	IsM3U8      bool
}

// PipelineResult 流水线处理结果
type PipelineResult struct {
	Duration       float32
	SegmentCount   int
	FirstSegmentAt time.Time // 首个分片可用时间
	TotalTime      time.Duration
}

// NewPipelineProcessor 创建流水线处理器
func NewPipelineProcessor(ffmpeg *FFmpegProcessor, cfg *config.Config, workers int) *PipelineProcessor {
	if workers <= 0 {
		workers = runtime.NumCPU()
		if workers > 8 {
			workers = 8 // 限制最大并发，避免资源耗尽
		}
	}
	return &PipelineProcessor{
		ffmpeg:      ffmpeg,
		cfg:         cfg,
		workerCount: workers,
	}
}

// ProcessWithPipeline 流水线处理：边转码边上传
// 相比传统方式，首个分片可用时间从 ~30s 降低到 ~2-4s
func (p *PipelineProcessor) ProcessWithPipeline(ctx context.Context, streamID, inputPath, tempDir string, isNetease bool) (*PipelineResult, error) {
	startTime := time.Now()

	logger.Info("开始流水线处理",
		logger.String("streamId", streamID),
		logger.String("inputPath", inputPath),
		logger.Int("workerCount", p.workerCount))

	// 验证输入文件
	if _, err := os.Stat(inputPath); err != nil {
		return nil, fmt.Errorf("输入文件不存在: %w", err)
	}

	// 创建临时目录
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		return nil, fmt.Errorf("创建临时目录失败: %w", err)
	}

	// 创建任务通道和结果收集
	taskChan := make(chan *SegmentTask, 100)
	var wg sync.WaitGroup
	var segmentCount int32
	var firstSegmentTime time.Time
	var firstSegmentOnce sync.Once

	// 启动 Worker Pool
	for i := 0; i < p.workerCount; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			p.worker(ctx, workerID, taskChan, isNetease, &firstSegmentTime, &firstSegmentOnce)
		}(i)
	}

	// 创建文件监听器
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		close(taskChan)
		return nil, fmt.Errorf("创建文件监听器失败: %w", err)
	}

	// 添加目录监听
	if err := watcher.Add(tempDir); err != nil {
		watcher.Close()
		close(taskChan)
		return nil, fmt.Errorf("监听目录失败: %w", err)
	}

	// 已处理的分片追踪
	processedSegments := &sync.Map{}

	// 启动监听协程
	watcherDone := make(chan struct{})
	go func() {
		defer close(watcherDone)
		p.watchSegments(ctx, watcher, streamID, tempDir, taskChan, processedSegments, &segmentCount)
	}()

	// 启动 FFmpeg（异步）
	ffmpegDone := make(chan error, 1)
	var duration float32
	go func() {
		outputM3U8 := filepath.Join(tempDir, "playlist.m3u8")
		segmentPattern := filepath.Join(tempDir, "segment_%03d.ts")

		var hlsBaseURL string
		if isNetease {
			hlsBaseURL = fmt.Sprintf("/streams/netease/%s/", streamID)
		} else {
			hlsBaseURL = fmt.Sprintf("/streams/%s/", streamID)
		}

		d, err := p.ffmpeg.ProcessToHLS(inputPath, outputM3U8, segmentPattern, hlsBaseURL, "192k", "4")
		duration = d
		ffmpegDone <- err
	}()

	// 等待 FFmpeg 完成
	ffmpegErr := <-ffmpegDone

	// 给监听器一点时间处理最后的文件事件
	time.Sleep(200 * time.Millisecond)

	// 停止监听
	watcher.Close()
	<-watcherDone

	// 处理可能遗漏的分片（FFmpeg 完成后的最终扫描）
	p.processRemainingSegments(streamID, tempDir, taskChan, processedSegments, &segmentCount)

	// 关闭任务通道，等待所有 worker 完成
	close(taskChan)
	wg.Wait()

	if ffmpegErr != nil {
		return nil, fmt.Errorf("FFmpeg 处理失败: %w", ffmpegErr)
	}

	result := &PipelineResult{
		Duration:       duration,
		SegmentCount:   int(atomic.LoadInt32(&segmentCount)),
		FirstSegmentAt: firstSegmentTime,
		TotalTime:      time.Since(startTime),
	}

	logger.Info("流水线处理完成",
		logger.String("streamId", streamID),
		logger.Int("segmentCount", result.SegmentCount),
		logger.Float64("duration", float64(result.Duration)),
		logger.Duration("totalTime", result.TotalTime))

	return result, nil
}

// watchSegments 监听新分片文件
func (p *PipelineProcessor) watchSegments(
	ctx context.Context,
	watcher *fsnotify.Watcher,
	streamID, tempDir string,
	taskChan chan<- *SegmentTask,
	processedSegments *sync.Map,
	segmentCount *int32,
) {
	// 文件稳定性检查的延迟队列
	pendingFiles := make(map[string]time.Time)
	checkTicker := time.NewTicker(50 * time.Millisecond)
	defer checkTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case event, ok := <-watcher.Events:
			if !ok {
				return
			}

			// 只处理 .ts 和 .m3u8 文件的写入事件
			if event.Op&(fsnotify.Write|fsnotify.Create) != 0 {
				ext := filepath.Ext(event.Name)
				if ext == ".ts" || ext == ".m3u8" {
					pendingFiles[event.Name] = time.Now()
				}
			}

		case <-checkTicker.C:
			// 检查待处理文件是否已稳定（100ms 无变化）
			now := time.Now()
			for filePath, lastModTime := range pendingFiles {
				if now.Sub(lastModTime) < 100*time.Millisecond {
					continue // 文件可能还在写入
				}

				segmentName := filepath.Base(filePath)

				// 检查是否已处理
				if _, loaded := processedSegments.LoadOrStore(segmentName, true); loaded {
					delete(pendingFiles, filePath)
					continue
				}

				// 验证文件完整性
				if !p.isFileComplete(filePath) {
					continue // 文件还未写入完成
				}

				// 推送任务
				task := &SegmentTask{
					StreamID:    streamID,
					SegmentPath: filePath,
					SegmentName: segmentName,
					IsM3U8:      strings.HasSuffix(segmentName, ".m3u8"),
				}

				select {
				case taskChan <- task:
					atomic.AddInt32(segmentCount, 1)
					logger.Debug("检测到新分片",
						logger.String("streamId", streamID),
						logger.String("segment", segmentName))
				default:
					// 通道满了，稍后重试
					continue
				}

				delete(pendingFiles, filePath)
			}

		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			logger.Warn("文件监听错误", logger.ErrorField(err))
		}
	}
}

// worker 处理分片任务
func (p *PipelineProcessor) worker(
	ctx context.Context,
	workerID int,
	taskChan <-chan *SegmentTask,
	isNetease bool,
	firstSegmentTime *time.Time,
	firstSegmentOnce *sync.Once,
) {
	for task := range taskChan {
		select {
		case <-ctx.Done():
			return
		default:
		}

		// 记录首个分片时间
		firstSegmentOnce.Do(func() {
			*firstSegmentTime = time.Now()
			logger.Info("首个分片已可用",
				logger.String("streamId", task.StreamID),
				logger.String("segment", task.SegmentName))
		})

		// 读取分片数据
		data, err := os.ReadFile(task.SegmentPath)
		if err != nil {
			logger.Warn("读取分片失败",
				logger.Int("worker", workerID),
				logger.String("segment", task.SegmentName),
				logger.ErrorField(err))
			continue
		}

		// 并行执行 Redis 和 MinIO 上传
		var uploadWg sync.WaitGroup
		uploadWg.Add(2)

		// Redis 上传
		go func() {
			defer uploadWg.Done()
			cacheKey := fmt.Sprintf("segment:%s:%s", task.StreamID, task.SegmentName)
			if err := cache.SetSegmentCache(cacheKey, data, 1800*time.Second); err != nil {
				logger.Warn("分片写入Redis失败",
					logger.String("segment", task.SegmentName),
					logger.ErrorField(err))
			}
		}()

		// MinIO 上传
		go func() {
			defer uploadWg.Done()
			p.uploadSegmentToMinIO(task, data, isNetease)
		}()

		uploadWg.Wait()

		logger.Debug("分片处理完成",
			logger.Int("worker", workerID),
			logger.String("segment", task.SegmentName),
			logger.Int("size", len(data)))
	}
}

// isFileComplete 检查文件是否写入完成
func (p *PipelineProcessor) isFileComplete(path string) bool {
	info1, err := os.Stat(path)
	if err != nil || info1.Size() == 0 {
		return false
	}

	// 短暂等待后再次检查大小
	time.Sleep(30 * time.Millisecond)

	info2, err := os.Stat(path)
	if err != nil {
		return false
	}

	return info1.Size() == info2.Size()
}

// processRemainingSegments 处理可能遗漏的分片
func (p *PipelineProcessor) processRemainingSegments(
	streamID, tempDir string,
	taskChan chan<- *SegmentTask,
	processedSegments *sync.Map,
	segmentCount *int32,
) {
	// 扫描目录中所有 .ts 和 .m3u8 文件
	files, err := filepath.Glob(filepath.Join(tempDir, "*.ts"))
	if err != nil {
		return
	}

	m3u8Files, _ := filepath.Glob(filepath.Join(tempDir, "*.m3u8"))
	files = append(files, m3u8Files...)

	for _, filePath := range files {
		segmentName := filepath.Base(filePath)

		// 检查是否已处理
		if _, loaded := processedSegments.LoadOrStore(segmentName, true); loaded {
			continue
		}

		task := &SegmentTask{
			StreamID:    streamID,
			SegmentPath: filePath,
			SegmentName: segmentName,
			IsM3U8:      strings.HasSuffix(segmentName, ".m3u8"),
		}

		select {
		case taskChan <- task:
			atomic.AddInt32(segmentCount, 1)
		default:
			// 通道已满或已关闭
		}
	}
}

// uploadSegmentToMinIO 上传单个分片到 MinIO
func (p *PipelineProcessor) uploadSegmentToMinIO(task *SegmentTask, data []byte, isNetease bool) {
	client := storage.GetMinioClient()
	if client == nil {
		return
	}

	var minioPath string
	if isNetease {
		minioPath = fmt.Sprintf("streams/netease/%s/%s", task.StreamID, task.SegmentName)
	} else {
		minioPath = fmt.Sprintf("streams/%s/%s", task.StreamID, task.SegmentName)
	}

	var contentType string
	if task.IsM3U8 {
		contentType = "application/vnd.apple.mpegurl"
	} else {
		contentType = "video/MP2T"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	reader := strings.NewReader(string(data))
	opts := minio.PutObjectOptions{
		ContentType:      contentType,
		DisableMultipart: true,
	}

	_, err := client.PutObject(ctx, p.cfg.MinioBucket, minioPath, reader, int64(len(data)), opts)
	if err != nil {
		logger.Warn("分片上传MinIO失败",
			logger.String("segment", task.SegmentName),
			logger.ErrorField(err))
	}
}

// ProcessToHLSWithProgress FFmpeg 处理并实时报告进度
func (p *PipelineProcessor) ProcessToHLSWithProgress(
	ctx context.Context,
	inputPath, outputM3U8, segmentPattern, hlsBaseURL string,
	progressChan chan<- float64,
) (float32, error) {
	// 先获取总时长
	duration, err := p.ffmpeg.GetAudioDuration(inputPath)
	if err != nil {
		return 0, err
	}

	// 构建 FFmpeg 命令（带进度输出）
	// 使用多线程加速转码：-threads 0 表示自动检测 CPU 核心数
	args := []string{
		"-threads", "0", // 自动使用所有可用 CPU 核心
		"-progress", "pipe:1", // 进度输出到 stdout
		"-i", inputPath,
		"-c:a", "aac",
		"-b:a", "192k",
		"-hls_time", "4",
		"-hls_playlist_type", "vod",
		"-hls_list_size", "0",
		"-hls_segment_filename", segmentPattern,
		"-hls_base_url", hlsBaseURL,
		"-f", "hls",
		outputM3U8,
	}

	cmd := exec.CommandContext(ctx, p.ffmpeg.FFmpegPath(), args...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return 0, err
	}

	if err := cmd.Start(); err != nil {
		return 0, err
	}

	// 解析进度输出
	go func() {
		defer close(progressChan)
		buf := make([]byte, 1024)
		var currentTime float64

		for {
			n, err := stdout.Read(buf)
			if err != nil {
				return
			}

			output := string(buf[:n])
			// 解析 out_time_ms=xxx
			if strings.Contains(output, "out_time_ms=") {
				for _, line := range strings.Split(output, "\n") {
					if strings.HasPrefix(line, "out_time_ms=") {
						var ms int64
						fmt.Sscanf(line, "out_time_ms=%d", &ms)
						currentTime = float64(ms) / 1000000.0
						progress := currentTime / float64(duration) * 100
						if progress > 100 {
							progress = 100
						}
						select {
						case progressChan <- progress:
						default:
						}
					}
				}
			}
		}
	}()

	if err := cmd.Wait(); err != nil {
		return 0, err
	}

	return duration, nil
}
