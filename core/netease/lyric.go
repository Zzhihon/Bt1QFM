package netease

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"Bt1QFM/logger"
)

// LyricUser 歌词贡献者信息
type LyricUser struct {
	ID       int    `json:"id"`
	Status   int    `json:"status"`
	Demand   int    `json:"demand"`
	UserID   int    `json:"userid"`
	Nickname string `json:"nickname"`
	Uptime   int64  `json:"uptime"`
}

// LyricData 歌词数据
type LyricData struct {
	Version int    `json:"version"`
	Lyric   string `json:"lyric"`
}

// LyricResponse 歌词API响应
type LyricResponse struct {
	SGC       bool       `json:"sgc"`
	SFY       bool       `json:"sfy"`
	QFY       bool       `json:"qfy"`
	Code      int        `json:"code"`
	TransUser *LyricUser `json:"transUser,omitempty"`
	LyricUser *LyricUser `json:"lyricUser,omitempty"`
	LRC       LyricData  `json:"lrc"`
	TLyric    *LyricData `json:"tlyric,omitempty"`
	RomaLRC   *LyricData `json:"romalrc,omitempty"`
	YRC       *LyricData `json:"yrc,omitempty"`      // 逐字歌词
	YTLyric   *LyricData `json:"ytlrc,omitempty"`    // 逐字翻译歌词
	YRomaLRC  *LyricData `json:"yromalrc,omitempty"` // 逐字罗马音歌词
	KLyric    *LyricData `json:"klyric,omitempty"`   // 卡拉OK歌词
}

// HandleLyricNew 处理歌词获取请求
func (h *NeteaseHandler) HandleLyricNew(w http.ResponseWriter, r *http.Request) {
	// 设置响应头
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// 获取歌曲ID参数
	songIDStr := r.URL.Query().Get("id")
	if songIDStr == "" {
		logger.Warn("歌词请求缺少歌曲ID参数")
		http.Error(w, `{"error": "Missing song ID parameter"}`, http.StatusBadRequest)
		return
	}

	// 验证歌曲ID格式
	songID, err := strconv.ParseInt(songIDStr, 10, 64)
	if err != nil {
		logger.Warn("无效的歌曲ID格式",
			logger.String("songId", songIDStr),
			logger.ErrorField(err))
		http.Error(w, `{"error": "Invalid song ID format"}`, http.StatusBadRequest)
		return
	}

	logger.Info("开始获取歌词",
		logger.String("songId", songIDStr),
		logger.Int64("parsedSongId", songID))

	// 获取歌词数据
	lyricData, err := h.client.GetLyric(songIDStr)
	if err != nil {
		logger.Error("获取歌词失败",
			logger.String("songId", songIDStr),
			logger.ErrorField(err))

		// 返回错误响应，但保持与网易云API一致的格式
		errorResponse := LyricResponse{
			Code: 500,
			SGC:  false,
			SFY:  false,
			QFY:  false,
			LRC: LyricData{
				Version: 0,
				Lyric:   "",
			},
		}

		responseData, _ := json.Marshal(errorResponse)
		w.WriteHeader(http.StatusInternalServerError)
		w.Write(responseData)
		return
	}

	logger.Info("成功获取歌词",
		logger.String("songId", songIDStr),
		logger.Bool("hasLrc", lyricData.LRC.Lyric != ""),
		logger.Bool("hasYrc", lyricData.YRC != nil && lyricData.YRC.Lyric != ""),
		logger.Bool("hasTranslation", lyricData.TLyric != nil && lyricData.TLyric.Lyric != ""))

	// 返回歌词数据
	responseData, err := json.Marshal(lyricData)
	if err != nil {
		logger.Error("序列化歌词数据失败",
			logger.String("songId", songIDStr),
			logger.ErrorField(err))
		http.Error(w, `{"error": "Failed to serialize lyric data"}`, http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write(responseData)
}

// GetLyric 从网易云API获取歌词
func (c *Client) GetLyric(songID string) (*LyricResponse, error) {
	// 构建请求URL
	url := fmt.Sprintf("%s/lyric/new?id=%s", c.BaseURL, songID)

	logger.Debug("请求网易云歌词API",
		logger.String("url", url),
		logger.String("songId", songID))

	// 发送HTTP请求
	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("请求歌词API失败: %w", err)
	}
	defer resp.Body.Close()

	// 检查响应状态码
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("歌词API返回错误状态码: %d", resp.StatusCode)
	}

	// 解析响应数据
	var lyricResponse LyricResponse
	if err := json.NewDecoder(resp.Body).Decode(&lyricResponse); err != nil {
		return nil, fmt.Errorf("解析歌词响应失败: %w", err)
	}

	// 检查API响应状态
	if lyricResponse.Code != 200 {
		return nil, fmt.Errorf("歌词API返回错误: code=%d", lyricResponse.Code)
	}

	logger.Debug("成功解析歌词响应",
		logger.String("songId", songID),
		logger.Int("code", lyricResponse.Code),
		logger.Bool("hasLrc", lyricResponse.LRC.Lyric != ""),
		logger.Bool("hasYrc", lyricResponse.YRC != nil),
		logger.Bool("hasTrans", lyricResponse.TLyric != nil))

	return &lyricResponse, nil
}
