package plugin

import (
	"fmt"
	"os"

	"Bt1QFM/core/netease"
	"Bt1QFM/logger"
)

// NeteasePlugin 网易云音乐插件实现
type NeteasePlugin struct {
	client *netease.Client
}

// NewNeteasePlugin 创建网易云音乐插件
func NewNeteasePlugin() *NeteasePlugin {
	client := netease.NewClient()

	// 从环境变量获取 API URL
	baseURL := os.Getenv("NETEASE_API_URL")
	if baseURL != "" {
		client.SetBaseURL(baseURL)
	}

	return &NeteasePlugin{
		client: client,
	}
}

// GetSource 返回插件来源标识
func (p *NeteasePlugin) GetSource() string {
	return "netease"
}

// Search 搜索歌曲
func (p *NeteasePlugin) Search(query string, limit int) ([]PluginSong, error) {
	if limit <= 0 {
		limit = 5
	}

	logger.Info("[NeteasePlugin] 搜索歌曲",
		logger.String("query", query),
		logger.Int("limit", limit))

	// 调用网易云客户端搜索
	result, err := p.client.SearchSongs(query, limit, 0, nil, "")
	if err != nil {
		logger.Error("[NeteasePlugin] 搜索失败", logger.ErrorField(err))
		return nil, fmt.Errorf("搜索失败: %w", err)
	}

	// 转换为插件统一格式
	songs := make([]PluginSong, 0, len(result.Songs))
	for _, song := range result.Songs {
		// 提取艺术家名称
		artists := make([]string, len(song.Artists))
		for i, artist := range song.Artists {
			artists[i] = artist.Name
		}

		// 构建 HLS URL
		hlsURL := fmt.Sprintf("/streams/netease/%d/playlist.m3u8", song.ID)

		songs = append(songs, PluginSong{
			ID:       fmt.Sprintf("%d", song.ID),
			Name:     song.Name,
			Artists:  artists,
			Album:    song.Album.Name,
			Duration: song.Duration,
			CoverURL: song.Album.PicURL,
			HLSURL:   hlsURL,
			Source:   "netease",
		})
	}

	logger.Info("[NeteasePlugin] 搜索完成",
		logger.String("query", query),
		logger.Int("count", len(songs)))

	return songs, nil
}

// GetDetail 获取歌曲详情
func (p *NeteasePlugin) GetDetail(songID string) (*PluginSong, error) {
	logger.Info("[NeteasePlugin] 获取歌曲详情", logger.String("songID", songID))

	detail, err := p.client.GetSongDetail(songID)
	if err != nil {
		logger.Error("[NeteasePlugin] 获取详情失败", logger.ErrorField(err))
		return nil, fmt.Errorf("获取详情失败: %w", err)
	}

	// 提取艺术家名称
	artists := make([]string, len(detail.Artists))
	for i, artist := range detail.Artists {
		artists[i] = artist.Name
	}

	// 构建 HLS URL
	hlsURL := fmt.Sprintf("/streams/netease/%d/playlist.m3u8", detail.ID)

	return &PluginSong{
		ID:       fmt.Sprintf("%d", detail.ID),
		Name:     detail.Name,
		Artists:  artists,
		Album:    detail.Album.Name,
		Duration: detail.Duration,
		CoverURL: detail.Album.PicURL,
		HLSURL:   hlsURL,
		Source:   "netease",
	}, nil
}

// GetPlayURL 获取播放地址
func (p *NeteasePlugin) GetPlayURL(songID string) (string, error) {
	logger.Info("[NeteasePlugin] 获取播放地址", logger.String("songID", songID))

	// 先尝试触发 HLS 流生成
	_, err := p.client.GetSongURL(songID)
	if err != nil {
		logger.Warn("[NeteasePlugin] 获取原始URL失败", logger.ErrorField(err))
		// 即使失败也返回 HLS 地址，让前端自己重试
	}

	// 返回 HLS 地址
	return fmt.Sprintf("/streams/netease/%s/playlist.m3u8", songID), nil
}
