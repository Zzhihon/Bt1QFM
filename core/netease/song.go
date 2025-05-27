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
	"time"

	"Bt1QFM/config"
	"Bt1QFM/core/audio"
	"Bt1QFM/core/utils"
	"Bt1QFM/model"
	"Bt1QFM/storage"

	"github.com/minio/minio-go/v7"
)

// GetSongURL 获取歌曲URL
func (c *Client) GetSongURL(songID string) (string, error) {
	url := fmt.Sprintf("%s/song/url/v1?id=%s&level=lossless", c.BaseURL, songID)
	log.Printf("准备发送请求到: %s", url)
	log.Printf("使用的BaseURL: %s", c.BaseURL)

	req, err := c.createRequest("GET", url)
	if err != nil {
		log.Printf("创建请求失败: %v", err)
		return "", fmt.Errorf("创建请求失败: %w", err)
	}

	// 设置cookie确保返回正常码率的url
	req.AddCookie(&http.Cookie{
		Name:  "os",
		Value: "pc",
	})

	// 打印所有请求头
	log.Printf("请求头信息:")
	for key, values := range req.Header {
		log.Printf("%s: %v", key, values)
	}

	// 设置超时时间
	c.HTTPClient.Timeout = 30 * time.Second

	// 发送请求
	log.Printf("开始发送请求到网易云API...")
	log.Printf("完整请求URL: %s", req.URL.String())

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		log.Printf("请求失败: %v", err)
		return "", fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	// 检查响应状态码
	if resp.StatusCode != http.StatusOK {
		log.Printf("服务器返回错误状态码: %d", resp.StatusCode)
		return "", fmt.Errorf("API返回错误状态码: %d", resp.StatusCode)
	}

	// 打印响应头
	log.Printf("响应头信息:")
	for key, values := range resp.Header {
		log.Printf("%s: %v", key, values)
	}

	// 读取原始响应数据
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("读取响应失败: %v", err)
		return "", fmt.Errorf("读取响应失败: %w", err)
	}
	log.Printf("API原始响应: %s", string(body))

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
		log.Printf("解析响应失败: %v", err)
		return "", fmt.Errorf("解析响应失败: %w", err)
	}

	// 检查API返回码
	if result.Code != 200 {
		log.Printf("API返回错误: %s (code: %d)", result.Msg, result.Code)
		return "", fmt.Errorf("API返回错误: %s (code: %d)", result.Msg, result.Code)
	}

	if len(result.Data) == 0 {
		log.Printf("未找到歌曲数据")
		return "", fmt.Errorf("未找到歌曲数据")
	}

	if result.Data[0].URL == "" {
		log.Printf("歌曲URL为空，可能是版权限制")
		return "", fmt.Errorf("歌曲URL为空，可能是版权限制")
	}

	log.Printf("成功获取歌曲URL: %s", result.Data[0].URL)
	return result.Data[0].URL, nil
}

// GetSongDetail 获取歌曲详情
func (c *Client) GetSongDetail(songID string) (*model.NeteaseSong, error) {
	url := fmt.Sprintf("%s/song/detail?ids=%s", c.BaseURL, songID)
	req, err := c.createRequest("GET", url)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Songs []model.NeteaseSong `json:"songs"`
		Code  int                 `json:"code"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	if len(result.Songs) > 0 {
		return &result.Songs[0], nil
	}

	return nil, fmt.Errorf("未找到歌曲")
}

// SearchSongs 搜索歌曲
func (c *Client) SearchSongs(keyword string, limit, offset int, mp3Processor *audio.MP3Processor, staticDir string) (*model.NeteaseSearchResult, error) {
	params := url.Values{}
	params.Set("keywords", keyword)
	params.Set("limit", fmt.Sprintf("%d", limit))
	params.Set("offset", fmt.Sprintf("%d", offset))

	url := fmt.Sprintf("%s/search?%s", c.BaseURL, params.Encode())
	log.Printf("发送搜索请求到: %s", url)

	req, err := c.createRequest("GET", url)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	// 读取原始响应数据
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}
	log.Printf("API原始响应: %s", string(body))

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
					ID    int64  `json:"id"`
					Name  string `json:"name"`
					PicID int64  `json:"picId"`
				} `json:"album"`
				Duration int `json:"duration"`
			} `json:"songs"`
			Total int `json:"songCount"`
		} `json:"result"`
		Code int `json:"code"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	log.Printf("API返回码: %d, 找到歌曲数: %d", result.Code, len(result.Result.Songs))

	// 转换结果
	searchResult := &model.NeteaseSearchResult{
		Total: result.Result.Total,
		Songs: make([]model.NeteaseSong, len(result.Result.Songs)),
	}

	for i, song := range result.Result.Songs {
		// 使用第一个艺术家的图片作为封面
		picURL := ""
		if len(song.Artists) > 0 && song.Artists[0].Img1v1Url != "" {
			picURL = song.Artists[0].Img1v1Url
		}
		log.Printf("处理歌曲 %d: %s, 专辑封面URL: %s", i+1, song.Name, picURL)

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
					log.Printf("MinIO客户端为空，无法上传到MinIO")
					return
				}

				// 检查是否已经处理过
				_, err := minioClient.StatObject(context.Background(), cfg.MinioBucket, fmt.Sprintf("hls/%d/index.m3u8", song.ID), minio.StatObjectOptions{})
				if err == nil {
					log.Printf("歌曲 %s 已经预处理过，跳过", song.Name)
					return
				}

				// 获取歌曲URL
				songURL, err := c.GetSongURL(fmt.Sprintf("%d", song.ID))
				if err != nil {
					log.Printf("获取歌曲URL失败: %v", err)
					return
				}

				// 下载音频文件
				tempDir := filepath.Join(staticDir, "temp", fmt.Sprintf("%d", song.ID))
				os.MkdirAll(tempDir, 0755)
				defer os.RemoveAll(tempDir)

				mp3Path := filepath.Join(tempDir, "original.mp3")
				if err := utils.DownloadFile(songURL, mp3Path); err != nil {
					log.Printf("下载音频文件失败: %v", err)
					return
				}

				// 优化音频文件
				optimizedPath := filepath.Join(tempDir, "optimized.mp3")
				if err := mp3Processor.OptimizeMP3(mp3Path, optimizedPath); err != nil {
					log.Printf("优化音频文件失败: %v", err)
					return
				}

				// 转换为HLS格式
				hlsDir := filepath.Join(tempDir, "streams/netease")
				outputM3U8 := filepath.Join(hlsDir, "playlist.m3u8")
				segmentPattern := filepath.Join(hlsDir, "segment_%03d.ts")
				hlsBaseURL := fmt.Sprintf("/streams/netease/%d/", song.ID)

				_, err = mp3Processor.ProcessToHLS(optimizedPath, outputM3U8, segmentPattern, hlsBaseURL, "192k", "4")
				if err != nil {
					log.Printf("转换为HLS格式失败: %v", err)
					return
				}

				// 上传到MinIO
				// 上传m3u8文件
				m3u8Path := fmt.Sprintf("streams/netease/%d/playlist.m3u8", song.ID)
				m3u8Content, err := os.ReadFile(outputM3U8)
				if err != nil {
					log.Printf("读取m3u8文件失败: %v", err)
					return
				}

				_, err = minioClient.PutObject(context.Background(), cfg.MinioBucket, m3u8Path, bytes.NewReader(m3u8Content), int64(len(m3u8Content)), minio.PutObjectOptions{
					ContentType: "application/vnd.apple.mpegurl",
				})
				if err != nil {
					log.Printf("上传m3u8文件失败: %v", err)
					return
				}

				log.Printf("上传m3u8文件成功")

				// 上传ts文件
				tsFiles, err := filepath.Glob(filepath.Join(hlsDir, "*.ts"))
				if err != nil {
					log.Printf("查找ts文件失败: %v", err)
					return
				}

				for _, tsFile := range tsFiles {
					segmentName := filepath.Base(tsFile)
					segmentPath := fmt.Sprintf("streams/netease/%d/%s", song.ID, segmentName)
					segmentContent, err := os.ReadFile(tsFile)
					if err != nil {
						log.Printf("读取ts文件失败: %v", err)
						continue
					}

					_, err = minioClient.PutObject(context.Background(), cfg.MinioBucket, segmentPath, bytes.NewReader(segmentContent), int64(len(segmentContent)), minio.PutObjectOptions{
						ContentType: "video/MP2T",
					})
					if err != nil {
						log.Printf("上传ts文件失败: %v", err)
						continue
					}
				}
				log.Printf("上传ts文件成功***************************")

				log.Printf("✅ 歌曲 %s 预处理完成", song.Name)
			}()
		}
	}

	log.Printf("搜索处理完成，返回 %d 首歌曲", len(searchResult.Songs))
	return searchResult, nil
}

// GetDynamicCover 获取歌曲动态封面
func (c *Client) GetDynamicCover(songID string) (string, error) {
	url := fmt.Sprintf("%s/song/dynamic/cover?id=%s", c.BaseURL, songID)
	log.Printf("准备获取动态封面: %s", url)

	req, err := c.createRequest("GET", url)
	if err != nil {
		log.Printf("创建请求失败: %v", err)
		return "", fmt.Errorf("创建请求失败: %w", err)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		log.Printf("请求失败: %v", err)
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
		log.Printf("解析响应失败: %v", err)
		return "", fmt.Errorf("解析响应失败: %w", err)
	}

	if result.Code != 200 {
		log.Printf("API返回错误: %s (code: %d)", result.Message, result.Code)
		return "", fmt.Errorf("API返回错误: %s (code: %d)", result.Message, result.Code)
	}

	if result.Data.VideoPlayURL == "" {
		log.Printf("未找到动态封面")
		return "", nil
	}

	log.Printf("成功获取动态封面URL: %s", result.Data.VideoPlayURL)
	return result.Data.VideoPlayURL, nil
}
