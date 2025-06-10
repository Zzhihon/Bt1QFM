package server

import (
	"net/http"
	"fmt"
	"encoding/json"
	
	"github.com/gorilla/mux"
	"Bt1QFM/model"
	"Bt1QFM/repository"
	"Bt1QFM/logger"
)

type AnnouncementHandler struct {
	announcementRepo *repository.AnnouncementRepository
	userRepo         repository.UserRepository
}

func NewAnnouncementHandler(announcementRepo *repository.AnnouncementRepository, userRepo repository.UserRepository) *AnnouncementHandler {
	return &AnnouncementHandler{
		announcementRepo: announcementRepo,
		userRepo:         userRepo,
	}
}

// GetAnnouncements 获取公告列表
func (h *AnnouncementHandler) GetAnnouncements(w http.ResponseWriter, r *http.Request) {
	logger.Info("收到获取公告列表请求", 
		logger.String("method", r.Method),
		logger.String("url", r.URL.String()),
		logger.String("remoteAddr", r.RemoteAddr))

	userID := r.Context().Value("userID")
	if userID == nil {
		logger.Warn("获取公告列表失败：未授权访问")
		http.Error(w, `{"success": false, "message": "未授权访问"}`, http.StatusUnauthorized)
		return
	}

	// 处理多种可能的用户ID类型
	var uid uint
	switch v := userID.(type) {
	case uint:
		uid = v
	case int:
		uid = uint(v)
	case int64:
		uid = uint(v)
	case float64:
		uid = uint(v)
	default:
		logger.Error("获取公告列表失败：用户ID格式错误", 
			logger.Any("userID", userID),
			logger.String("userIDType", fmt.Sprintf("%T", userID)))
		http.Error(w, `{"success": false, "message": "用户ID格式错误"}`, http.StatusBadRequest)
		return
	}

	logger.Info("开始获取用户公告列表", logger.Any("userId", uid))

	announcements, err := h.announcementRepo.GetAnnouncementsWithReadStatus(uid)
	if err != nil {
		logger.Error("获取公告列表失败：数据库查询错误", 
			logger.Any("userId", uid),
			logger.ErrorField(err))
		http.Error(w, `{"success": false, "message": "获取公告失败"}`, http.StatusInternalServerError)
		return
	}

	logger.Info("成功获取公告列表", 
		logger.Any("userId", uid),
		logger.Int("count", len(announcements)))

	response := map[string]interface{}{
		"success": true,
		"data":    announcements,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetUnreadAnnouncements 获取未读公告
func (h *AnnouncementHandler) GetUnreadAnnouncements(w http.ResponseWriter, r *http.Request) {
	logger.Info("收到获取未读公告请求", 
		logger.String("method", r.Method),
		logger.String("url", r.URL.String()),
		logger.String("remoteAddr", r.RemoteAddr))

	userID := r.Context().Value("userID")
	if userID == nil {
		logger.Warn("获取未读公告失败：未授权访问")
		http.Error(w, `{"success": false, "message": "未授权访问"}`, http.StatusUnauthorized)
		return
	}

	// 处理多种可能的用户ID类型
	var uid uint
	switch v := userID.(type) {
	case uint:
		uid = v
	case int:
		uid = uint(v)
	case int64:
		uid = uint(v)
	case float64:
		uid = uint(v)
	default:
		logger.Error("获取未读公告失败：用户ID格式错误", 
			logger.Any("userID", userID),
			logger.String("userIDType", fmt.Sprintf("%T", userID)))
		http.Error(w, `{"success": false, "message": "用户ID格式错误"}`, http.StatusBadRequest)
		return
	}

	logger.Info("开始获取用户未读公告", logger.Any("userId", uid))

	announcements, err := h.announcementRepo.GetUnreadAnnouncements(uid)
	if err != nil {
		logger.Error("获取未读公告失败：数据库查询错误", 
			logger.Any("userId", uid),
			logger.ErrorField(err))
		http.Error(w, `{"success": false, "message": "获取未读公告失败"}`, http.StatusInternalServerError)
		return
	}

	logger.Info("成功获取未读公告列表", 
		logger.Any("userId", uid),
		logger.Int("unreadCount", len(announcements)))

	response := map[string]interface{}{
		"success": true,
		"data":    announcements,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// MarkAsRead 标记公告为已读
func (h *AnnouncementHandler) MarkAsRead(w http.ResponseWriter, r *http.Request) {
	logger.Info("收到标记公告已读请求", 
		logger.String("method", r.Method),
		logger.String("url", r.URL.String()),
		logger.String("remoteAddr", r.RemoteAddr))

	userID := r.Context().Value("userID")
	if userID == nil {
		logger.Warn("标记公告已读失败：未授权访问")
		http.Error(w, `{"success": false, "message": "未授权访问"}`, http.StatusUnauthorized)
		return
	}

	// 处理多种可能的用户ID类型
	var uid uint
	switch v := userID.(type) {
	case uint:
		uid = v
	case int:
		uid = uint(v)
	case int64:
		uid = uint(v)
	case float64:
		uid = uint(v)
	default:
		logger.Error("标记公告已读失败：用户ID格式错误", 
			logger.Any("userID", userID),
			logger.String("userIDType", fmt.Sprintf("%T", userID)))
		http.Error(w, `{"success": false, "message": "用户ID格式错误"}`, http.StatusBadRequest)
		return
	}

	vars := mux.Vars(r)
	announcementID := vars["id"]
	if announcementID == "" {
		logger.Error("标记公告已读失败：公告ID为空", 
			logger.Any("userId", uid))
		http.Error(w, `{"success": false, "message": "公告ID不能为空"}`, http.StatusBadRequest)
		return
	}

	logger.Info("开始标记公告为已读", 
		logger.Any("userId", uid),
		logger.String("announcementId", announcementID))

	// 检查公告是否存在
	_, err := h.announcementRepo.GetAnnouncementByID(announcementID)
	if err != nil {
		logger.Error("标记公告已读失败：公告不存在", 
			logger.Any("userId", uid),
			logger.String("announcementId", announcementID),
			logger.ErrorField(err))
		http.Error(w, `{"success": false, "message": "公告不存在"}`, http.StatusNotFound)
		return
	}

	// 标记为已读
	err = h.announcementRepo.MarkAsRead(uid, announcementID)
	if err != nil {
		logger.Error("标记公告已读失败：数据库操作错误", 
			logger.Any("userId", uid),
			logger.String("announcementId", announcementID),
			logger.ErrorField(err))
		http.Error(w, `{"success": false, "message": "标记已读失败"}`, http.StatusInternalServerError)
		return
	}

	logger.Info("成功标记公告为已读", 
		logger.Any("userId", uid),
		logger.String("announcementId", announcementID))

	response := map[string]interface{}{
		"success": true,
		"message": "标记已读成功",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// CreateAnnouncement 创建公告（管理员）
func (h *AnnouncementHandler) CreateAnnouncement(w http.ResponseWriter, r *http.Request) {
	logger.Info("收到创建公告请求", 
		logger.String("method", r.Method),
		logger.String("url", r.URL.String()),
		logger.String("remoteAddr", r.RemoteAddr),
		logger.String("contentType", r.Header.Get("Content-Type")),
		logger.Int64("contentLength", r.ContentLength))

	userID := r.Context().Value("userID")
	if userID == nil {
		logger.Warn("创建公告失败：未授权访问")
		http.Error(w, `{"success": false, "message": "未授权访问"}`, http.StatusUnauthorized)
		return
	}

	// 处理多种可能的用户ID类型
	var uid uint
	switch v := userID.(type) {
	case uint:
		uid = v
	case int:
		uid = uint(v)
	case int64:
		uid = uint(v)
	case float64:
		uid = uint(v)
	default:
		logger.Error("创建公告失败：用户ID格式错误", 
			logger.Any("userID", userID),
			logger.String("userIDType", fmt.Sprintf("%T", userID)))
		http.Error(w, `{"success": false, "message": "用户ID格式错误"}`, http.StatusBadRequest)
		return
	}

	logger.Info("开始验证管理员权限", logger.Any("userId", uid))

	// 检查用户是否为管理员
	user, err := h.userRepo.GetUserByID(int64(uid))
	if err != nil {
		logger.Error("创建公告失败：获取用户信息失败", 
			logger.Any("userId", uid),
			logger.ErrorField(err))
		http.Error(w, `{"success": false, "message": "获取用户信息失败"}`, http.StatusInternalServerError)
		return
	}
	
	// 简单的管理员检查
	if uid != 1 {
		logger.Warn("创建公告失败：用户没有管理员权限", 
			logger.Any("userId", uid),
			logger.String("username", user.Username))
		http.Error(w, `{"success": false, "message": "需要管理员权限"}`, http.StatusForbidden)
		return
	}

	logger.Info("管理员权限验证成功", logger.Any("userId", uid))

	var req model.CreateAnnouncementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		logger.Error("创建公告失败：JSON解析错误", 
			logger.Any("userId", uid),
			logger.ErrorField(err))
		http.Error(w, `{"success": false, "message": "请求参数错误"}`, http.StatusBadRequest)
		return
	}

	logger.Info("收到创建公告请求数据", 
		logger.Any("userId", uid),
		logger.String("title", req.Title),
		logger.String("version", req.Version),
		logger.String("type", req.Type),
		logger.Int("contentLength", len(req.Content)))

	// 基本验证
	if req.Title == "" || req.Content == "" || req.Version == "" || req.Type == "" {
		logger.Error("创建公告失败：必填字段为空", 
			logger.Any("userId", uid),
			logger.Bool("titleEmpty", req.Title == ""),
			logger.Bool("contentEmpty", req.Content == ""),
			logger.Bool("versionEmpty", req.Version == ""),
			logger.Bool("typeEmpty", req.Type == ""))
		http.Error(w, `{"success": false, "message": "必填字段不能为空"}`, http.StatusBadRequest)
		return
	}

	// 验证类型
	validTypes := map[string]bool{"info": true, "warning": true, "success": true, "error": true}
	if !validTypes[req.Type] {
		logger.Error("创建公告失败：公告类型无效", 
			logger.Any("userId", uid),
			logger.String("invalidType", req.Type))
		http.Error(w, `{"success": false, "message": "公告类型无效"}`, http.StatusBadRequest)
		return
	}

	logger.Info("公告数据验证通过，开始创建公告", 
		logger.Any("userId", uid),
		logger.String("title", req.Title),
		logger.String("version", req.Version),
		logger.String("type", req.Type))

	// 创建公告
	announcement := model.NewAnnouncement(req, uid)

	logger.Info("生成公告对象", 
		logger.String("announcementId", announcement.ID),
		logger.Any("userId", uid))

	err = h.announcementRepo.CreateAnnouncement(announcement)
	if err != nil {
		logger.Error("创建公告失败：数据库插入错误", 
			logger.Any("userId", uid),
			logger.String("announcementId", announcement.ID),
			logger.ErrorField(err))
		http.Error(w, `{"success": false, "message": "创建公告失败"}`, http.StatusInternalServerError)
		return
	}

	logger.Info("成功创建公告", 
		logger.Any("userId", uid),
		logger.String("announcementId", announcement.ID),
		logger.String("title", announcement.Title),
		logger.String("version", announcement.Version))

	response := map[string]interface{}{
		"success": true,
		"data":    announcement.ToResponse(false),
		"message": "创建公告成功",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// DeleteAnnouncement 删除公告（管理员）
func (h *AnnouncementHandler) DeleteAnnouncement(w http.ResponseWriter, r *http.Request) {
	logger.Info("收到删除公告请求", 
		logger.String("method", r.Method),
		logger.String("url", r.URL.String()),
		logger.String("remoteAddr", r.RemoteAddr))

	userID := r.Context().Value("userID")
	if userID == nil {
		logger.Warn("删除公告失败：未授权访问")
		http.Error(w, `{"success": false, "message": "未授权访问"}`, http.StatusUnauthorized)
		return
	}

	// 处理多种可能的用户ID类型
	var uid uint
	switch v := userID.(type) {
	case uint:
		uid = v
	case int:
		uid = uint(v)
	case int64:
		uid = uint(v)
	case float64:
		uid = uint(v)
	default:
		logger.Error("删除公告失败：用户ID格式错误", 
			logger.Any("userID", userID),
			logger.String("userIDType", fmt.Sprintf("%T", userID)))
		http.Error(w, `{"success": false, "message": "用户ID格式错误"}`, http.StatusBadRequest)
		return
	}

	// 检查用户是否为管理员
	_, err := h.userRepo.GetUserByID(int64(uid))
	if err != nil {
		logger.Error("删除公告失败：获取用户信息失败", 
			logger.Any("userId", uid),
			logger.ErrorField(err))
		http.Error(w, `{"success": false, "message": "获取用户信息失败"}`, http.StatusInternalServerError)
		return
	}
	
	// 简单的管理员检查
	if uid != 1 {
		logger.Warn("删除公告失败：用户没有管理员权限", 
			logger.Any("userId", uid))
		http.Error(w, `{"success": false, "message": "需要管理员权限"}`, http.StatusForbidden)
		return
	}

	vars := mux.Vars(r)
	announcementID := vars["id"]
	if announcementID == "" {
		logger.Error("删除公告失败：公告ID为空", 
			logger.Any("userId", uid))
		http.Error(w, `{"success": false, "message": "公告ID不能为空"}`, http.StatusBadRequest)
		return
	}

	logger.Info("开始删除公告", 
		logger.Any("userId", uid),
		logger.String("announcementId", announcementID))

	// 检查公告是否存在
	announcement, err := h.announcementRepo.GetAnnouncementByID(announcementID)
	if err != nil {
		logger.Error("删除公告失败：公告不存在", 
			logger.Any("userId", uid),
			logger.String("announcementId", announcementID),
			logger.ErrorField(err))
		http.Error(w, `{"success": false, "message": "公告不存在"}`, http.StatusNotFound)
		return
	}

	logger.Info("找到要删除的公告", 
		logger.Any("userId", uid),
		logger.String("announcementId", announcementID),
		logger.String("title", announcement.Title))

	// 软删除公告
	err = h.announcementRepo.DeleteAnnouncement(announcementID)
	if err != nil {
		logger.Error("删除公告失败：数据库操作错误", 
			logger.Any("userId", uid),
			logger.String("announcementId", announcementID),
			logger.ErrorField(err))
		http.Error(w, `{"success": false, "message": "删除公告失败"}`, http.StatusInternalServerError)
		return
	}

	logger.Info("成功删除公告", 
		logger.Any("userId", uid),
		logger.String("announcementId", announcementID),
		logger.String("title", announcement.Title))

	response := map[string]interface{}{
		"success": true,
		"message": "删除公告成功",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetAnnouncementStats 获取公告统计信息（管理员）
func (h *AnnouncementHandler) GetAnnouncementStats(w http.ResponseWriter, r *http.Request) {
	logger.Info("收到获取公告统计请求", 
		logger.String("method", r.Method),
		logger.String("url", r.URL.String()),
		logger.String("remoteAddr", r.RemoteAddr))

	userID := r.Context().Value("userID")
	if userID == nil {
		logger.Warn("获取公告统计失败：未授权访问")
		http.Error(w, `{"success": false, "message": "未授权访问"}`, http.StatusUnauthorized)
		return
	}

	// 处理多种可能的用户ID类型
	var uid uint
	switch v := userID.(type) {
	case uint:
		uid = v
	case int:
		uid = uint(v)
	case int64:
		uid = uint(v)
	case float64:
		uid = uint(v)
	default:
		logger.Error("获取公告统计失败：用户ID格式错误", 
			logger.Any("userID", userID),
			logger.String("userIDType", fmt.Sprintf("%T", userID)))
		http.Error(w, `{"success": false, "message": "用户ID格式错误"}`, http.StatusBadRequest)
		return
	}

	// 检查用户是否为管理员
	_, err := h.userRepo.GetUserByID(int64(uid))
	if err != nil {
		logger.Error("获取公告统计失败：获取用户信息失败", 
			logger.Any("userId", uid),
			logger.ErrorField(err))
		http.Error(w, `{"success": false, "message": "获取用户信息失败"}`, http.StatusInternalServerError)
		return
	}
	
	// 简单的管理员检查
	if uid != 1 {
		logger.Warn("获取公告统计失败：用户没有管理员权限", 
			logger.Any("userId", uid))
		http.Error(w, `{"success": false, "message": "需要管理员权限"}`, http.StatusForbidden)
		return
	}

	logger.Info("开始获取公告统计信息", logger.Any("userId", uid))

	stats, err := h.announcementRepo.GetAnnouncementStats()
	if err != nil {
		logger.Error("获取公告统计失败：数据库查询错误", 
			logger.Any("userId", uid),
			logger.ErrorField(err))
		http.Error(w, `{"success": false, "message": "获取统计信息失败"}`, http.StatusInternalServerError)
		return
	}

	logger.Info("成功获取公告统计信息", 
		logger.Any("userId", uid),
		logger.Any("stats", stats))

	response := map[string]interface{}{
		"success": true,
		"data":    stats,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// RegisterAnnouncementRoutes 注册公告相关路由 - 适配现有中间件
func RegisterAnnouncementRoutes(router *mux.Router, handler *AnnouncementHandler, authMiddleware func(http.HandlerFunc) http.HandlerFunc) {
	logger.Info("开始注册公告相关路由")
	
	// 公告相关路由
	router.HandleFunc("/api/announcements", authMiddleware(handler.GetAnnouncements)).Methods("GET")
	router.HandleFunc("/api/announcements/unread", authMiddleware(handler.GetUnreadAnnouncements)).Methods("GET")
	router.HandleFunc("/api/announcements/{id}/read", authMiddleware(handler.MarkAsRead)).Methods("PUT")
	router.HandleFunc("/api/announcements", authMiddleware(handler.CreateAnnouncement)).Methods("POST")
	router.HandleFunc("/api/announcements/{id}", authMiddleware(handler.DeleteAnnouncement)).Methods("DELETE")
	router.HandleFunc("/api/announcements/stats", authMiddleware(handler.GetAnnouncementStats)).Methods("GET")
	
	logger.Info("公告路由注册完成", 
		logger.String("routes", "GET,POST /api/announcements | GET /api/announcements/unread | PUT /api/announcements/{id}/read | DELETE /api/announcements/{id} | GET /api/announcements/stats"))
}
