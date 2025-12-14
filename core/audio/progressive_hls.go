package audio

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"Bt1QFM/logger"
)

// ProgressiveHLSState 渐进式 HLS 状态追踪
type ProgressiveHLSState struct {
	StreamID        string
	IsNetease       bool
	TempDir         string
	BaseURL         string
	SegmentDuration float64           // 每个分片的时长（秒）
	Segments        map[int]bool      // 已完成的分片索引
	SegmentInfos    map[int]float64   // 分片索引 -> 实际时长
	IsComplete      bool              // 转码是否完成
	TotalDuration   float64           // 总时长（转码完成后才有）
	StartTime       time.Time
	mu              sync.RWMutex
}

// ProgressiveHLSManager 管理所有渐进式 HLS 会话
type ProgressiveHLSManager struct {
	states map[string]*ProgressiveHLSState
	mu     sync.RWMutex
}

// NewProgressiveHLSManager 创建管理器
func NewProgressiveHLSManager() *ProgressiveHLSManager {
	return &ProgressiveHLSManager{
		states: make(map[string]*ProgressiveHLSState),
	}
}

// CreateState 创建新的渐进式 HLS 状态
func (m *ProgressiveHLSManager) CreateState(streamID, tempDir string, isNetease bool, segmentDuration float64) *ProgressiveHLSState {
	m.mu.Lock()
	defer m.mu.Unlock()

	var baseURL string
	if isNetease {
		baseURL = fmt.Sprintf("/streams/netease/%s/", streamID)
	} else {
		baseURL = fmt.Sprintf("/streams/%s/", streamID)
	}

	state := &ProgressiveHLSState{
		StreamID:        streamID,
		IsNetease:       isNetease,
		TempDir:         tempDir,
		BaseURL:         baseURL,
		SegmentDuration: segmentDuration,
		Segments:        make(map[int]bool),
		SegmentInfos:    make(map[int]float64),
		IsComplete:      false,
		StartTime:       time.Now(),
	}

	m.states[streamID] = state

	logger.Info("创建渐进式HLS状态",
		logger.String("streamId", streamID),
		logger.String("tempDir", tempDir),
		logger.Bool("isNetease", isNetease))

	return state
}

// GetState 获取状态
func (m *ProgressiveHLSManager) GetState(streamID string) *ProgressiveHLSState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.states[streamID]
}

// RemoveState 移除状态
func (m *ProgressiveHLSManager) RemoveState(streamID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.states, streamID)
}

// AddSegment 添加已完成的分片
func (s *ProgressiveHLSState) AddSegment(segmentIndex int, duration float64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.Segments[segmentIndex] = true
	s.SegmentInfos[segmentIndex] = duration

	logger.Debug("添加分片到渐进式HLS",
		logger.String("streamId", s.StreamID),
		logger.Int("segmentIndex", segmentIndex),
		logger.Float64("duration", duration))
}

// MarkComplete 标记转码完成
func (s *ProgressiveHLSState) MarkComplete(totalDuration float64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.IsComplete = true
	s.TotalDuration = totalDuration

	logger.Info("渐进式HLS转码完成",
		logger.String("streamId", s.StreamID),
		logger.Int("totalSegments", len(s.Segments)),
		logger.Float64("totalDuration", totalDuration))
}

// GetCompletedSegmentCount 获取已完成分片数
func (s *ProgressiveHLSState) GetCompletedSegmentCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.Segments)
}

// GenerateM3U8 动态生成 m3u8 播放列表
func (s *ProgressiveHLSState) GenerateM3U8() string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var builder strings.Builder

	// HLS 头部
	builder.WriteString("#EXTM3U\n")
	builder.WriteString("#EXT-X-VERSION:3\n")
	builder.WriteString(fmt.Sprintf("#EXT-X-TARGETDURATION:%d\n", int(s.SegmentDuration)+1))
	builder.WriteString("#EXT-X-MEDIA-SEQUENCE:0\n")

	// 如果未完成，使用 EVENT 类型允许播放器追加
	if !s.IsComplete {
		builder.WriteString("#EXT-X-PLAYLIST-TYPE:EVENT\n")
	} else {
		builder.WriteString("#EXT-X-PLAYLIST-TYPE:VOD\n")
	}

	builder.WriteString("\n")

	// 获取已完成分片的索引并排序
	indices := make([]int, 0, len(s.Segments))
	for idx := range s.Segments {
		indices = append(indices, idx)
	}
	sort.Ints(indices)

	// 添加分片信息
	for _, idx := range indices {
		duration := s.SegmentInfos[idx]
		if duration <= 0 {
			duration = s.SegmentDuration // 使用默认时长
		}

		segmentName := fmt.Sprintf("segment_%03d.ts", idx)
		builder.WriteString(fmt.Sprintf("#EXTINF:%.6f,\n", duration))
		builder.WriteString(fmt.Sprintf("%s%s\n", s.BaseURL, segmentName))
	}

	// 如果转码完成，添加结束标记
	if s.IsComplete {
		builder.WriteString("#EXT-X-ENDLIST\n")
	}

	return builder.String()
}

// ScanAndUpdateSegments 扫描 temp 目录并更新分片状态
func (s *ProgressiveHLSState) ScanAndUpdateSegments() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 扫描 .ts 文件
	pattern := filepath.Join(s.TempDir, "segment_*.ts")
	files, err := filepath.Glob(pattern)
	if err != nil {
		return err
	}

	for _, file := range files {
		// 解析分片索引
		baseName := filepath.Base(file)
		// segment_000.ts -> 000
		indexStr := strings.TrimPrefix(baseName, "segment_")
		indexStr = strings.TrimSuffix(indexStr, ".ts")

		idx, err := strconv.Atoi(indexStr)
		if err != nil {
			continue
		}

		// 检查文件是否已完整写入（大小 > 0 且稳定）
		info, err := os.Stat(file)
		if err != nil || info.Size() == 0 {
			continue
		}

		// 如果还没记录这个分片，添加它
		if !s.Segments[idx] {
			s.Segments[idx] = true
			s.SegmentInfos[idx] = s.SegmentDuration // 使用默认时长
		}
	}

	return nil
}

// HasMinimumSegments 检查是否有足够的分片可以开始播放
func (s *ProgressiveHLSState) HasMinimumSegments(minCount int) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.Segments) >= minCount
}

// IsProcessing 检查是否正在处理中
func (s *ProgressiveHLSState) IsProcessing() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return !s.IsComplete
}

// MinimumSegmentsForPlayback 开始播放所需的最小分片数
// 3 个分片 = 12 秒缓冲，确保播放器在转码追赶前有足够缓冲
const MinimumSegmentsForPlayback = 3

// 全局管理器实例
var globalProgressiveHLSManager = NewProgressiveHLSManager()

// GetProgressiveHLSManager 获取全局管理器
func GetProgressiveHLSManager() *ProgressiveHLSManager {
	return globalProgressiveHLSManager
}
