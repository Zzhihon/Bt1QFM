package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"Bt1QFM/core/room"
	"Bt1QFM/logger"
	"Bt1QFM/model"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

// RoomHandler 房间 HTTP 处理器
type RoomHandler struct {
	manager  *room.RoomManager
	upgrader websocket.Upgrader
}

// NewRoomHandler 创建房间处理器
func NewRoomHandler(manager *room.RoomManager) *RoomHandler {
	return &RoomHandler{
		manager: manager,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

// ========== HTTP 处理器 ==========

// CreateRoomRequest 创建房间请求
type CreateRoomRequest struct {
	Name string `json:"name"`
}

// CreateRoomResponse 创建房间响应
type CreateRoomResponse struct {
	Room *model.Room `json:"room"`
}

// CreateRoomHandler 创建房间
func (h *RoomHandler) CreateRoomHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// 从上下文获取用户信息
	userID, ok := ctx.Value("userID").(int64)
	if !ok {
		http.Error(w, "未授权", http.StatusUnauthorized)
		return
	}
	username, _ := ctx.Value("username").(string)

	var req CreateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的请求", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		req.Name = username + "的房间"
	}

	room, err := h.manager.CreateRoom(ctx, userID, username, req.Name)
	if err != nil {
		logger.Error("创建房间失败", logger.ErrorField(err))
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(&CreateRoomResponse{Room: room})
}

// JoinRoomRequest 加入房间请求
type JoinRoomRequest struct {
	RoomID string `json:"roomId"`
}

// JoinRoomResponse 加入房间响应
type JoinRoomResponse struct {
	Room   *model.Room       `json:"room"`
	Member *model.RoomMember `json:"member"`
}

// JoinRoomHandler 加入房间
func (h *RoomHandler) JoinRoomHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	userID, ok := ctx.Value("userID").(int64)
	if !ok {
		http.Error(w, "未授权", http.StatusUnauthorized)
		return
	}
	username, _ := ctx.Value("username").(string)
	avatar, _ := ctx.Value("avatar").(string)

	var req JoinRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的请求", http.StatusBadRequest)
		return
	}

	if req.RoomID == "" {
		http.Error(w, "房间ID不能为空", http.StatusBadRequest)
		return
	}

	roomInfo, member, err := h.manager.JoinRoom(ctx, req.RoomID, userID, username, avatar)
	if err != nil {
		logger.Warn("加入房间失败", logger.ErrorField(err))
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(&JoinRoomResponse{Room: roomInfo, Member: member})
}

// LeaveRoomRequest 离开房间请求
type LeaveRoomRequest struct {
	RoomID     string `json:"roomId"`
	TransferTo *int64 `json:"transferTo,omitempty"`
}

// LeaveRoomHandler 离开房间
func (h *RoomHandler) LeaveRoomHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	userID, ok := ctx.Value("userID").(int64)
	if !ok {
		http.Error(w, "未授权", http.StatusUnauthorized)
		return
	}

	var req LeaveRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的请求", http.StatusBadRequest)
		return
	}

	if err := h.manager.LeaveRoom(ctx, req.RoomID, userID, req.TransferTo); err != nil {
		logger.Warn("离开房间失败", logger.ErrorField(err))
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "已离开房间"})
}

// GetRoomHandler 获取房间信息
func (h *RoomHandler) GetRoomHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	roomID := vars["room_id"]

	if roomID == "" {
		http.Error(w, "房间ID不能为空", http.StatusBadRequest)
		return
	}

	roomInfo, err := h.manager.GetRoomInfo(ctx, roomID, "")
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(roomInfo)
}

// GetPlaylistHandler 获取房间歌单
func (h *RoomHandler) GetPlaylistHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	roomID := vars["room_id"]

	playlist, err := h.manager.GetPlaylist(ctx, roomID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(playlist)
}

// GetPlaybackHandler 获取播放状态
func (h *RoomHandler) GetPlaybackHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	roomID := vars["room_id"]

	state, err := h.manager.GetPlayback(ctx, roomID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if state == nil {
		state = &model.RoomPlaybackState{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(state)
}

// SwitchModeRequest 切换模式请求
type SwitchModeRequest struct {
	RoomID string `json:"roomId"`
	Mode   string `json:"mode"` // chat, listen
}

// SwitchModeHandler 切换模式
func (h *RoomHandler) SwitchModeHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	userID, ok := ctx.Value("userID").(int64)
	if !ok {
		http.Error(w, "未授权", http.StatusUnauthorized)
		return
	}

	var req SwitchModeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的请求", http.StatusBadRequest)
		return
	}

	if err := h.manager.SwitchMode(ctx, req.RoomID, userID, req.Mode); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "模式切换成功", "mode": req.Mode})
}

// TransferOwnerRequest 转让房主请求
type TransferOwnerRequest struct {
	RoomID       string `json:"roomId"`
	TargetUserID int64  `json:"targetUserId"`
}

// TransferOwnerHandler 转让房主
func (h *RoomHandler) TransferOwnerHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	userID, ok := ctx.Value("userID").(int64)
	if !ok {
		http.Error(w, "未授权", http.StatusUnauthorized)
		return
	}

	var req TransferOwnerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的请求", http.StatusBadRequest)
		return
	}

	if err := h.manager.TransferOwner(ctx, req.RoomID, userID, req.TargetUserID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "房主转让成功"})
}

// GrantControlRequest 授权控制请求
type GrantControlRequest struct {
	RoomID       string `json:"roomId"`
	TargetUserID int64  `json:"targetUserId"`
	CanControl   bool   `json:"canControl"`
}

// GrantControlHandler 授权控制
func (h *RoomHandler) GrantControlHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	userID, ok := ctx.Value("userID").(int64)
	if !ok {
		http.Error(w, "未授权", http.StatusUnauthorized)
		return
	}

	var req GrantControlRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的请求", http.StatusBadRequest)
		return
	}

	if err := h.manager.GrantControl(ctx, req.RoomID, userID, req.TargetUserID, req.CanControl); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "授权成功"})
}

// GetMessagesHandler 获取历史消息
func (h *RoomHandler) GetMessagesHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	roomID := vars["room_id"]

	limit := 50
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	messages, err := h.manager.GetMessages(ctx, roomID, limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(messages)
}

// GetMyRoomsHandler 获取当前用户参与的房间列表
func (h *RoomHandler) GetMyRoomsHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	userID, ok := ctx.Value("userID").(int64)
	if !ok {
		http.Error(w, "未授权", http.StatusUnauthorized)
		return
	}

	rooms, err := h.manager.GetUserRooms(ctx, userID)
	if err != nil {
		logger.Warn("获取用户房间列表失败", logger.ErrorField(err))
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rooms)
}

// ========== WebSocket 处理器 ==========

// WebSocketHandler 处理 WebSocket 连接
func (h *RoomHandler) WebSocketHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["room_id"]

	if roomID == "" {
		http.Error(w, "房间ID不能为空", http.StatusBadRequest)
		return
	}

	// 从查询参数获取用户信息（WebSocket 无法通过 header 传递 token）
	userIDStr := r.URL.Query().Get("userId")
	username := r.URL.Query().Get("username")
	token := r.URL.Query().Get("token")

	if userIDStr == "" || token == "" {
		http.Error(w, "缺少认证信息", http.StatusUnauthorized)
		return
	}

	userID, err := strconv.ParseInt(userIDStr, 10, 64)
	if err != nil {
		http.Error(w, "无效的用户ID", http.StatusBadRequest)
		return
	}

	// TODO: 验证 token
	// 这里应该调用 token 验证逻辑

	// 检查房间是否存在
	ctx := r.Context()
	roomInfo, err := h.manager.GetRoom(ctx, roomID)
	if err != nil || roomInfo == nil {
		http.Error(w, "房间不存在", http.StatusNotFound)
		return
	}

	// 升级为 WebSocket 连接
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Error("WebSocket 升级失败", logger.ErrorField(err))
		return
	}

	// 创建客户端
	client := &room.Client{
		Hub:      h.manager.GetHub(),
		Conn:     conn,
		Send:     make(chan []byte, 256),
		RoomID:   roomID,
		UserID:   userID,
		Username: username,
		Mode:     model.RoomModeChat,
		Role:     model.RoomRoleMember,
	}

	// 注册客户端
	h.manager.GetHub().Register(client)

	// 启动读写协程
	go client.WritePump()
	go client.ReadPump(context.Background(), h.manager.HandleMessage)

	logger.Info("WebSocket 连接建立",
		logger.String("roomId", roomID),
		logger.Int64("userId", userID),
		logger.String("username", username))
}

// RegisterRoomRoutes 注册房间相关路由
func RegisterRoomRoutes(router *mux.Router, handler *RoomHandler, authMiddleware func(http.HandlerFunc) http.HandlerFunc) {
	// HTTP API 路由
	router.HandleFunc("/api/rooms", authMiddleware(handler.CreateRoomHandler)).Methods(http.MethodPost)
	router.HandleFunc("/api/rooms/my", authMiddleware(handler.GetMyRoomsHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/rooms/join", authMiddleware(handler.JoinRoomHandler)).Methods(http.MethodPost)
	router.HandleFunc("/api/rooms/leave", authMiddleware(handler.LeaveRoomHandler)).Methods(http.MethodPost)
	router.HandleFunc("/api/rooms/{room_id}", authMiddleware(handler.GetRoomHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/rooms/{room_id}/playlist", authMiddleware(handler.GetPlaylistHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/rooms/{room_id}/playback", authMiddleware(handler.GetPlaybackHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/rooms/{room_id}/messages", authMiddleware(handler.GetMessagesHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/rooms/mode", authMiddleware(handler.SwitchModeHandler)).Methods(http.MethodPost)
	router.HandleFunc("/api/rooms/transfer", authMiddleware(handler.TransferOwnerHandler)).Methods(http.MethodPost)
	router.HandleFunc("/api/rooms/control", authMiddleware(handler.GrantControlHandler)).Methods(http.MethodPost)

	// WebSocket 路由
	router.HandleFunc("/ws/room/{room_id}", handler.WebSocketHandler)

	logger.Info("房间系统API端点注册完成",
		logger.String("endpoints", "POST /api/rooms, GET /api/rooms/my, POST /api/rooms/join, POST /api/rooms/leave, GET /api/rooms/{id}, WS /ws/room/{id}"))
}
