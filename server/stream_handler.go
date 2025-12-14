package server

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"Bt1QFM/config"
	"Bt1QFM/core/audio"
	"Bt1QFM/core/netease"
	"Bt1QFM/logger"
)

// StreamHandler 处理 HLS 流媒体请求
type StreamHandler struct {
	streamProcessor *audio.StreamProcessor
	mp3Processor    *audio.MP3Processor
	cfg             *config.Config
}

// NewStreamHandler 创建 StreamHandler 实例
func NewStreamHandler(streamProcessor *audio.StreamProcessor, mp3Processor *audio.MP3Processor, cfg *config.Config) *StreamHandler {
	return &StreamHandler{
		streamProcessor: streamProcessor,
		mp3Processor:    mp3Processor,
		cfg:             cfg,
	}
}

// streamRequest 封装请求参数
type streamRequest struct {
	streamID  string
	fileName  string
	isNetease bool
}

// parseStreamPath 解析流媒体路径
// 格式: /streams/[netease/]streamID/filename
func parseStreamPath(urlPath string) (*streamRequest, error) {
	path := strings.TrimPrefix(urlPath, "/streams/")
	parts := strings.Split(path, "/")

	switch {
	case len(parts) >= 3 && parts[0] == "netease":
		return &streamRequest{
			streamID:  parts[1],
			fileName:  parts[2],
			isNetease: true,
		}, nil
	case len(parts) >= 2:
		return &streamRequest{
			streamID:  parts[0],
			fileName:  parts[1],
			isNetease: false,
		}, nil
	default:
		return nil, fmt.Errorf("invalid stream path: %s", urlPath)
	}
}

// ServeHTTP 实现 http.Handler 接口
func (h *StreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	req, err := parseStreamPath(r.URL.Path)
	if err != nil {
		http.Error(w, "Invalid stream path", http.StatusBadRequest)
		return
	}

	// 正在处理中的歌曲
	if h.mp3Processor.IsProcessing(req.streamID) {
		h.handleProcessingStream(w, req)
		return
	}

	// 尝试直接获取已存在的文件
	data, contentType, err := h.streamProcessor.StreamGet(req.streamID, req.fileName, req.isNetease)
	if err == nil {
		h.writeStreamResponse(w, data, contentType, false)
		return
	}

	// 网易云歌曲未找到，触发重新处理
	if req.isNetease && req.fileName == "playlist.m3u8" {
		h.handleNeteaseReprocess(w, req)
		return
	}

	logger.Warn("获取流分片失败",
		logger.String("streamId", req.streamID),
		logger.String("fileName", req.fileName),
		logger.ErrorField(err))
	http.Error(w, "File not found", http.StatusNotFound)
}

// handleProcessingStream 处理正在转码中的流请求
func (h *StreamHandler) handleProcessingStream(w http.ResponseWriter, req *streamRequest) {
	if req.fileName == "playlist.m3u8" {
		h.handleProgressivePlaylist(w, req)
		return
	}

	// 非 m3u8 请求，尝试获取已完成的分片
	h.handleSegmentRequest(w, req)
}

// handleProgressivePlaylist 处理渐进式播放列表请求
func (h *StreamHandler) handleProgressivePlaylist(w http.ResponseWriter, req *streamRequest) {
	hlsState := audio.GetProgressiveHLSManager().GetState(req.streamID)

	// 已有分片可用，直接返回
	if hlsState != nil && hlsState.HasMinimumSegments(1) {
		h.writeM3U8Response(w, hlsState)
		return
	}

	// 等待首个分片生成（最多 5 秒）
	logger.Info("等待首个分片生成...",
		logger.String("streamId", req.streamID),
		logger.Bool("isNetease", req.isNetease))

	hlsState = h.waitForFirstSegment(req.streamID, 5*time.Second)
	if hlsState != nil {
		logger.Info("首个分片已就绪",
			logger.String("streamId", req.streamID))
		h.writeM3U8Response(w, hlsState)
		return
	}

	logger.Warn("等待首个分片超时",
		logger.String("streamId", req.streamID))
	http.Error(w, "Processing in progress, please retry", http.StatusAccepted)
}

// handleSegmentRequest 处理分片请求
func (h *StreamHandler) handleSegmentRequest(w http.ResponseWriter, req *streamRequest) {
	logger.Info("检测到歌曲正在处理中，尝试获取已完成分片",
		logger.String("streamId", req.streamID),
		logger.String("fileName", req.fileName),
		logger.Bool("isNetease", req.isNetease))

	// 先尝试直接获取
	data, contentType, err := h.streamProcessor.StreamGet(req.streamID, req.fileName, req.isNetease)
	if err == nil {
		h.writeStreamResponse(w, data, contentType, false)
		return
	}

	// 短暂等待分片就绪（最多 3 秒）
	logger.Info("分片尚未就绪，短暂等待",
		logger.String("streamId", req.streamID),
		logger.String("fileName", req.fileName))

	data, contentType = h.waitForSegment(req, 3*time.Second)
	if data != nil {
		h.writeStreamResponse(w, data, contentType, false)
		return
	}

	logger.Warn("等待分片超时",
		logger.String("streamId", req.streamID),
		logger.String("fileName", req.fileName))
	http.Error(w, "Segment not ready", http.StatusNotFound)
}

// handleNeteaseReprocess 处理网易云歌曲重新处理
func (h *StreamHandler) handleNeteaseReprocess(w http.ResponseWriter, req *streamRequest) {
	logger.Info("网易云歌曲资源未找到，触发重新处理",
		logger.String("streamId", req.streamID))

	_, acquired := h.mp3Processor.TryLockProcessing(req.streamID, req.isNetease)
	if acquired {
		h.processWithLock(w, req)
		return
	}

	// 其他进程正在处理，等待结果
	logger.Info("歌曲正在被其他进程处理，使用渐进式等待",
		logger.String("streamId", req.streamID))

	h.waitForExternalProcessing(w, req)
}

// processWithLock 获取锁后处理歌曲
func (h *StreamHandler) processWithLock(w http.ResponseWriter, req *streamRequest) {
	logger.Info("成功获取处理锁，开始异步重新处理",
		logger.String("streamId", req.streamID),
		logger.Bool("isNetease", req.isNetease))

	// 异步启动处理
	go h.asyncReprocess(req.streamID)

	// 渐进式等待首个分片
	h.waitAndServeProgressivePlaylist(w, req, 30*time.Second)
}

// asyncReprocess 异步重新处理网易云歌曲
func (h *StreamHandler) asyncReprocess(streamID string) {
	defer func() {
		logger.Info("释放处理锁", logger.String("streamId", streamID))
		h.mp3Processor.ReleaseProcessing(streamID)
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	neteaseClient := netease.NewClient()
	if err := h.reprocessNeteaseSong(ctx, streamID, neteaseClient); err != nil {
		logger.Error("网易云歌曲重新处理失败",
			logger.String("streamId", streamID),
			logger.ErrorField(err))
		return
	}

	logger.Info("网易云歌曲重新处理完成",
		logger.String("streamId", streamID))
}

// waitAndServeProgressivePlaylist 等待并返回渐进式播放列表
func (h *StreamHandler) waitAndServeProgressivePlaylist(w http.ResponseWriter, req *streamRequest, timeout time.Duration) {
	logger.Info("开始渐进式等待首个分片",
		logger.String("streamId", req.streamID),
		logger.Duration("maxWait", timeout))

	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for time.Now().Before(deadline) {
		<-ticker.C

		// 检查 HLS 状态
		hlsState := audio.GetProgressiveHLSManager().GetState(req.streamID)
		if hlsState != nil && hlsState.HasMinimumSegments(1) {
			logger.Info("渐进式播放：首个分片已就绪",
				logger.String("streamId", req.streamID),
				logger.Int("segmentCount", hlsState.GetCompletedSegmentCount()),
				logger.Bool("isComplete", !hlsState.IsProcessing()))
			h.writeM3U8Response(w, hlsState)
			return
		}

		// 处理已完成，尝试直接获取文件
		if !h.mp3Processor.IsProcessing(req.streamID) {
			logger.Info("处理已完成，尝试直接获取文件",
				logger.String("streamId", req.streamID))
			data, contentType, err := h.streamProcessor.StreamGet(req.streamID, req.fileName, req.isNetease)
			if err == nil {
				h.writeStreamResponse(w, data, contentType, false)
				return
			}
			break
		}
	}

	// 超时后最后尝试
	logger.Warn("渐进式等待超时，尝试获取最终文件",
		logger.String("streamId", req.streamID))

	data, contentType, err := h.streamProcessor.StreamGet(req.streamID, req.fileName, req.isNetease)
	if err == nil {
		h.writeStreamResponse(w, data, contentType, false)
		return
	}

	http.Error(w, "File not found", http.StatusNotFound)
}

// waitForExternalProcessing 等待外部进程处理完成
func (h *StreamHandler) waitForExternalProcessing(w http.ResponseWriter, req *streamRequest) {
	deadline := time.Now().Add(30 * time.Second)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for time.Now().Before(deadline) {
		<-ticker.C

		hlsState := audio.GetProgressiveHLSManager().GetState(req.streamID)
		if hlsState != nil && hlsState.HasMinimumSegments(1) {
			logger.Info("渐进式播放：其他进程的首个分片已就绪",
				logger.String("streamId", req.streamID),
				logger.Int("segmentCount", hlsState.GetCompletedSegmentCount()))
			h.writeM3U8Response(w, hlsState)
			return
		}

		if !h.mp3Processor.IsProcessing(req.streamID) {
			data, contentType, err := h.streamProcessor.StreamGet(req.streamID, req.fileName, req.isNetease)
			if err == nil {
				h.writeStreamResponse(w, data, contentType, false)
				return
			}
			break
		}
	}

	// 超时后最后尝试
	logger.Warn("等待其他进程超时", logger.String("streamId", req.streamID))
	data, contentType, err := h.streamProcessor.StreamGet(req.streamID, req.fileName, req.isNetease)
	if err == nil {
		h.writeStreamResponse(w, data, contentType, false)
		return
	}

	http.Error(w, "File not found", http.StatusNotFound)
}

// waitForFirstSegment 等待首个分片生成
func (h *StreamHandler) waitForFirstSegment(streamID string, timeout time.Duration) *audio.ProgressiveHLSState {
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for time.Now().Before(deadline) {
		<-ticker.C
		hlsState := audio.GetProgressiveHLSManager().GetState(streamID)
		if hlsState != nil && hlsState.HasMinimumSegments(1) {
			return hlsState
		}
	}
	return nil
}

// waitForSegment 等待分片就绪
func (h *StreamHandler) waitForSegment(req *streamRequest, timeout time.Duration) ([]byte, string) {
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for time.Now().Before(deadline) {
		<-ticker.C
		data, contentType, err := h.streamProcessor.StreamGet(req.streamID, req.fileName, req.isNetease)
		if err == nil {
			return data, contentType
		}
	}
	return nil, ""
}

// writeStreamResponse 写入流媒体响应
func (h *StreamHandler) writeStreamResponse(w http.ResponseWriter, data []byte, contentType string, noCache bool) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if noCache {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=31536000")
	}

	if _, err := w.Write(data); err != nil {
		logger.Error("写入响应失败", logger.ErrorField(err))
	}
}

// writeM3U8Response 写入 M3U8 响应
func (h *StreamHandler) writeM3U8Response(w http.ResponseWriter, hlsState *audio.ProgressiveHLSState) {
	content := hlsState.GenerateM3U8()
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if hlsState.IsProcessing() {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=31536000")
	}

	w.Write([]byte(content))
}

// reprocessNeteaseSong 重新处理网易云歌曲
func (h *StreamHandler) reprocessNeteaseSong(ctx context.Context, songID string, client *netease.Client) error {
	logger.Info("开始重新处理网易云歌曲", logger.String("songId", songID))

	songURL, err := client.GetSongURL(songID)
	if err != nil {
		return fmt.Errorf("获取歌曲URL失败: %w", err)
	}
	if songURL == "" {
		return fmt.Errorf("歌曲URL为空")
	}

	tempFile, err := os.CreateTemp("", fmt.Sprintf("netease_%s_*.mp3", songID))
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %w", err)
	}
	tempFilePath := tempFile.Name()
	tempFile.Close()

	defer os.Remove(tempFilePath)

	if err := h.downloadFile(songURL, tempFilePath); err != nil {
		return fmt.Errorf("下载歌曲文件失败: %w", err)
	}

	fileInfo, err := os.Stat(tempFilePath)
	if err != nil {
		return fmt.Errorf("临时文件不存在: %w", err)
	}
	if fileInfo.Size() == 0 {
		return fmt.Errorf("下载的文件为空")
	}

	if err := h.streamProcessor.StreamProcessSync(ctx, songID, tempFilePath, true); err != nil {
		return fmt.Errorf("流处理失败: %w", err)
	}

	return nil
}

// downloadFile 下载文件
func (h *StreamHandler) downloadFile(url, filepath string) error {
	client := &http.Client{Timeout: 5 * time.Minute}

	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载请求失败，状态码: %d", resp.StatusCode)
	}

	out, err := os.Create(filepath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}
