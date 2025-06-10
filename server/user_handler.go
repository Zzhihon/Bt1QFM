package server

import (
	"encoding/json"
	"net/http"

	"Bt1QFM/logger"
	"Bt1QFM/repository"
)

// UserHandler 用户处理器
type UserHandler struct {
	userRepo repository.UserRepository
}

// NewUserHandler 创建用户处理器
func NewUserHandler(userRepo repository.UserRepository) *UserHandler {
	return &UserHandler{
		userRepo: userRepo,
	}
}

// GetUserProfileHandler 获取用户资料
func (h *UserHandler) GetUserProfileHandler(w http.ResponseWriter, r *http.Request) {
	// 从上下文中获取用户ID
	userID, ok := r.Context().Value("userID").(int64)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// 从数据库获取用户信息
	user, err := h.userRepo.GetUserByID(userID)
	if err != nil {
		logger.Error("获取用户信息失败", logger.ErrorField(err))
		http.Error(w, "Failed to get user profile", http.StatusInternalServerError)
		return
	}

	if user == nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	// 构建响应数据
	profile := map[string]interface{}{
		"id":       user.ID,
		"username": user.Username,
		"email":    user.Email,
	}

	// 添加网易云信息
	if user.NeteaseUsername.Valid {
		profile["neteaseUsername"] = user.NeteaseUsername.String
	}
	if user.NeteaseUID.Valid {
		profile["neteaseUID"] = user.NeteaseUID.String
	}

	// 添加其他字段
	if user.Phone.Valid {
		profile["phone"] = user.Phone.String
	}
	if user.Preferences.Valid {
		profile["preferences"] = user.Preferences.String
	}

	profile["createdAt"] = user.CreatedAt
	profile["updatedAt"] = user.UpdatedAt

	// 设置响应头
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// 返回用户资料
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    profile,
	}); err != nil {
		logger.Error("编码用户资料响应失败", logger.ErrorField(err))
	}
}

// UpdateNeteaseInfoHandler 更新网易云信息
func (h *UserHandler) UpdateNeteaseInfoHandler(w http.ResponseWriter, r *http.Request) {
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

	// 从上下文中获取用户ID
	userID, ok := r.Context().Value("userID").(int64)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// 更新用户网易云信息
	if err := h.userRepo.UpdateNeteaseInfo(userID, req.NeteaseUsername, req.NeteaseUID); err != nil {
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
