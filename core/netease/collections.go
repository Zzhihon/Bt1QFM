package netease

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"Bt1QFM/config"
	"Bt1QFM/logger"
	"Bt1QFM/repository"
)

// HandleUserPlaylists 处理获取用户歌单列表请求
func (h *NeteaseHandler) HandleUserPlaylists(w http.ResponseWriter, r *http.Request) {
	uid := r.URL.Query().Get("uid")
	if uid == "" {
		http.Error(w, "uid parameter is required", http.StatusBadRequest)
		return
	}

	// 从配置获取网易云API URL
	cfg := config.Load()
	apiURL := fmt.Sprintf("%s/user/playlist?uid=%s", cfg.NeteaseAPIURL, url.QueryEscape(uid))

	// 发送请求到网易云API
	resp, err := http.Get(apiURL)
	if err != nil {
		logger.Error("获取用户歌单失败", logger.ErrorField(err))
		http.Error(w, "Failed to fetch user playlists", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// 解析响应
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		logger.Error("解析用户歌单响应失败", logger.ErrorField(err))
		http.Error(w, "Failed to parse response", http.StatusInternalServerError)
		return
	}

	// 设置响应头
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// 返回结果
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    result,
	}); err != nil {
		logger.Error("编码用户歌单响应失败", logger.ErrorField(err))
	}
}

// HandleGetUserIDs 处理通过用户名获取UID请求
func (h *NeteaseHandler) HandleGetUserIDs(w http.ResponseWriter, r *http.Request) {
	nicknames := r.URL.Query().Get("nicknames")
	if nicknames == "" {
		http.Error(w, "nicknames parameter is required", http.StatusBadRequest)
		return
	}

	// 从配置获取网易云API URL
	cfg := config.Load()
	apiURL := fmt.Sprintf("%s/get/userids?nicknames=%s", cfg.NeteaseAPIURL, url.QueryEscape(nicknames))

	// 发送请求到网易云API
	resp, err := http.Get(apiURL)
	if err != nil {
		logger.Error("获取用户ID失败", logger.ErrorField(err))
		http.Error(w, "Failed to fetch user IDs", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// 解析响应
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		logger.Error("解析用户ID响应失败", logger.ErrorField(err))
		http.Error(w, "Failed to parse response", http.StatusInternalServerError)
		return
	}

	// 设置响应头
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// 返回结果
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    result,
	}); err != nil {
		logger.Error("编码用户ID响应失败", logger.ErrorField(err))
	}
}

// HandlePlaylistDetail 处理获取歌单详情请求
func (h *NeteaseHandler) HandlePlaylistDetail(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "id parameter is required", http.StatusBadRequest)
		return
	}

	// 从配置获取网易云API URL
	cfg := config.Load()
	apiURL := fmt.Sprintf("%s/playlist/detail?id=%s", cfg.NeteaseAPIURL, url.QueryEscape(id))

	// 发送请求到网易云API
	resp, err := http.Get(apiURL)
	if err != nil {
		logger.Error("获取歌单详情失败", logger.ErrorField(err))
		http.Error(w, "Failed to fetch playlist details", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// 解析响应
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		logger.Error("解析歌单详情响应失败", logger.ErrorField(err))
		http.Error(w, "Failed to parse response", http.StatusInternalServerError)
		return
	}

	// 设置响应头
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// 返回结果
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    result,
	}); err != nil {
		logger.Error("编码歌单详情响应失败", logger.ErrorField(err))
	}
}

// HandleUpdateNeteaseInfo 处理更新用户网易云信息请求
func (h *NeteaseHandler) HandleUpdateNeteaseInfo(userRepo repository.UserRepository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 解析请求体
		var req struct {
			NeteaseUsername string `json:"neteaseUsername"`
			NeteaseUID      string `json:"neteaseUID"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		// 从上下文中获取用户ID（需要配合认证中间件）
		userID, ok := r.Context().Value("userID").(int64)
		if !ok {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// 更新用户网易云信息
		if err := userRepo.UpdateNeteaseInfo(userID, req.NeteaseUsername, req.NeteaseUID); err != nil {
			logger.Error("更新用户网易云信息失败", logger.ErrorField(err))
			http.Error(w, "Failed to update netease info", http.StatusInternalServerError)
			return
		}

		// 设置响应头
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		// 返回成功响应
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "Netease info updated successfully",
		}); err != nil {
			logger.Error("编码更新网易云信息响应失败", logger.ErrorField(err))
		}
	}
}
