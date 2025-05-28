package netease

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"Bt1QFM/config"
	"Bt1QFM/core/audio"
	"Bt1QFM/core/utils"
	"Bt1QFM/model"
	"Bt1QFM/repository"
	"Bt1QFM/storage"

	"github.com/minio/minio-go/v7"
)

// GetSongURL 获取歌曲URL
func (c *Client) GetSongURL(songID string) (string, error) {
	url := fmt.Sprintf("%s/song/url/v1?id=%s&level=lossless", c.BaseURL, songID)
	log.Printf("[GetSongURL] 开始获取歌曲URL (ID: %s)", songID)

	req, err := c.createRequest("GET", url)
	if err != nil {
		log.Printf("[GetSongURL] 创建请求失败 (ID: %s): %v", songID, err)
		return "", fmt.Errorf("创建请求失败: %w", err)
	}

	// 设置cookie确保返回正常码率的url
	req.AddCookie(&http.Cookie{
		Name:  "os",
		Value: "pc",
	})

	// 设置超时时间
	c.HTTPClient.Timeout = 30 * time.Second

	// 发送请求
	log.Printf("[GetSongURL] 发送请求到网易云API (ID: %s)", songID)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		log.Printf("[GetSongURL] 请求失败 (ID: %s): %v", songID, err)
		return "", fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	// 检查响应状态码
	if resp.StatusCode != http.StatusOK {
		log.Printf("[GetSongURL] 服务器返回错误状态码 (ID: %s): %d", songID, resp.StatusCode)
		return "", fmt.Errorf("API返回错误状态码: %d", resp.StatusCode)
	}

	// 读取原始响应数据
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[GetSongURL] 读取响应失败 (ID: %s): %v", songID, err)
		return "", fmt.Errorf("读取响应失败: %w", err)
	}

	// 重新创建响应体
	resp.Body = io.NopCloser(bytes.NewBuffer(body))

	var result struct {
		Data []struct {
			ID  int64  `json:"id"`
			URL string `json:"url"`
		} `json:"data"`
		Code int    `json:"code"`
		Msg  string `json:"msg,omitempty"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[GetSongURL] 解析响应失败 (ID: %s): %v", songID, err)
		return "", fmt.Errorf("解析响应失败: %w", err)
	}

	// 检查API返回码
	if result.Code != 200 {
		log.Printf("[GetSongURL] API返回错误 (ID: %s): %s (code: %d)", songID, result.Msg, result.Code)
		return "", fmt.Errorf("API返回错误: %s (code: %d)", result.Msg, result.Code)
	}

	if len(result.Data) == 0 {
		log.Printf("[GetSongURL] 未找到歌曲数据 (ID: %s)", songID)
		return "", fmt.Errorf("未找到歌曲数据")
	}

	if result.Data[0].URL == "" {
		log.Printf("[GetSongURL] 歌曲URL为空，可能是版权限制 (ID: %s)", songID)
		return "", fmt.Errorf("歌曲URL为空，可能是版权限制")
	}

	log.Printf("[GetSongURL] 成功获取歌曲URL (ID: %s)", songID)

	// 新增：将歌曲信息存入netease_song表
	detail, err := c.GetSongDetail(songID)
	if err == nil && detail != nil {
		repo := repository.NewNeteaseSongRepository()
		artistNames := ""
		if len(detail.Artists) > 0 {
			for i, a := range detail.Artists {
				if i > 0 {
					artistNames += ","
				}
				artistNames += a.Name
			}
		}

		// 直接设置固定的HLS路径
		hlsPath := fmt.Sprintf("/streams/netease/%s/playlist.m3u8", songID)

		// 将字符串ID转换为int64
		id, err := strconv.ParseInt(songID, 10, 64)
		if err != nil {
			log.Printf("[GetSongURL] 转换歌曲ID失败 (ID: %s): %v", songID, err)
		} else {
			// 处理所有可能超长的字段
			filePath := result.Data[0].URL
			title := detail.Name
			artist := artistNames
			album := detail.Album.Name
			coverArtPath := detail.Album.PicURL

			// 打印原始长度
			log.Printf("[GetSongURL] 字段长度: file_path=%d, title=%d, artist=%d, album=%d, cover_art_path=%d",
				len(filePath), len(title), len(artist), len(album), len(coverArtPath))

			// 处理过长的字段
			if len(filePath) > 255 {
				log.Printf("[GetSongURL] file_path过长，使用标记替代 (ID: %s)", songID)
				filePath = fmt.Sprintf("netease://%s", songID)
			}
			if len(title) > 255 {
				log.Printf("[GetSongURL] title过长，进行截断 (ID: %s)", songID)
				title = title[:252] + "..."
			}
			if len(artist) > 255 {
				log.Printf("[GetSongURL] artist过长，进行截断 (ID: %s)", songID)
				artist = artist[:252] + "..."
			}
			if len(album) > 255 {
				log.Printf("[GetSongURL] album过长，进行截断 (ID: %s)", songID)
				album = album[:252] + "..."
			}
			if len(coverArtPath) > 255 {
				log.Printf("[GetSongURL] cover_art_path过长，使用标记替代 (ID: %s)", songID)
				coverArtPath = fmt.Sprintf("netease://cover/%s", songID)
			}

			dbSong := &model.NeteaseSongDB{
				ID:              id,
				Title:           title,
				Artist:          artist,
				Album:           album,
				FilePath:        filePath,
				CoverArtPath:    coverArtPath,
				HLSPlaylistPath: hlsPath,
				Duration:        float64(detail.Duration) / 1000.0,
			}

			// 先尝试更新，如果不存在则插入
			updated, err := repo.UpdateNeteaseSong(dbSong)
			if err != nil {
				log.Printf("[GetSongURL] 更新歌曲信息失败 (ID: %s): %v", songID, err)
			} else if !updated {
				// 如果更新失败（记录不存在），则插入新记录
				_, err = repo.InsertNeteaseSong(dbSong)
				if err != nil {
					log.Printf("[GetSongURL] 插入歌曲信息失败 (ID: %s): %v", songID, err)
				} else {
					log.Printf("[GetSongURL] 成功插入歌曲信息 (ID: %s)", songID)
				}
			} else {
				log.Printf("[GetSongURL] 成功更新歌曲信息 (ID: %s)", songID)
			}
		}
	}

	return result.Data[0].URL, nil
}

// GetSongDetail 获取歌曲详情
func (c *Client) GetSongDetail(songID string) (*model.NeteaseSong, error) {
	url := fmt.Sprintf("%s/song/detail?ids=%s", c.BaseURL, songID)
	log.Printf("[GetSongDetail] 开始获取歌曲详情 (ID: %s)", songID)

	req, err := c.createRequest("GET", url)
	if err != nil {
		log.Printf("[GetSongDetail] 创建请求失败 (ID: %s): %v", songID, err)
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		log.Printf("[GetSongDetail] 请求失败 (ID: %s): %v", songID, err)
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Songs []model.NeteaseSong `json:"songs"`
		Code  int                 `json:"code"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[GetSongDetail] 解析响应失败 (ID: %s): %v", songID, err)
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	if len(result.Songs) > 0 {
		log.Printf("[GetSongDetail] 成功获取歌曲详情 (ID: %s)", songID)
		return &result.Songs[0], nil
	}

	log.Printf("[GetSongDetail] 未找到歌曲 (ID: %s)", songID)
	return nil, fmt.Errorf("未找到歌曲")
}

// SearchSongs 搜索歌曲
func (c *Client) SearchSongs(keyword string, limit, offset int, mp3Processor *audio.MP3Processor, staticDir string) (*model.NeteaseSearchResult, error) {
	params := url.Values{}
	params.Set("keywords", keyword)
	params.Set("limit", fmt.Sprintf("%d", limit))
	params.Set("offset", fmt.Sprintf("%d", offset))

	url := fmt.Sprintf("%s/search?%s", c.BaseURL, params.Encode())
	log.Printf("[SearchSongs] 开始搜索歌曲 (关键词: %s, 限制: %d, 偏移: %d)", keyword, limit, offset)

	req, err := c.createRequest("GET", url)
	if err != nil {
		log.Printf("[SearchSongs] 创建请求失败: %v", err)
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		log.Printf("[SearchSongs] 请求失败: %v", err)
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	// 读取原始响应数据
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[SearchSongs] 读取响应失败: %v", err)
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	// 重新创建响应体
	resp.Body = io.NopCloser(bytes.NewBuffer(body))

	var result struct {
		Result struct {
			Songs []struct {
				ID      int64  `json:"id"`
				Name    string `json:"name"`
				Artists []struct {
					ID        int64  `json:"id"`
					Name      string `json:"name"`
					Img1v1Url string `json:"img1v1Url"`
				} `json:"artists"`
				Album struct {
					ID     int64  `json:"id"`
					Name   string `json:"name"`
					PicID  int64  `json:"picId"`
					PicUrl string `json:"picUrl"` // 添加专辑封面URL
				} `json:"album"`
				Duration int `json:"duration"`
			} `json:"songs"`
			Total int `json:"songCount"`
		} `json:"result"`
		Code int `json:"code"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[SearchSongs] 解析响应失败: %v", err)
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	log.Printf("[SearchSongs] 搜索完成，找到 %d 首歌曲", len(result.Result.Songs))

	// 转换结果
	searchResult := &model.NeteaseSearchResult{
		Total: result.Result.Total,
		Songs: make([]model.NeteaseSong, len(result.Result.Songs)),
	}

	for i, song := range result.Result.Songs {
		// 使用专辑封面URL，如果没有则使用第一个艺术家的图片
		picURL := song.Album.PicUrl
		if picURL == "" && len(song.Artists) > 0 && song.Artists[0].Img1v1Url != "" {
			picURL = song.Artists[0].Img1v1Url
		}

		artists := make([]model.NeteaseArtist, len(song.Artists))
		for j, artist := range song.Artists {
			artists[j] = model.NeteaseArtist{
				ID:   artist.ID,
				Name: artist.Name,
			}
		}

		searchResult.Songs[i] = model.NeteaseSong{
			ID:      song.ID,
			Name:    song.Name,
			Artists: artists,
			Album: model.NeteaseAlbum{
				ID:     song.Album.ID,
				Name:   song.Album.Name,
				PicURL: picURL,
			},
			Duration: song.Duration,
		}

		// 获取第一首歌的URL并预处理
		if i == 0 && mp3Processor != nil && staticDir != "" {
			// 异步预处理第一首歌
			go func() {
				cfg := config.Load()
				minioClient := storage.GetMinioClient()
				if minioClient == nil {
					log.Printf("[SearchSongs] MinIO客户端为空，无法上传到MinIO (歌曲: %s)", song.Name)
					return
				}

				// 检查是否已经处理过
				var err error
				m3u8Path := fmt.Sprintf("streams/netease/%d/playlist.m3u8", song.ID)
				_, err = minioClient.StatObject(context.Background(), cfg.MinioBucket, m3u8Path, minio.StatObjectOptions{})
				if err == nil {
					log.Printf("[SearchSongs] 歌曲已预处理过，跳过 (ID: %d, 名称: %s)", song.ID, song.Name)
					return
				}

				// 获取歌曲URL
				songURL, err := c.GetSongURL(fmt.Sprintf("%d", song.ID))
				if err != nil {
					log.Printf("[SearchSongs] 获取歌曲URL失败 (ID: %d, 名称: %s): %v", song.ID, song.Name, err)
					return
				}

				// 下载音频文件
				tempDir := filepath.Join(staticDir, "temp", fmt.Sprintf("%d", song.ID))
				os.MkdirAll(tempDir, 0755)
				defer os.RemoveAll(tempDir)

				mp3Path := filepath.Join(tempDir, "original.mp3")
				if err := utils.DownloadFile(songURL, mp3Path); err != nil {
					log.Printf("[SearchSongs] 下载音频文件失败 (ID: %d, 名称: %s): %v", song.ID, song.Name, err)
					return
				}

				// 优化音频文件
				optimizedPath := filepath.Join(tempDir, "optimized.mp3")
				if err := mp3Processor.OptimizeMP3(mp3Path, optimizedPath); err != nil {
					log.Printf("[SearchSongs] 优化音频文件失败 (ID: %d, 名称: %s): %v", song.ID, song.Name, err)
					return
				}

				// 转换为HLS格式
				hlsDir := filepath.Join(tempDir, "streams/netease")
				outputM3U8 := filepath.Join(hlsDir, "playlist.m3u8")
				segmentPattern := filepath.Join(hlsDir, "segment_%03d.ts")
				hlsBaseURL := fmt.Sprintf("/streams/netease/%d/", song.ID)

				_, err = mp3Processor.ProcessToHLS(optimizedPath, outputM3U8, segmentPattern, hlsBaseURL, "192k", "4")
				if err != nil {
					log.Printf("[SearchSongs] 转换为HLS格式失败 (ID: %d, 名称: %s): %v", song.ID, song.Name, err)
					return
				}

				// 上传到MinIO
				// 上传m3u8文件
				minioM3U8Path := fmt.Sprintf("streams/netease/%d/playlist.m3u8", song.ID)
				m3u8Content, err := os.ReadFile(outputM3U8)
				if err != nil {
					log.Printf("[SearchSongs] 读取m3u8文件失败 (ID: %d, 名称: %s): %v", song.ID, song.Name, err)
					return
				}
				log.Printf("m3u8Path: %s", minioM3U8Path)

				_, err = minioClient.PutObject(context.Background(), cfg.MinioBucket, minioM3U8Path, bytes.NewReader(m3u8Content), int64(len(m3u8Content)), minio.PutObjectOptions{
					ContentType: "application/vnd.apple.mpegurl",
				})
				if err != nil {
					log.Printf("[SearchSongs] 上传m3u8文件失败 (ID: %d, 名称: %s): %v", song.ID, song.Name, err)
					return
				}

				// 上传ts文件
				tsFiles, err := filepath.Glob(filepath.Join(hlsDir, "*.ts"))
				if err != nil {
					log.Printf("[SearchSongs] 查找ts文件失败 (ID: %d, 名称: %s): %v", song.ID, song.Name, err)
					return
				}
				log.Printf("tsFiles: %v", tsFiles)

				log.Printf("[SearchSongs] 开始上传分片文件 (ID: %d, 名称: %s, 分片数量: %d)", song.ID, song.Name, len(tsFiles))
				for _, tsFile := range tsFiles {
					segmentName := filepath.Base(tsFile)
					segmentPath := fmt.Sprintf("streams/netease/%d/%s", song.ID, segmentName)
					segmentContent, err := os.ReadFile(tsFile)
					if err != nil {
						log.Printf("[SearchSongs] 读取ts文件失败 (ID: %d, 名称: %s, 文件: %s): %v",
							song.ID, song.Name, segmentName, err)
						continue
					}

					_, err = minioClient.PutObject(context.Background(), cfg.MinioBucket, segmentPath, bytes.NewReader(segmentContent), int64(len(segmentContent)), minio.PutObjectOptions{
						ContentType: "video/MP2T",
					})
					if err != nil {
						log.Printf("[SearchSongs] 上传ts文件失败 (ID: %d, 名称: %s, 文件: %s): %v",
							song.ID, song.Name, segmentName, err)
						continue
					}
				}

				log.Printf("[SearchSongs] 歌曲预处理完成 (ID: %d, 名称: %s)", song.ID, song.Name)
			}()
		}
	}

	return searchResult, nil
}

// GetDynamicCover 获取歌曲动态封面
func (c *Client) GetDynamicCover(songID string) (string, error) {
	url := fmt.Sprintf("%s/song/dynamic/cover?id=%s", c.BaseURL, songID)
	log.Printf("[GetDynamicCover] 开始获取动态封面 (ID: %s)", songID)

	req, err := c.createRequest("GET", url)
	if err != nil {
		log.Printf("[GetDynamicCover] 创建请求失败 (ID: %s): %v", songID, err)
		return "", fmt.Errorf("创建请求失败: %w", err)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		log.Printf("[GetDynamicCover] 请求失败 (ID: %s): %v", songID, err)
		return "", fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			VideoPlayURL string `json:"videoPlayUrl"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("[GetDynamicCover] 解析响应失败 (ID: %s): %v", songID, err)
		return "", fmt.Errorf("解析响应失败: %w", err)
	}

	if result.Code != 200 {
		log.Printf("[GetDynamicCover] API返回错误 (ID: %s): %s (code: %d)", songID, result.Message, result.Code)
		return "", fmt.Errorf("API返回错误: %s (code: %d)", result.Message, result.Code)
	}

	if result.Data.VideoPlayURL == "" {
		log.Printf("[GetDynamicCover] 未找到动态封面 (ID: %s)", songID)
		return "", nil
	}

	log.Printf("[GetDynamicCover] 成功获取动态封面 (ID: %s)", songID)
	return result.Data.VideoPlayURL, nil
}
