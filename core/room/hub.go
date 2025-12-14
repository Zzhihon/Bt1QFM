package room

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"Bt1QFM/cache"
	"Bt1QFM/logger"

	"github.com/gorilla/websocket"
)

// MessageType 消息类型
type MessageType string

const (
	// 系统消息
	MsgTypeJoin       MessageType = "join"        // 加入房间
	MsgTypeLeave      MessageType = "leave"       // 离开房间
	MsgTypeError      MessageType = "error"       // 错误消息
	MsgTypePing       MessageType = "ping"        // 心跳
	MsgTypePong       MessageType = "pong"        // 心跳响应
	MsgTypeSync       MessageType = "sync"        // 状态同步
	MsgTypeMemberList MessageType = "member_list" // 成员列表

	// 聊天消息
	MsgTypeChat       MessageType = "chat"        // 聊天消息
	MsgTypeSongSearch MessageType = "song_search" // 歌曲搜索结果

	// 播放控制消息
	MsgTypePlay          MessageType = "play"           // 播放
	MsgTypePause         MessageType = "pause"          // 暂停
	MsgTypeSeek          MessageType = "seek"           // 跳转
	MsgTypeNext          MessageType = "next"           // 下一首
	MsgTypePrev          MessageType = "prev"           // 上一首
	MsgTypePlayback      MessageType = "playback"       // 播放状态更新
	MsgTypeSongAdd       MessageType = "song_add"       // 添加歌曲
	MsgTypeSongDel       MessageType = "song_del"       // 删除歌曲
	MsgTypePlaylist      MessageType = "playlist"       // 歌单更新
	MsgTypeModeSync      MessageType = "mode_sync"      // 模式同步
	MsgTypeMasterSync    MessageType = "master_sync"    // 房主播放状态同步（房主 -> 其他用户）
	MsgTypeMasterReport  MessageType = "master_report"  // 房主上报播放状态（房主 -> 服务端）
	MsgTypeMasterRequest MessageType = "master_request" // 请求房主播放状态（用户 -> 服务端 -> 房主）

	// 订阅相关消息
	MsgTypeMasterModeChange MessageType = "master_mode" // 房主模式变更通知
	MsgTypeSongPlay         MessageType = "song_play"   // 播放歌曲（添加到歌单并播放）

	// 权限消息
	MsgTypeTransferOwner MessageType = "transfer_owner" // 转让房主
	MsgTypeGrantControl  MessageType = "grant_control"  // 授权控制
	MsgTypeRoleUpdate    MessageType = "role_update"    // 角色更新

	// 房间管理消息
	MsgTypeRoomDisband MessageType = "room_disband" // 房间解散

	// 切歌同步消息（任意有权限用户切歌后广播给所有 listen 用户）
	MsgTypeSongChange MessageType = "song_change" // 切换歌曲
)

// WSMessage WebSocket 消息结构
type WSMessage struct {
	Type      MessageType     `json:"type"`
	RoomID    string          `json:"roomId,omitempty"`
	UserID    int64           `json:"userId,omitempty"`
	Username  string          `json:"username,omitempty"`
	Data      json.RawMessage `json:"data,omitempty"`
	Timestamp int64           `json:"timestamp"`
}

// ChatData 聊天消息数据
type ChatData struct {
	Content string `json:"content"`
}

// SongSearchData 歌曲搜索结果数据
type SongSearchData struct {
	Query string         `json:"query"`
	Songs []SongCardData `json:"songs"`
}

// SongCardData 歌曲卡片数据
type SongCardData struct {
	ID       int64    `json:"id"`
	Name     string   `json:"name"`
	Artists  []string `json:"artists"`
	Album    string   `json:"album"`
	Duration int      `json:"duration"`
	CoverURL string   `json:"coverUrl"`
	HLSURL   string   `json:"hlsUrl"`
	Source   string   `json:"source"`
}

// PlaybackData 播放控制数据
type PlaybackData struct {
	Position     float64     `json:"position,omitempty"`
	IsPlaying    bool        `json:"isPlaying,omitempty"`
	CurrentIndex int         `json:"currentIndex,omitempty"`
	CurrentSong  interface{} `json:"currentSong,omitempty"`
}

// MasterSyncData 房主播放同步数据
type MasterSyncData struct {
	SongID      string  `json:"songId"`              // 当前歌曲ID
	SongName    string  `json:"songName"`            // 歌曲名称
	Artist      string  `json:"artist"`              // 艺术家
	Cover       string  `json:"cover,omitempty"`     // 封面
	Duration    int     `json:"duration"`            // 歌曲总时长（毫秒）
	Position    float64 `json:"position"`            // 当前播放位置（秒）
	IsPlaying   bool    `json:"isPlaying"`           // 是否正在播放
	HlsURL      string  `json:"hlsUrl,omitempty"`    // HLS 播放地址
	ServerTime  int64   `json:"serverTime"`          // 服务器时间戳（毫秒）
	MasterID    int64   `json:"masterId"`            // 房主用户ID
	MasterName  string  `json:"masterName"`          // 房主用户名
}

// SongData 歌曲操作数据
type SongData struct {
	SongID   string      `json:"songId"`
	Name     string      `json:"name"`
	Artist   string      `json:"artist"`
	Cover    string      `json:"cover,omitempty"`
	Duration int         `json:"duration,omitempty"`
	Source   string      `json:"source,omitempty"`
	Position int         `json:"position,omitempty"`
	Extra    interface{} `json:"extra,omitempty"`
}

// ControlData 控制权限数据
type ControlData struct {
	TargetUserID int64 `json:"targetUserId"`
	CanControl   bool  `json:"canControl,omitempty"`
}

// SongChangeData 切歌同步数据（广播给所有 listen 用户）
type SongChangeData struct {
	SongID        string  `json:"songId"`        // 歌曲ID
	SongName      string  `json:"songName"`      // 歌曲名称
	Artist        string  `json:"artist"`        // 艺术家
	Cover         string  `json:"cover"`         // 封面
	Duration      int     `json:"duration"`      // 时长（毫秒）
	HlsURL        string  `json:"hlsUrl"`        // HLS 播放地址
	Position      float64 `json:"position"`      // 从哪个位置开始播放（秒）
	IsPlaying     bool    `json:"isPlaying"`     // 是否播放
	ChangedBy     int64   `json:"changedBy"`     // 切歌用户ID
	ChangedByName string  `json:"changedByName"` // 切歌用户名
	Timestamp     int64   `json:"timestamp"`     // 时间戳
}

// Client WebSocket 客户端
type Client struct {
	Hub      *RoomHub
	Conn     *websocket.Conn
	Send     chan []byte
	RoomID   string
	UserID   int64
	Username string
	Mode     string // chat, listen
	Role     string // owner, admin, member
	mu       sync.RWMutex
}

// RoomHub 房间 WebSocket 管理中心
type RoomHub struct {
	// 房间 -> 客户端集合
	rooms map[string]map[*Client]bool

	// 用户 -> 客户端（一个用户在一个房间只能有一个连接）
	userClients map[string]*Client // key: roomID:userID

	// 注册/注销通道
	register   chan *Client
	unregister chan *Client

	// 广播通道
	broadcast chan *BroadcastMessage

	// 互斥锁
	mu sync.RWMutex

	// 关闭信号
	done chan struct{}
}

// BroadcastMessage 广播消息
type BroadcastMessage struct {
	RoomID    string
	Message   []byte
	ExcludeID int64 // 排除的用户ID（用于不向发送者回发）
	OnlyMode  string // 只发送给特定模式的用户（listen/chat）
}

// NewRoomHub 创建房间 Hub
func NewRoomHub() *RoomHub {
	return &RoomHub{
		rooms:       make(map[string]map[*Client]bool),
		userClients: make(map[string]*Client),
		register:    make(chan *Client),
		unregister:  make(chan *Client),
		broadcast:   make(chan *BroadcastMessage, 256),
		done:        make(chan struct{}),
	}
}

// Run 启动 Hub 主循环
func (h *RoomHub) Run() {
	for {
		select {
		case client := <-h.register:
			h.registerClient(client)

		case client := <-h.unregister:
			h.unregisterClient(client)

		case msg := <-h.broadcast:
			h.broadcastToRoom(msg)

		case <-h.done:
			h.cleanup()
			return
		}
	}
}

// Stop 停止 Hub
func (h *RoomHub) Stop() {
	close(h.done)
}

// registerClient 注册客户端
func (h *RoomHub) registerClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	roomID := client.RoomID
	userKey := h.userKey(roomID, client.UserID)

	// 检查用户是否已经在房间中，如果是则踢掉旧连接
	if oldClient, exists := h.userClients[userKey]; exists {
		h.removeClient(oldClient)
	}

	// 初始化房间
	if h.rooms[roomID] == nil {
		h.rooms[roomID] = make(map[*Client]bool)
	}

	// 添加客户端
	h.rooms[roomID][client] = true
	h.userClients[userKey] = client

	// 更新 Redis 中的用户在线状态
	ctx := context.Background()
	roomCache := cache.NewRoomCache()
	if err := roomCache.UpdateUserPresence(ctx, roomID, client.UserID); err != nil {
		logger.Warn("failed to update user presence on register",
			logger.ErrorField(err),
			logger.String("room", roomID),
			logger.Int64("user", client.UserID))
	}

	logger.Info("client registered",
		logger.String("room", roomID),
		logger.Int64("user", client.UserID),
		logger.String("username", client.Username))
}

// unregisterClient 注销客户端
func (h *RoomHub) unregisterClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.removeClient(client)
}

// removeClient 移除客户端（内部方法，需要持有锁）
func (h *RoomHub) removeClient(client *Client) {
	roomID := client.RoomID
	userKey := h.userKey(roomID, client.UserID)

	if _, ok := h.rooms[roomID]; ok {
		if _, ok := h.rooms[roomID][client]; ok {
			delete(h.rooms[roomID], client)
			close(client.Send)

			// 如果房间空了，删除房间
			if len(h.rooms[roomID]) == 0 {
				delete(h.rooms, roomID)
			}
		}
	}

	delete(h.userClients, userKey)

	// 清理订阅管理器中的订阅（WebSocket 断开时自动清理）
	GetSubscriptionManager().Unsubscribe(roomID, client.UserID)

	// 移除 Redis 中的用户在线状态
	ctx := context.Background()
	roomCache := cache.NewRoomCache()
	if err := roomCache.RemoveUserPresence(ctx, roomID, client.UserID); err != nil {
		logger.Warn("failed to remove user presence on unregister",
			logger.ErrorField(err),
			logger.String("room", roomID),
			logger.Int64("user", client.UserID))
	}

	logger.Info("client unregistered",
		logger.String("room", roomID),
		logger.Int64("user", client.UserID))
}

// broadcastToRoom 向房间广播消息
func (h *RoomHub) broadcastToRoom(msg *BroadcastMessage) {
	h.mu.RLock()
	clients, ok := h.rooms[msg.RoomID]
	if !ok {
		h.mu.RUnlock()
		return
	}

	// 复制客户端列表以避免长时间持有锁
	clientList := make([]*Client, 0, len(clients))
	for client := range clients {
		clientList = append(clientList, client)
	}
	h.mu.RUnlock()

	for _, client := range clientList {
		// 排除指定用户
		if msg.ExcludeID > 0 && client.UserID == msg.ExcludeID {
			continue
		}

		// 只发送给特定模式的用户
		if msg.OnlyMode != "" && client.Mode != msg.OnlyMode {
			continue
		}

		select {
		case client.Send <- msg.Message:
		default:
			// 发送缓冲区满，移除客户端
			h.unregister <- client
		}
	}
}

// cleanup 清理所有连接
func (h *RoomHub) cleanup() {
	h.mu.Lock()
	defer h.mu.Unlock()

	for _, clients := range h.rooms {
		for client := range clients {
			close(client.Send)
		}
	}
	h.rooms = make(map[string]map[*Client]bool)
	h.userClients = make(map[string]*Client)
}

// userKey 生成用户键
func (h *RoomHub) userKey(roomID string, userID int64) string {
	return fmt.Sprintf("%s:%d", roomID, userID)
}

// Register 注册客户端
func (h *RoomHub) Register(client *Client) {
	h.register <- client
}

// Unregister 注销客户端
func (h *RoomHub) Unregister(client *Client) {
	h.unregister <- client
}

// Broadcast 广播消息到房间
func (h *RoomHub) Broadcast(roomID string, message []byte, excludeUserID int64, onlyMode string) {
	h.broadcast <- &BroadcastMessage{
		RoomID:    roomID,
		Message:   message,
		ExcludeID: excludeUserID,
		OnlyMode:  onlyMode,
	}
}

// BroadcastMessage 广播 WSMessage
func (h *RoomHub) BroadcastWSMessage(roomID string, msg *WSMessage, excludeUserID int64, onlyMode string) error {
	msg.Timestamp = time.Now().UnixMilli()
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	h.Broadcast(roomID, data, excludeUserID, onlyMode)
	return nil
}

// GetRoomClients 获取房间所有客户端
func (h *RoomHub) GetRoomClients(roomID string) []*Client {
	h.mu.RLock()
	defer h.mu.RUnlock()

	clients := h.rooms[roomID]
	result := make([]*Client, 0, len(clients))
	for client := range clients {
		result = append(result, client)
	}
	return result
}

// GetRoomClientCount 获取房间客户端数量
func (h *RoomHub) GetRoomClientCount(roomID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()

	return len(h.rooms[roomID])
}

// GetRoomActiveOnlineCount 获取房间活跃在线人数（基于Redis心跳）
func (h *RoomHub) GetRoomActiveOnlineCount(roomID string) (int64, error) {
	ctx := context.Background()
	roomCache := cache.NewRoomCache()
	return roomCache.GetActiveOnlineCount(ctx, roomID)
}

// GetClient 获取指定用户的客户端
func (h *RoomHub) GetClient(roomID string, userID int64) *Client {
	h.mu.RLock()
	defer h.mu.RUnlock()

	return h.userClients[h.userKey(roomID, userID)]
}

// SendToUser 发送消息给指定用户
func (h *RoomHub) SendToUser(roomID string, userID int64, msg *WSMessage) error {
	h.mu.RLock()
	client := h.userClients[h.userKey(roomID, userID)]
	h.mu.RUnlock()

	if client == nil {
		return fmt.Errorf("user not found: %d", userID)
	}

	msg.Timestamp = time.Now().UnixMilli()
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	select {
	case client.Send <- data:
		return nil
	default:
		return fmt.Errorf("send buffer full for user: %d", userID)
	}
}

// UpdateClientMode 更新客户端模式
func (h *RoomHub) UpdateClientMode(roomID string, userID int64, mode string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if client := h.userClients[h.userKey(roomID, userID)]; client != nil {
		client.mu.Lock()
		client.Mode = mode
		client.mu.Unlock()
	}
}

// UpdateClientRole 更新客户端角色
func (h *RoomHub) UpdateClientRole(roomID string, userID int64, role string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if client := h.userClients[h.userKey(roomID, userID)]; client != nil {
		client.mu.Lock()
		client.Role = role
		client.mu.Unlock()
	}
}

// ========== Client 方法 ==========

// ReadPump 读取消息循环
func (c *Client) ReadPump(ctx context.Context, handler func(ctx context.Context, client *Client, msg *WSMessage)) {
	defer func() {
		c.Hub.Unregister(c)
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(4096) // 4KB
	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		select {
		case <-ctx.Done():
			return
		default:
			_, message, err := c.Conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					logger.Warn("websocket read error",
						logger.ErrorField(err),
						logger.String("room", c.RoomID),
						logger.Int64("user", c.UserID))
				}
				return
			}

			var msg WSMessage
			if err := json.Unmarshal(message, &msg); err != nil {
				logger.Warn("invalid message format",
					logger.ErrorField(err),
					logger.String("room", c.RoomID))
				continue
			}

			// 处理心跳
			if msg.Type == MsgTypePing {
				// 更新 Redis 中的用户在线状态
				roomCache := cache.NewRoomCache()
				if err := roomCache.UpdateUserPresence(ctx, c.RoomID, c.UserID); err != nil {
					logger.Warn("failed to update user presence",
						logger.ErrorField(err),
						logger.String("room", c.RoomID),
						logger.Int64("user", c.UserID))
				}

				pong := &WSMessage{Type: MsgTypePong, Timestamp: time.Now().UnixMilli()}
				if data, err := json.Marshal(pong); err == nil {
					select {
					case c.Send <- data:
					default:
					}
				}
				continue
			}

			// 调用消息处理器
			handler(ctx, c, &msg)
		}
	}
}

// WritePump 写入消息循环
func (c *Client) WritePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				// Hub 关闭了通道
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// 合并发送队列中的消息
			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// SendMessage 发送消息给客户端
func (c *Client) SendMessage(msg *WSMessage) error {
	msg.Timestamp = time.Now().UnixMilli()
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	select {
	case c.Send <- data:
		return nil
	default:
		return nil // 缓冲区满，丢弃消息
	}
}

// GetMode 获取客户端模式（线程安全）
func (c *Client) GetMode() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Mode
}

// GetRole 获取客户端角色（线程安全）
func (c *Client) GetRole() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Role
}
