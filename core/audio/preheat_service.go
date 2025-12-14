package audio

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"Bt1QFM/cache"
	"Bt1QFM/config"
	"Bt1QFM/logger"
)

// SongURLProvider 获取歌曲 URL 的函数类型
type SongURLProvider func(songID string) (string, error)

// PreheatService 预热服务
// 监控当前歌曲播放进度，在即将结束时预处理下一首歌曲
type PreheatService struct {
	streamProcessor *StreamProcessor
	mp3Processor    *MP3Processor
	roomCache       *cache.RoomCache
	cfg             *config.Config

	// 歌曲 URL 获取函数
	getSongURL SongURLProvider

	// 预热状态追踪
	preheatMu       sync.RWMutex
	preheatedSongs  map[string]bool // 已预热的歌曲 ID
	preheatProgress map[string]bool // 正在预热中的歌曲 ID

	// 控制
	stopChan chan struct{}
	wg       sync.WaitGroup
}

// PreheatConfig 预热配置
type PreheatConfig struct {
	// 预热触发条件：剩余时间（秒）
	TriggerRemainingSeconds float64
	// 预热触发条件：播放进度百分比（0-1）
	TriggerProgressPercent float64
	// 监控间隔
	MonitorInterval time.Duration
	// 预热缓存过期时间
	PreheatCacheTTL time.Duration
}

// DefaultPreheatConfig 默认预热配置
var DefaultPreheatConfig = PreheatConfig{
	TriggerRemainingSeconds: 30.0,  // 剩余 30 秒触发预热
	TriggerProgressPercent:  0.8,   // 或者播放到 80% 触发预热
	MonitorInterval:         5 * time.Second,
	PreheatCacheTTL:         30 * time.Minute,
}

// NewPreheatService 创建预热服务
func NewPreheatService(
	streamProcessor *StreamProcessor,
	mp3Processor *MP3Processor,
	roomCache *cache.RoomCache,
	cfg *config.Config,
	getSongURL SongURLProvider,
) *PreheatService {
	return &PreheatService{
		streamProcessor: streamProcessor,
		mp3Processor:    mp3Processor,
		roomCache:       roomCache,
		cfg:             cfg,
		getSongURL:      getSongURL,
		preheatedSongs:  make(map[string]bool),
		preheatProgress: make(map[string]bool),
		stopChan:        make(chan struct{}),
	}
}

// Start 启动预热服务
func (ps *PreheatService) Start() {
	logger.Info("预热服务启动")

	ps.wg.Add(1)
	go ps.monitorPlayback()
}

// Stop 停止预热服务
func (ps *PreheatService) Stop() {
	logger.Info("预热服务停止中...")
	close(ps.stopChan)
	ps.wg.Wait()
	logger.Info("预热服务已停止")
}

// monitorPlayback 监控所有活跃播放的状态（房间和用户）
func (ps *PreheatService) monitorPlayback() {
	defer ps.wg.Done()

	ticker := time.NewTicker(DefaultPreheatConfig.MonitorInterval)
	defer ticker.Stop()

	// 定期清理过期的预热缓存
	cleanupTicker := time.NewTicker(DefaultPreheatConfig.PreheatCacheTTL)
	defer cleanupTicker.Stop()

	for {
		select {
		case <-ps.stopChan:
			return
		case <-ticker.C:
			ps.checkAllRooms()
			ps.checkAllUsers()
		case <-cleanupTicker.C:
			ps.cleanupPreheatCache()
		}
	}
}

// checkAllRooms 检查所有房间的播放状态
func (ps *PreheatService) checkAllRooms() {
	ctx := context.Background()

	// 获取所有活跃房间（这里简化处理，实际可能需要从数据库或缓存获取活跃房间列表）
	// 暂时通过 Redis 扫描 room:*:playback 来获取活跃房间
	rooms := ps.getActiveRooms(ctx)

	for _, roomID := range rooms {
		ps.checkRoomPlayback(ctx, roomID)
	}
}

// getActiveRooms 获取活跃房间列表
func (ps *PreheatService) getActiveRooms(ctx context.Context) []string {
	// 简化实现：扫描 Redis 中的房间播放状态
	// 实际生产环境可能需要维护一个活跃房间列表
	client := cache.RedisClient
	if client == nil {
		return nil
	}

	// 使用 SCAN 查找所有房间播放状态键
	var rooms []string
	var cursor uint64 = 0

	for {
		keys, nextCursor, err := client.Scan(ctx, cursor, "room:*:playback", 100).Result()
		if err != nil {
			break
		}

		for _, key := range keys {
			// 从 key 中提取 roomID: room:{roomID}:playback
			if len(key) > 19 { // "room:" + "roomID" + ":playback"
				roomID := key[5 : len(key)-9] // 提取 roomID
				rooms = append(rooms, roomID)
			}
		}

		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	return rooms
}

// checkRoomPlayback 检查单个房间的播放状态
func (ps *PreheatService) checkRoomPlayback(ctx context.Context, roomID string) {
	// 获取当前播放状态
	playbackState, err := ps.roomCache.GetPlaybackState(ctx, roomID)
	if err != nil || playbackState == nil {
		return
	}

	// 检查是否正在播放
	if !playbackState.IsPlaying {
		return
	}

	// 获取房间歌单
	playlist, err := ps.roomCache.GetRoomPlaylist(ctx, roomID)
	if err != nil || len(playlist) == 0 {
		return
	}

	// 获取当前歌曲
	currentIndex := playbackState.CurrentIndex
	if currentIndex < 0 || currentIndex >= len(playlist) {
		return
	}

	currentSong := playlist[currentIndex]
	currentDuration := float64(currentSong.Duration)
	currentPosition := playbackState.Position

	// 检查是否需要预热
	if currentDuration <= 0 {
		return
	}

	remainingSeconds := currentDuration - currentPosition
	progressPercent := currentPosition / currentDuration

	shouldPreheat := remainingSeconds <= DefaultPreheatConfig.TriggerRemainingSeconds ||
		progressPercent >= DefaultPreheatConfig.TriggerProgressPercent

	if !shouldPreheat {
		return
	}

	// 获取下一首歌
	nextIndex := currentIndex + 1
	if nextIndex >= len(playlist) {
		// 如果是最后一首，可能需要循环播放，这里暂时跳过
		return
	}

	nextSong := playlist[nextIndex]
	ps.preheatSong(ctx, &nextSong, roomID)
}

// preheatSong 预热单首歌曲
func (ps *PreheatService) preheatSong(ctx context.Context, song *cache.PlaylistItem, roomID string) {
	// 确定歌曲 ID
	var songID string
	var isNetease bool

	if song.NeteaseID != 0 {
		songID = strconv.FormatInt(song.NeteaseID, 10)
		isNetease = true
	} else if song.SongID != "" {
		songID = song.SongID
		isNetease = true // 假设 SongID 为网易云
	} else if song.TrackID != 0 {
		songID = strconv.FormatInt(song.TrackID, 10)
		isNetease = false
	} else {
		return
	}

	// 检查是否已预热或正在预热
	ps.preheatMu.Lock()
	if ps.preheatedSongs[songID] || ps.preheatProgress[songID] {
		ps.preheatMu.Unlock()
		return
	}
	ps.preheatProgress[songID] = true
	ps.preheatMu.Unlock()

	// 检查是否已经有 HLS 分片（不需要预热）
	hlsState := GetProgressiveHLSManager().GetState(songID)
	if hlsState != nil && hlsState.HasEnoughSegmentsToPlay() {
		ps.markPreheated(songID)
		return
	}

	// 检查是否正在处理中
	if ps.mp3Processor.IsProcessing(songID) {
		ps.clearPreheatProgress(songID)
		return
	}

	logger.Info("开始预热歌曲",
		logger.String("roomId", roomID),
		logger.String("songId", songID),
		logger.String("title", song.Title),
		logger.Bool("isNetease", isNetease))

	// 异步预热
	go ps.doPreheat(songID, isNetease, song.Title)
}

// doPreheat 执行预热操作
func (ps *PreheatService) doPreheat(songID string, isNetease bool, title string) {
	defer ps.markPreheated(songID)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	if isNetease {
		ps.preheatNeteaseSong(ctx, songID, title)
	} else {
		ps.preheatLocalSong(ctx, songID, title)
	}
}

// preheatNeteaseSong 预热网易云歌曲
func (ps *PreheatService) preheatNeteaseSong(ctx context.Context, songID, title string) {
	// 尝试获取处理锁
	_, acquired := ps.mp3Processor.TryLockProcessing(songID, true)
	if !acquired {
		logger.Debug("预热歌曲已被其他进程处理",
			logger.String("songId", songID))
		return
	}

	defer ps.mp3Processor.ReleaseProcessing(songID)

	// 检查是否有 URL 获取函数
	if ps.getSongURL == nil {
		logger.Warn("预热：未配置歌曲URL获取函数",
			logger.String("songId", songID))
		return
	}

	// 获取网易云歌曲 URL
	songURL, err := ps.getSongURL(songID)
	if err != nil {
		logger.Warn("预热：获取网易云歌曲URL失败",
			logger.String("songId", songID),
			logger.ErrorField(err))
		return
	}

	if songURL == "" {
		logger.Warn("预热：网易云歌曲URL为空",
			logger.String("songId", songID))
		return
	}

	// 下载到临时文件
	tempFile, err := os.CreateTemp("", fmt.Sprintf("preheat_%s_*.mp3", songID))
	if err != nil {
		logger.Warn("预热：创建临时文件失败",
			logger.String("songId", songID),
			logger.ErrorField(err))
		return
	}
	tempFilePath := tempFile.Name()
	tempFile.Close()
	defer os.Remove(tempFilePath)

	if err := ps.downloadFile(songURL, tempFilePath); err != nil {
		logger.Warn("预热：下载歌曲失败",
			logger.String("songId", songID),
			logger.ErrorField(err))
		return
	}

	// 验证文件
	fileInfo, err := os.Stat(tempFilePath)
	if err != nil || fileInfo.Size() == 0 {
		logger.Warn("预热：下载的文件为空",
			logger.String("songId", songID))
		return
	}

	// 执行流处理
	if err := ps.streamProcessor.StreamProcessSync(ctx, songID, tempFilePath, true); err != nil {
		logger.Warn("预热：流处理失败",
			logger.String("songId", songID),
			logger.ErrorField(err))
		return
	}

	logger.Info("预热歌曲完成",
		logger.String("songId", songID),
		logger.String("title", title))
}

// preheatLocalSong 预热本地歌曲
func (ps *PreheatService) preheatLocalSong(ctx context.Context, trackID, title string) {
	// 本地歌曲通常已经处理好了，这里主要是确保 HLS 分片存在
	// 如果需要，可以从数据库获取音频文件路径并处理

	logger.Debug("本地歌曲预热跳过（通常已处理）",
		logger.String("trackId", trackID))
}

// downloadFile 下载文件
func (ps *PreheatService) downloadFile(url, filepath string) error {
	client := &http.Client{Timeout: 3 * time.Minute}

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

// markPreheated 标记歌曲已预热
func (ps *PreheatService) markPreheated(songID string) {
	ps.preheatMu.Lock()
	defer ps.preheatMu.Unlock()

	ps.preheatedSongs[songID] = true
	delete(ps.preheatProgress, songID)
}

// clearPreheatProgress 清除预热进度标记
func (ps *PreheatService) clearPreheatProgress(songID string) {
	ps.preheatMu.Lock()
	defer ps.preheatMu.Unlock()

	delete(ps.preheatProgress, songID)
}

// cleanupPreheatCache 清理预热缓存
func (ps *PreheatService) cleanupPreheatCache() {
	ps.preheatMu.Lock()
	defer ps.preheatMu.Unlock()

	// 简单清空，让下次需要时重新判断
	ps.preheatedSongs = make(map[string]bool)

	logger.Debug("预热缓存已清理")
}

// IsSongPreheated 检查歌曲是否已预热
func (ps *PreheatService) IsSongPreheated(songID string) bool {
	ps.preheatMu.RLock()
	defer ps.preheatMu.RUnlock()

	return ps.preheatedSongs[songID]
}

// PreheatNextSong 手动触发预热下一首歌（可由 WebSocket 消息触发）
func (ps *PreheatService) PreheatNextSong(ctx context.Context, roomID string) error {
	playlist, err := ps.roomCache.GetRoomPlaylist(ctx, roomID)
	if err != nil {
		return err
	}

	playbackState, err := ps.roomCache.GetPlaybackState(ctx, roomID)
	if err != nil {
		return err
	}

	if playbackState == nil {
		return fmt.Errorf("房间 %s 没有播放状态", roomID)
	}

	nextIndex := playbackState.CurrentIndex + 1
	if nextIndex >= len(playlist) {
		return fmt.Errorf("已经是最后一首歌")
	}

	nextSong := playlist[nextIndex]
	ps.preheatSong(ctx, &nextSong, roomID)

	return nil
}

// ========== 用户播放列表预热 ==========

// checkAllUsers 检查所有活跃用户的播放状态
func (ps *PreheatService) checkAllUsers() {
	ctx := context.Background()

	// 获取所有活跃用户
	userIDs, err := cache.GetActiveUserPlaybacks(ctx)
	if err != nil {
		return
	}

	for _, userID := range userIDs {
		ps.checkUserPlayback(ctx, userID)
	}
}

// checkUserPlayback 检查单个用户的播放状态
func (ps *PreheatService) checkUserPlayback(ctx context.Context, userID int64) {
	// 获取用户播放状态
	position, duration, progress, isPlaying, err := cache.GetUserCurrentSongProgress(ctx, userID)
	if err != nil {
		return
	}

	// 检查是否正在播放
	if !isPlaying {
		return
	}

	// 检查是否需要预热
	if duration <= 0 {
		return
	}

	remainingSeconds := duration - position

	shouldPreheat := remainingSeconds <= DefaultPreheatConfig.TriggerRemainingSeconds ||
		progress >= DefaultPreheatConfig.TriggerProgressPercent

	if !shouldPreheat {
		return
	}

	// 获取下一首歌
	nextSong, hasNext, err := cache.GetUserNextSong(ctx, userID)
	if err != nil || !hasNext {
		return
	}

	ps.preheatUserSong(ctx, nextSong, userID)
}

// preheatUserSong 预热用户播放列表中的歌曲
func (ps *PreheatService) preheatUserSong(ctx context.Context, song *cache.PlaylistItem, userID int64) {
	// 确定歌曲 ID
	var songID string
	var isNetease bool

	if song.NeteaseID != 0 {
		songID = strconv.FormatInt(song.NeteaseID, 10)
		isNetease = true
	} else if song.SongID != "" {
		songID = song.SongID
		isNetease = true
	} else if song.TrackID != 0 {
		songID = strconv.FormatInt(song.TrackID, 10)
		isNetease = false
	} else {
		return
	}

	// 检查是否已预热或正在预热
	ps.preheatMu.Lock()
	if ps.preheatedSongs[songID] || ps.preheatProgress[songID] {
		ps.preheatMu.Unlock()
		return
	}
	ps.preheatProgress[songID] = true
	ps.preheatMu.Unlock()

	// 检查是否已经有 HLS 分片
	hlsState := GetProgressiveHLSManager().GetState(songID)
	if hlsState != nil && hlsState.HasEnoughSegmentsToPlay() {
		ps.markPreheated(songID)
		return
	}

	// 检查是否正在处理中
	if ps.mp3Processor.IsProcessing(songID) {
		ps.clearPreheatProgress(songID)
		return
	}

	logger.Info("开始预热用户歌曲",
		logger.Int64("userId", userID),
		logger.String("songId", songID),
		logger.String("title", song.Title),
		logger.Bool("isNetease", isNetease))

	// 异步预热
	go ps.doPreheat(songID, isNetease, song.Title)
}

// PreheatUserNextSong 手动触发预热用户的下一首歌
func (ps *PreheatService) PreheatUserNextSong(ctx context.Context, userID int64) error {
	nextSong, hasNext, err := cache.GetUserNextSong(ctx, userID)
	if err != nil {
		return err
	}

	if !hasNext {
		return fmt.Errorf("用户 %d 已经是最后一首歌", userID)
	}

	ps.preheatUserSong(ctx, nextSong, userID)
	return nil
}
