package netease

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"Bt1QFM/config"
	"Bt1QFM/core/audio"
	"Bt1QFM/storage"

	"github.com/minio/minio-go/v7"
)

// NeteaseHandler 处理网易云音乐相关的请求
type NeteaseHandler struct {
	client       *Client
	mp3Processor *audio.MP3Processor
	config       *config.Config
}

// NewNeteaseHandler 创建新的网易云音乐处理器
func NewNeteaseHandler(baseURL string, cfg *config.Config) *NeteaseHandler {
	client := NewClient()
	client.SetBaseURL(baseURL)
	return &NeteaseHandler{
		client:       client,
		mp3Processor: audio.NewMP3Processor(cfg.FFmpegPath),
		config:       cfg,
	}
}

// SearchResponse 搜索响应结构
type SearchResponse struct {
	Success bool             `json:"success"`
	Data    []SearchSongItem `json:"data"`
	Error   string           `json:"error,omitempty"`
}

// SearchSongItem 搜索结果项
type SearchSongItem struct {
	ID       int64    `json:"id"`
	Name     string   `json:"name"`
	Artists  []string `json:"artists"`
	Album    string   `json:"album"`
	Duration int      `json:"duration"`
	URL      string   `json:"url,omitempty"`
	PicURL   string   `json:"picUrl,omitempty"`
	VideoURL string   `json:"videoUrl,omitempty"` // 动态封面视频URL
}

// HandleSearch 处理搜索请求
func (h *NeteaseHandler) HandleSearch(w http.ResponseWriter, r *http.Request) {
	// 获取查询参数
	query := r.URL.Query().Get("q")
	if query == "" {
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "请提供搜索关键词",
		})
		return
	}

	log.Printf("开始搜索歌曲: %s", query)

	// 使用已实现的SearchSongs函数
	result, err := h.client.SearchSongs(query, 5, 0)
	if err != nil {
		log.Printf("搜索失败: %v", err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "搜索失败: " + err.Error(),
		})
		return
	}

	log.Printf("搜索成功，找到 %d 首歌曲", len(result.Songs))

	// 转换结果格式
	response := SearchResponse{
		Success: true,
		Data:    make([]SearchSongItem, 0, len(result.Songs)),
	}

	for _, song := range result.Songs {
		// 获取艺术家名称
		artistNames := make([]string, len(song.Artists))
		for i, artist := range song.Artists {
			artistNames[i] = artist.Name
		}

		log.Printf("处理歌曲: %s, 专辑封面URL: %s", song.Name, song.Album.PicURL)

		// 获取动态封面
		videoURL, err := h.client.GetDynamicCover(fmt.Sprintf("%d", song.ID))
		if err != nil {
			log.Printf("获取动态封面失败: %v", err)
			// 继续处理，不中断流程
		}

		item := SearchSongItem{
			ID:       song.ID,
			Name:     song.Name,
			Artists:  artistNames,
			Album:    song.Album.Name,
			Duration: song.Duration,
			PicURL:   song.Album.PicURL,
			VideoURL: videoURL,
		}
		response.Data = append(response.Data, item)
	}

	// 返回结果
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
	log.Printf("搜索请求处理完成")
}

// HandleCommand 处理命令请求
func (h *NeteaseHandler) HandleCommand(w http.ResponseWriter, r *http.Request) {
	// 获取命令文本
	command := r.URL.Query().Get("command")
	if command == "" {
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "请提供命令",
		})
		return
	}

	log.Printf("收到前端请求: %s", r.URL.String())
	log.Printf("处理命令: %s", command)

	// 解析命令
	parts := strings.Fields(command)
	if len(parts) < 2 || parts[0] != "/netease" {
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "无效的命令格式，请使用 /netease [歌曲ID]",
		})
		return
	}

	// 提取歌曲ID
	songIDStr := parts[1]
	songID, err := strconv.ParseInt(songIDStr, 10, 64)
	if err != nil {
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "无效的歌曲ID: " + err.Error(),
		})
		return
	}

	log.Printf("准备转发请求到网易云API，歌曲ID: %s", songIDStr)

	// 获取歌曲URL
	url, err := h.client.GetSongURL(songIDStr)
	if err != nil {
		log.Printf("获取歌曲URL失败: %v", err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "获取播放地址失败: " + err.Error(),
		})
		return
	}

	// 创建临时目录用于存储音频文件
	tempDir := filepath.Join(h.config.StaticDir, "temp", "netease")
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		log.Printf("创建临时目录失败: %v", err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "创建临时目录失败: " + err.Error(),
		})
		return
	}

	// 下载音频文件
	tempFile := filepath.Join(tempDir, fmt.Sprintf("%s.mp3", songIDStr))
	if err := downloadFile(url, tempFile); err != nil {
		log.Printf("下载音频文件失败: %v", err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "下载音频文件失败: " + err.Error(),
		})
		return
	}
	defer os.Remove(tempFile) // 清理临时文件

	// 优化MP3文件
	optimizedFile := filepath.Join(tempDir, fmt.Sprintf("%s_optimized.mp3", songIDStr))
	if err := h.mp3Processor.OptimizeMP3(tempFile, optimizedFile); err != nil {
		log.Printf("优化MP3文件失败: %v", err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "优化MP3文件失败: " + err.Error(),
		})
		return
	}
	defer os.Remove(optimizedFile) // 清理临时文件

	// 转换为HLS格式
	hlsDir := filepath.Join(h.config.StaticDir, "streams", "netease", songIDStr)
	if err := os.MkdirAll(hlsDir, 0755); err != nil {
		log.Printf("创建HLS目录失败: %v", err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "创建HLS目录失败: " + err.Error(),
		})
		return
	}

	outputM3U8 := filepath.Join(hlsDir, "playlist.m3u8")
	segmentPattern := filepath.Join(hlsDir, "segment_%03d.ts")
	hlsBaseURL := fmt.Sprintf("/streams/netease/%s/", songIDStr)

	// 处理为HLS格式
	duration, err := h.mp3Processor.ProcessToHLS(
		optimizedFile,
		outputM3U8,
		segmentPattern,
		hlsBaseURL,
		"192k",
		"4",
	)
	if err != nil {
		log.Printf("转换为HLS格式失败: %v", err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "转换为HLS格式失败: " + err.Error(),
		})
		return
	}

	// 上传HLS文件到MinIO
	minioClient := storage.GetMinioClient()
	if minioClient == nil {
		log.Printf("MinIO客户端未初始化")
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "存储服务未初始化",
		})
		return
	}

	// 上传m3u8文件
	m3u8Content, err := os.ReadFile(outputM3U8)
	if err != nil {
		log.Printf("读取m3u8文件失败: %v", err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "读取m3u8文件失败: " + err.Error(),
		})
		return
	}

	// 上传m3u8文件到MinIO
	m3u8Path := fmt.Sprintf("streams/netease/%s/playlist.m3u8", songIDStr)
	_, err = minioClient.PutObject(context.Background(), h.config.MinioBucket, m3u8Path, bytes.NewReader(m3u8Content), int64(len(m3u8Content)), minio.PutObjectOptions{
		ContentType: "application/vnd.apple.mpegurl",
	})
	if err != nil {
		log.Printf("上传m3u8文件到MinIO失败: %v", err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "上传m3u8文件失败: " + err.Error(),
		})
		return
	}

	// 上传所有分片文件
	segments, err := filepath.Glob(filepath.Join(hlsDir, "segment_*.ts"))
	if err != nil {
		log.Printf("获取分片文件列表失败: %v", err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "获取分片文件列表失败: " + err.Error(),
		})
		return
	}

	for _, segment := range segments {
		segmentContent, err := os.ReadFile(segment)
		if err != nil {
			log.Printf("读取分片文件失败: %v", err)
			continue
		}

		segmentName := filepath.Base(segment)
		segmentPath := fmt.Sprintf("streams/netease/%s/%s", songIDStr, segmentName)
		_, err = minioClient.PutObject(context.Background(), h.config.MinioBucket, segmentPath, bytes.NewReader(segmentContent), int64(len(segmentContent)), minio.PutObjectOptions{
			ContentType: "video/MP2T",
		})
		if err != nil {
			log.Printf("上传分片文件到MinIO失败: %v", err)
			continue
		}
	}

	// 清理临时文件
	os.RemoveAll(hlsDir)

	// 返回HLS播放地址
	hlsURL := fmt.Sprintf("/streams/netease/%s/playlist.m3u8", songIDStr)
	response := SearchResponse{
		Success: true,
		Data: []SearchSongItem{
			{
				ID:       songID,
				URL:      hlsURL,
				Duration: int(duration * 1000), // 转换为毫秒
			},
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
	log.Printf("请求处理完成，已返回HLS播放地址: %s", hlsURL)
}

// downloadFile 下载文件到指定路径
func downloadFile(url, filepath string) error {
	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("下载文件失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载文件失败，状态码: %d", resp.StatusCode)
	}

	out, err := os.Create(filepath)
	if err != nil {
		return fmt.Errorf("创建文件失败: %w", err)
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return fmt.Errorf("保存文件失败: %w", err)
	}

	return nil
}
