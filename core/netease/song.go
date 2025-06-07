package netease

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"Bt1QFM/config"
	"Bt1QFM/core/audio"
	"Bt1QFM/logger"
	"Bt1QFM/model"
	"Bt1QFM/repository"
)

// GetSongURL 获取歌曲URL
func (c *Client) GetSongURL(songID string) (string, error) {
	url := fmt.Sprintf("%s/song/url/v1?id=%s&level=lossless", c.BaseURL, songID)
	logger.Info("[GetSongURL] 开始获取歌曲URL", logger.String("song_id", songID))

	req, err := c.createRequest("GET", url)
	if err != nil {
		logger.Error("[GetSongURL] 创建请求失败", logger.String("song_id", songID), logger.ErrorField(err))
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
	logger.Debug("[GetSongURL] 发送请求到网易云API", logger.String("song_id", songID))
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		logger.Error("[GetSongURL] 请求失败", logger.String("song_id", songID), logger.ErrorField(err))
		return "", fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	// 检查响应状态码
	if resp.StatusCode != http.StatusOK {
		logger.Error("[GetSongURL] 服务器返回错误状态码", logger.String("song_id", songID), logger.Int("status_code", resp.StatusCode))
		return "", fmt.Errorf("API返回错误状态码: %d", resp.StatusCode)
	}

	// 读取原始响应数据
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.Error("[GetSongURL] 读取响应失败", logger.String("song_id", songID), logger.ErrorField(err))
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
		logger.Error("[GetSongURL] 解析响应失败", logger.String("song_id", songID), logger.ErrorField(err))
		return "", fmt.Errorf("解析响应失败: %w", err)
	}

	// 检查API返回码
	if result.Code != 200 {
		logger.Error("[GetSongURL] API返回错误", logger.String("song_id", songID), logger.String("msg", result.Msg), logger.Int("code", result.Code))
		return "", fmt.Errorf("API返回错误: %s (code: %d)", result.Msg, result.Code)
	}

	if len(result.Data) == 0 {
		logger.Error("[GetSongURL] 未找到歌曲数据", logger.String("song_id", songID))
		return "", fmt.Errorf("未找到歌曲数据")
	}

	if result.Data[0].URL == "" {
		logger.Warn("[GetSongURL] 歌曲URL为空，可能是版权限制", logger.String("song_id", songID))
		return "", fmt.Errorf("歌曲URL为空，可能是版权限制")
	}

	logger.Info("[GetSongURL] 成功获取歌曲URL", logger.String("song_id", songID))

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
			logger.Error("[GetSongURL] 转换歌曲ID失败", logger.String("song_id", songID), logger.ErrorField(err))
		} else {
			// 处理所有可能超长的字段
			filePath := result.Data[0].URL
			title := detail.Name
			artist := artistNames
			album := detail.Album.Name
			coverArtPath := detail.Album.PicURL

			// 打印原始长度
			logger.Debug("[GetSongURL] 字段长度",
				logger.Int("file_path_len", len(filePath)),
				logger.Int("title_len", len(title)),
				logger.Int("artist_len", len(artist)),
				logger.Int("album_len", len(album)),
				logger.Int("cover_art_path_len", len(coverArtPath)))

			// 处理过长的字段
			if len(filePath) > 255 {
				logger.Warn("[GetSongURL] file_path过长，使用标记替代", logger.String("song_id", songID))
				filePath = fmt.Sprintf("netease://%s", songID)
			}
			if len(title) > 255 {
				logger.Warn("[GetSongURL] title过长，进行截断", logger.String("song_id", songID))
				title = title[:252] + "..."
			}
			if len(artist) > 255 {
				logger.Warn("[GetSongURL] artist过长，进行截断", logger.String("song_id", songID))
				artist = artist[:252] + "..."
			}
			if len(album) > 255 {
				logger.Warn("[GetSongURL] album过长，进行截断", logger.String("song_id", songID))
				album = album[:252] + "..."
			}
			if len(coverArtPath) > 255 {
				logger.Warn("[GetSongURL] cover_art_path过长，使用标记替代", logger.String("song_id", songID))
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
				logger.Error("[GetSongURL] 更新歌曲信息失败", logger.String("song_id", songID), logger.ErrorField(err))
			} else if !updated {
				// 如果更新失败（记录不存在），则插入新记录
				_, err = repo.InsertNeteaseSong(dbSong)
				if err != nil {
					logger.Error("[GetSongURL] 插入歌曲信息失败", logger.String("song_id", songID), logger.ErrorField(err))
				} else {
					logger.Info("[GetSongURL] 成功插入歌曲信息", logger.String("song_id", songID))
				}
			} else {
				logger.Info("[GetSongURL] 成功更新歌曲信息", logger.String("song_id", songID))
			}
		}
	}

	return result.Data[0].URL, nil
}

// GetSongDetail 获取歌曲详情
func (c *Client) GetSongDetail(songID string) (*model.NeteaseSong, error) {
	url := fmt.Sprintf("%s/song/detail?ids=%s", c.BaseURL, songID)
	logger.Info("[GetSongDetail] 开始获取歌曲详情", logger.String("song_id", songID))

	req, err := c.createRequest("GET", url)
	if err != nil {
		logger.Error("[GetSongDetail] 创建请求失败", logger.String("song_id", songID), logger.ErrorField(err))
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		logger.Error("[GetSongDetail] 请求失败", logger.String("song_id", songID), logger.ErrorField(err))
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Songs []model.NeteaseSong `json:"songs"`
		Code  int                 `json:"code"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		logger.Error("[GetSongDetail] 解析响应失败", logger.String("song_id", songID), logger.ErrorField(err))
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	if len(result.Songs) > 0 {
		logger.Info("[GetSongDetail] 成功获取歌曲详情", logger.String("song_id", songID))
		return &result.Songs[0], nil
	}

	logger.Warn("[GetSongDetail] 未找到歌曲", logger.String("song_id", songID))
	return nil, fmt.Errorf("未找到歌曲")
}

// SearchSongs 搜索歌曲
func (c *Client) SearchSongs(keyword string, limit, offset int, mp3Processor *audio.MP3Processor, staticDir string) (*model.NeteaseSearchResult, error) {
	params := url.Values{}
	params.Set("keywords", keyword)
	params.Set("limit", fmt.Sprintf("%d", limit))
	params.Set("offset", fmt.Sprintf("%d", offset))

	url := fmt.Sprintf("%s/search?%s", c.BaseURL, params.Encode())
	logger.Info("[SearchSongs] 开始搜索歌曲",
		logger.String("keyword", keyword),
		logger.Int("limit", limit),
		logger.Int("offset", offset))

	req, err := c.createRequest("GET", url)
	if err != nil {
		logger.Error("[SearchSongs] 创建请求失败", logger.ErrorField(err))
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		logger.Error("[SearchSongs] 请求失败", logger.ErrorField(err))
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	// 读取原始响应数据
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.Error("[SearchSongs] 读取响应失败", logger.ErrorField(err))
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
		logger.Error("[SearchSongs] 解析响应失败", logger.ErrorField(err))
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	logger.Info("[SearchSongs] 搜索完成", logger.Int("songs_count", len(result.Result.Songs)))

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
			go func(songID int64, songName string) {
				streamID := fmt.Sprintf("%d", songID)
				logger.Info("[SearchSongs] 开始预处理歌曲", 
					logger.Int64("song_id", songID), 
					logger.String("name", songName))

				// 获取歌曲URL
				songURL, err := c.GetSongURL(streamID)
				if err != nil {
					logger.Error("[SearchSongs] 获取歌曲URL失败",
						logger.Int64("song_id", songID),
						logger.String("name", songName),
						logger.ErrorField(err))
					return
				}

				// 创建一个持久的临时文件，用于流处理
				tempFile, err := os.CreateTemp("", fmt.Sprintf("netease_%d_*.mp3", songID))
				if err != nil {
					logger.Error("[SearchSongs] 创建临时文件失败",
						logger.Int64("song_id", songID),
						logger.ErrorField(err))
					return
				}
				tempFilePath := tempFile.Name()
				tempFile.Close() // 关闭文件句柄但不删除文件

				// 下载文件
				if err := downloadFile(songURL, tempFilePath); err != nil {
					logger.Error("[SearchSongs] 下载音频文件失败",
						logger.Int64("song_id", songID),
						logger.String("name", songName),
						logger.ErrorField(err))
					os.Remove(tempFilePath) // 下载失败时清理文件
					return
				}

				// 验证文件是否存在且大小合理
				if fileInfo, err := os.Stat(tempFilePath); err != nil {
					logger.Error("[SearchSongs] 临时文件不存在",
						logger.Int64("song_id", songID),
						logger.String("tempFile", tempFilePath),
						logger.ErrorField(err))
					return
				} else if fileInfo.Size() == 0 {
					logger.Error("[SearchSongs] 临时文件为空",
						logger.Int64("song_id", songID),
						logger.String("tempFile", tempFilePath))
					os.Remove(tempFilePath)
					return
				} else {
					logger.Info("[SearchSongs] 文件下载完成",
						logger.Int64("song_id", songID),
						logger.String("tempFile", tempFilePath),
						logger.Int64("fileSize", fileInfo.Size()))
				}

				// 使用流处理器处理音频
				cfg := config.Load()
				streamProcessor := audio.NewStreamProcessor(mp3Processor, cfg)

				// 使用同步方式处理流，等待处理完成后再删除临时文件
				if err := streamProcessor.StreamProcessSync(context.Background(), streamID, tempFilePath, true); err != nil {
					logger.Error("[SearchSongs] 流处理失败",
						logger.Int64("song_id", songID),
						logger.String("name", songName),
						logger.String("tempFile", tempFilePath),
						logger.ErrorField(err))
				} else {
					logger.Info("[SearchSongs] 歌曲预处理完成",
						logger.Int64("song_id", songID),
						logger.String("name", songName))
				}

				// 处理完成后删除临时文件
				if err := os.Remove(tempFilePath); err != nil {
					logger.Warn("[SearchSongs] 清理临时文件失败",
						logger.String("tempFile", tempFilePath),
						logger.ErrorField(err))
				} else {
					logger.Debug("[SearchSongs] 临时文件已清理",
						logger.String("tempFile", tempFilePath))
				}
			}(song.ID, song.Name)
		}
	}

	return searchResult, nil
}

// downloadFile 下载文件的辅助函数
func downloadFile(url, filepath string) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	out, err := os.Create(filepath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

// GetDynamicCover 获取歌曲动态封面
func (c *Client) GetDynamicCover(songID string) (string, error) {
	url := fmt.Sprintf("%s/song/dynamic/cover?id=%s", c.BaseURL, songID)
	logger.Info("[GetDynamicCover] 开始获取动态封面", logger.String("song_id", songID))

	req, err := c.createRequest("GET", url)
	if err != nil {
		logger.Error("[GetDynamicCover] 创建请求失败", logger.String("song_id", songID), logger.ErrorField(err))
		return "", fmt.Errorf("创建请求失败: %w", err)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		logger.Error("[GetDynamicCover] 请求失败", logger.String("song_id", songID), logger.ErrorField(err))
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
		logger.Error("[GetDynamicCover] 解析响应失败", logger.String("song_id", songID), logger.ErrorField(err))
		return "", fmt.Errorf("解析响应失败: %w", err)
	}

	if result.Code != 200 {
		logger.Error("[GetDynamicCover] API返回错误", logger.String("song_id", songID), logger.String("message", result.Message), logger.Int("code", result.Code))
		return "", fmt.Errorf("API返回错误: %s (code: %d)", result.Message, result.Code)
	}

	if result.Data.VideoPlayURL == "" {
		logger.Warn("[GetDynamicCover] 未找到动态封面", logger.String("song_id", songID))
		return "", nil
	}

	logger.Info("[GetDynamicCover] 成功获取动态封面", logger.String("song_id", songID))
	return result.Data.VideoPlayURL, nil
}
