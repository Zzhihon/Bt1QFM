package netease

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"Bt1QFM/config"
	"Bt1QFM/core/audio"
	"Bt1QFM/core/utils"
	"Bt1QFM/repository"
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
		log.Printf("[HandleSearch] 错误: 缺少搜索关键词")
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "请提供搜索关键词",
		})
		return
	}

	log.Printf("[HandleSearch] 开始搜索歌曲: %s", query)

	// 使用已实现的SearchSongs函数
	result, err := h.client.SearchSongs(query, 5, 0, h.mp3Processor, h.config.StaticDir)
	if err != nil {
		log.Printf("[HandleSearch] 搜索失败: %v", err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "搜索失败: " + err.Error(),
		})
		return
	}

	log.Printf("[HandleSearch] 搜索成功，找到 %d 首歌曲", len(result.Songs))

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

		log.Printf("[HandleSearch] 处理歌曲: %s (ID: %d)", song.Name, song.ID)

		// 获取动态封面
		videoURL, err := h.client.GetDynamicCover(fmt.Sprintf("%d", song.ID))
		if err != nil {
			log.Printf("[HandleSearch] 获取动态封面失败 (歌曲ID: %d): %v", song.ID, err)
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
	log.Printf("[HandleSearch] 搜索请求处理完成")
}

// checkAndUpdateHLS 异步检查并更新HLS路径
func (h *NeteaseHandler) checkAndUpdateHLS(songID string) {
	log.Printf("[checkAndUpdateHLS] 开始检查歌曲HLS路径 (ID: %s)", songID)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[checkAndUpdateHLS] 发生panic (ID: %s): %v", songID, r)
			}
		}()

		if songID == "" {
			log.Printf("[checkAndUpdateHLS] 歌曲ID为空")
			return
		}

		log.Printf("[checkAndUpdateHLS] 创建仓库实例 (ID: %s)", songID)
		repo := repository.NewNeteaseSongRepository()
		if repo == nil {
			log.Printf("[checkAndUpdateHLS] 创建仓库失败 (ID: %s)", songID)
			return
		}

		// 检查数据库中是否存在该歌曲
		log.Printf("[checkAndUpdateHLS] 查询数据库中的歌曲信息 (ID: %s)", songID)
		song, err := repo.GetNeteaseSongByID(songID)
		if err != nil {
			log.Printf("[checkAndUpdateHLS] 获取歌曲信息失败 (ID: %s): %v", songID, err)
			return
		}

		if song == nil {
			log.Printf("[checkAndUpdateHLS] 数据库中不存在该歌曲，需要创建新记录 (ID: %s)", songID)
		} else {
			log.Printf("[checkAndUpdateHLS] 数据库中的歌曲信息: ID=%d, Title=%s, HLS路径=%s",
				song.ID, song.Title, song.HLSPlaylistPath)
		}

		// 如果歌曲不存在或HLS路径为空，则调用GetSongURL更新
		if song == nil || song.HLSPlaylistPath == "" {
			log.Printf("[checkAndUpdateHLS] 开始调用GetSongURL更新歌曲信息 (ID: %s)", songID)
			url, err := h.client.GetSongURL(songID)
			if err != nil {
				log.Printf("[checkAndUpdateHLS] 更新歌曲信息失败 (ID: %s): %v", songID, err)
				return
			}
			log.Printf("[checkAndUpdateHLS] GetSongURL返回URL: %s (ID: %s)", url, songID)

			// 再次检查数据库更新情况
			updatedSong, err := repo.GetNeteaseSongByID(songID)
			if err != nil {
				log.Printf("[checkAndUpdateHLS] 更新后查询歌曲信息失败 (ID: %s): %v", songID, err)
				return
			}
			if updatedSong != nil {
				log.Printf("[checkAndUpdateHLS] 更新后的歌曲信息: ID=%d, Title=%s, HLS路径=%s",
					updatedSong.ID, updatedSong.Title, updatedSong.HLSPlaylistPath)
			} else {
				log.Printf("[checkAndUpdateHLS] 更新后未找到歌曲信息 (ID: %s)", songID)
			}
		} else {
			log.Printf("[checkAndUpdateHLS] 歌曲HLS路径已存在，无需更新 (ID: %s, HLS路径: %s)",
				songID, song.HLSPlaylistPath)
		}
	}()
}

// HandleCommand 处理命令请求
func (h *NeteaseHandler) HandleCommand(w http.ResponseWriter, r *http.Request) {
	// 获取命令文本
	command := r.URL.Query().Get("command")
	if command == "" {
		log.Printf("[HandleCommand] 错误: 缺少命令参数")
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "请提供命令",
		})
		return
	}

	log.Printf("[HandleCommand] 开始处理命令: %s", command)

	// 解析命令
	parts := strings.Fields(command)
	if len(parts) < 2 || parts[0] != "/netease" {
		log.Printf("[HandleCommand] 错误: 无效的命令格式: %s", command)
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
		log.Printf("[HandleCommand] 错误: 无效的歌曲ID: %s, 错误: %v", songIDStr, err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "无效的歌曲ID: " + err.Error(),
		})
		return
	}

	// 检查处理状态
	status := h.mp3Processor.GetProcessingStatus(songIDStr)
	if status != nil {
		if status.IsProcessing {
			log.Printf("[HandleCommand] 歌曲正在处理中 (ID: %s)", songIDStr)
			json.NewEncoder(w).Encode(SearchResponse{
				Success: false,
				Error:   "歌曲正在处理中，请稍后再试",
			})
			return
		}
		if status.Error != nil && status.RetryCount < status.MaxRetries {
			log.Printf("[HandleCommand] 处理失败，准备重试 (ID: %s, 重试次数: %d/%d)",
				songIDStr, status.RetryCount+1, status.MaxRetries)
		} else if status.Error != nil {
			log.Printf("[HandleCommand] 处理失败，超过最大重试次数 (ID: %s, 错误: %v)",
				songIDStr, status.Error)
			json.NewEncoder(w).Encode(SearchResponse{
				Success: false,
				Error:   "处理失败，请稍后重试",
			})
			return
		}
	}

	// 异步检查并更新HLS路径
	h.checkAndUpdateHLS(songIDStr)

	log.Printf("[HandleCommand] 开始获取歌曲URL (ID: %s)", songIDStr)

	// 获取歌曲URL
	url, err := h.client.GetSongURL(songIDStr)
	if err != nil {
		log.Printf("[HandleCommand] 获取歌曲URL失败 (ID: %s): %v", songIDStr, err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "获取播放地址失败: " + err.Error(),
		})
		return
	}

	// 检查MinIO中是否已存在该歌曲的HLS文件
	minioClient := storage.GetMinioClient()
	if minioClient == nil {
		log.Printf("[HandleCommand] 错误: MinIO客户端未初始化")
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "存储服务未初始化",
		})
		return
	}

	// 检查m3u8文件是否存在
	m3u8Path := fmt.Sprintf("streams/netease/%s/playlist.m3u8", songIDStr)
	_, err = minioClient.StatObject(context.Background(), h.config.MinioBucket, m3u8Path, minio.StatObjectOptions{})
	if err == nil {
		log.Printf("[HandleCommand] 发现已存在的HLS文件 (ID: %s)", songIDStr)
		hlsURL := fmt.Sprintf("/streams/netease/%s/playlist.m3u8", songIDStr)
		response := SearchResponse{
			Success: true,
			Data: []SearchSongItem{
				{
					ID:  songID,
					URL: hlsURL,
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	// 设置处理状态
	h.mp3Processor.SetProcessingStatus(songIDStr, true, nil)

	// 创建临时目录
	tempDir := filepath.Join(h.config.StaticDir, "temp", "netease")
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		log.Printf("[HandleCommand] 创建临时目录失败 (ID: %s): %v", songIDStr, err)
		h.mp3Processor.UpdateProcessingStatus(songIDStr, err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "创建临时目录失败: " + err.Error(),
		})
		return
	}

	// 下载音频文件
	tempFile := filepath.Join(tempDir, fmt.Sprintf("%s.mp3", songIDStr))
	log.Printf("[HandleCommand] 开始下载音频文件 (ID: %s)", songIDStr)
	if err := utils.DownloadFile(url, tempFile); err != nil {
		log.Printf("[HandleCommand] 下载音频文件失败 (ID: %s): %v", songIDStr, err)
		h.mp3Processor.UpdateProcessingStatus(songIDStr, err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "下载音频文件失败: " + err.Error(),
		})
		return
	}
	defer os.Remove(tempFile)

	// 优化MP3文件
	optimizedFile := filepath.Join(tempDir, fmt.Sprintf("%s_optimized.mp3", songIDStr))
	log.Printf("[HandleCommand] 开始优化MP3文件 (ID: %s)", songIDStr)
	if err := h.mp3Processor.OptimizeMP3(tempFile, optimizedFile); err != nil {
		log.Printf("[HandleCommand] 优化MP3文件失败 (ID: %s): %v", songIDStr, err)
		h.mp3Processor.UpdateProcessingStatus(songIDStr, err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "优化MP3文件失败: " + err.Error(),
		})
		return
	}
	defer os.Remove(optimizedFile)

	// 转换为HLS格式
	hlsDir := filepath.Join(h.config.StaticDir, "streams", "netease", songIDStr)
	if err := os.MkdirAll(hlsDir, 0755); err != nil {
		log.Printf("[HandleCommand] 创建HLS目录失败 (ID: %s): %v", songIDStr, err)
		h.mp3Processor.UpdateProcessingStatus(songIDStr, err)
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
	log.Printf("[HandleCommand] 开始转换为HLS格式 (ID: %s)", songIDStr)
	duration, err := h.mp3Processor.ProcessToHLS(
		optimizedFile,
		outputM3U8,
		segmentPattern,
		hlsBaseURL,
		"192k",
		"4",
	)
	if err != nil {
		log.Printf("[HandleCommand] 转换为HLS格式失败 (ID: %s): %v", songIDStr, err)
		h.mp3Processor.UpdateProcessingStatus(songIDStr, err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "转换为HLS格式失败: " + err.Error(),
		})
		return
	}

	// 上传HLS文件到MinIO
	log.Printf("[HandleCommand] 开始上传HLS文件到MinIO (ID: %s)", songIDStr)

	// 上传m3u8文件
	m3u8Content, err := os.ReadFile(outputM3U8)
	if err != nil {
		log.Printf("[HandleCommand] 读取m3u8文件失败 (ID: %s): %v", songIDStr, err)
		h.mp3Processor.UpdateProcessingStatus(songIDStr, err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "读取m3u8文件失败: " + err.Error(),
		})
		return
	}

	_, err = minioClient.PutObject(context.Background(), h.config.MinioBucket, m3u8Path, bytes.NewReader(m3u8Content), int64(len(m3u8Content)), minio.PutObjectOptions{
		ContentType: "application/vnd.apple.mpegurl",
	})
	if err != nil {
		log.Printf("[HandleCommand] 上传m3u8文件到MinIO失败 (ID: %s): %v", songIDStr, err)
		h.mp3Processor.UpdateProcessingStatus(songIDStr, err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "上传m3u8文件失败: " + err.Error(),
		})
		return
	}

	// 上传所有分片文件
	segments, err := filepath.Glob(filepath.Join(hlsDir, "segment_*.ts"))
	if err != nil {
		log.Printf("[HandleCommand] 获取分片文件列表失败 (ID: %s): %v", songIDStr, err)
		h.mp3Processor.UpdateProcessingStatus(songIDStr, err)
		json.NewEncoder(w).Encode(SearchResponse{
			Success: false,
			Error:   "获取分片文件列表失败: " + err.Error(),
		})
		return
	}

	log.Printf("[HandleCommand] 开始上传分片文件 (ID: %s, 分片数量: %d)", songIDStr, len(segments))
	for _, segment := range segments {
		segmentContent, err := os.ReadFile(segment)
		if err != nil {
			log.Printf("[HandleCommand] 读取分片文件失败 (ID: %s, 文件: %s): %v",
				songIDStr, filepath.Base(segment), err)
			continue
		}

		segmentName := filepath.Base(segment)
		segmentPath := fmt.Sprintf("streams/netease/%s/%s", songIDStr, segmentName)
		_, err = minioClient.PutObject(context.Background(), h.config.MinioBucket, segmentPath, bytes.NewReader(segmentContent), int64(len(segmentContent)), minio.PutObjectOptions{
			ContentType: "video/MP2T",
		})
		if err != nil {
			log.Printf("[HandleCommand] 上传分片文件失败 (ID: %s, 文件: %s): %v",
				songIDStr, segmentName, err)
			continue
		}
	}

	// 清理临时文件
	os.RemoveAll(hlsDir)

	// 更新处理状态为成功
	h.mp3Processor.UpdateProcessingStatus(songIDStr, nil)

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
	log.Printf("[HandleCommand] 处理完成 (ID: %s, 播放地址: %s)", songIDStr, hlsURL)
}
