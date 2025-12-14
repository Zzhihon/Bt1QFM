package room

import (
	"encoding/json"
	"sync"
	"time"

	"Bt1QFM/logger"
)

// PlaybackSubscription 播放状态订阅管理器
// 管理房间内听歌模式用户的订阅关系，实现高效的播放状态推送
type PlaybackSubscription struct {
	mu sync.RWMutex
	// 房间ID -> 订阅者集合 (userID -> Client)
	subscribers map[string]map[int64]*Client
	// 房间ID -> 房主Client (用于快速访问)
	masters map[string]*Client
}

// 全局订阅管理器实例
var subscriptionManager *PlaybackSubscription
var subscriptionOnce sync.Once

// GetSubscriptionManager 获取订阅管理器单例
func GetSubscriptionManager() *PlaybackSubscription {
	subscriptionOnce.Do(func() {
		subscriptionManager = &PlaybackSubscription{
			subscribers: make(map[string]map[int64]*Client),
			masters:     make(map[string]*Client),
		}
	})
	return subscriptionManager
}

// Subscribe 订阅房间播放状态
// 当用户切换到 listen 模式时调用
func (s *PlaybackSubscription) Subscribe(roomID string, client *Client) {
	if client == nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.subscribers[roomID] == nil {
		s.subscribers[roomID] = make(map[int64]*Client)
	}
	s.subscribers[roomID][client.UserID] = client

	logger.Info("用户订阅播放状态",
		logger.String("roomId", roomID),
		logger.Int64("userId", client.UserID),
		logger.String("username", client.Username),
		logger.Int("totalSubscribers", len(s.subscribers[roomID])))
}

// Unsubscribe 取消订阅
// 当用户切换到 chat 模式或离开房间时调用
func (s *PlaybackSubscription) Unsubscribe(roomID string, userID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if subs, ok := s.subscribers[roomID]; ok {
		delete(subs, userID)
		if len(subs) == 0 {
			delete(s.subscribers, roomID)
		}
		logger.Info("用户取消订阅播放状态",
			logger.String("roomId", roomID),
			logger.Int64("userId", userID))
	}
}

// SetMaster 设置房主为发布者
// 当房主进入 listen 模式时调用
func (s *PlaybackSubscription) SetMaster(roomID string, client *Client) {
	if client == nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.masters[roomID] = client
	logger.Info("房主进入一起听模式",
		logger.String("roomId", roomID),
		logger.Int64("masterId", client.UserID),
		logger.String("masterName", client.Username))
}

// ClearMaster 清除房主发布者状态
// 当房主退出 listen 模式时调用
func (s *PlaybackSubscription) ClearMaster(roomID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if master, ok := s.masters[roomID]; ok {
		logger.Info("房主退出一起听模式",
			logger.String("roomId", roomID),
			logger.Int64("masterId", master.UserID))
		delete(s.masters, roomID)
	}
}

// GetMaster 获取房间的房主Client
func (s *PlaybackSubscription) GetMaster(roomID string) *Client {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.masters[roomID]
}

// IsMasterInListenMode 检查房主是否在听歌模式
func (s *PlaybackSubscription) IsMasterInListenMode(roomID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.masters[roomID] != nil
}

// HasSubscribers 检查房间是否有订阅者
func (s *PlaybackSubscription) HasSubscribers(roomID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.subscribers[roomID]) > 0
}

// GetSubscriberCount 获取订阅者数量
func (s *PlaybackSubscription) GetSubscriberCount(roomID string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.subscribers[roomID])
}

// Publish 发布播放状态给所有订阅者
// excludeUserID: 排除的用户ID（通常是房主自己）
func (s *PlaybackSubscription) Publish(roomID string, state *MasterSyncData, excludeUserID int64) {
	s.mu.RLock()
	subs := s.subscribers[roomID]
	if len(subs) == 0 {
		s.mu.RUnlock()
		return
	}

	// 复制订阅者列表，避免长时间持锁
	clients := make([]*Client, 0, len(subs))
	for uid, client := range subs {
		if uid != excludeUserID {
			clients = append(clients, client)
		}
	}
	s.mu.RUnlock()

	if len(clients) == 0 {
		return
	}

	// 构建消息
	data, err := json.Marshal(state)
	if err != nil {
		logger.Warn("序列化播放状态失败", logger.ErrorField(err))
		return
	}

	msg := &WSMessage{
		Type:      MsgTypeMasterSync,
		RoomID:    roomID,
		UserID:    state.MasterID,
		Username:  state.MasterName,
		Data:      data,
		Timestamp: time.Now().UnixMilli(),
	}
	msgBytes, err := json.Marshal(msg)
	if err != nil {
		logger.Warn("序列化WebSocket消息失败", logger.ErrorField(err))
		return
	}

	// 发送给所有订阅者
	for _, client := range clients {
		select {
		case client.Send <- msgBytes:
			// 发送成功，不记录日志（太频繁）
		default:
			// 缓冲区满，跳过该用户
			logger.Warn("订阅者发送缓冲区满",
				logger.String("roomId", roomID),
				logger.Int64("userId", client.UserID))
		}
	}
}

// PublishToUser 发布播放状态给单个用户
// 用于新用户订阅时立即同步当前状态
func (s *PlaybackSubscription) PublishToUser(roomID string, userID int64, state *MasterSyncData) {
	s.mu.RLock()
	subs := s.subscribers[roomID]
	client := subs[userID]
	s.mu.RUnlock()

	if client == nil {
		return
	}

	data, err := json.Marshal(state)
	if err != nil {
		return
	}

	msg := &WSMessage{
		Type:      MsgTypeMasterSync,
		RoomID:    roomID,
		UserID:    state.MasterID,
		Username:  state.MasterName,
		Data:      data,
		Timestamp: time.Now().UnixMilli(),
	}
	msgBytes, _ := json.Marshal(msg)

	select {
	case client.Send <- msgBytes:
		// 发送成功，不记录日志（太频繁）
	default:
		// 缓冲区满
	}
}

// CleanupRoom 清理房间的所有订阅
// 当房间关闭时调用
func (s *PlaybackSubscription) CleanupRoom(roomID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.subscribers, roomID)
	delete(s.masters, roomID)

	logger.Info("房间订阅已清理", logger.String("roomId", roomID))
}

// GetRoomStatus 获取房间订阅状态（用于调试）
func (s *PlaybackSubscription) GetRoomStatus(roomID string) map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	status := map[string]interface{}{
		"roomId":          roomID,
		"subscriberCount": len(s.subscribers[roomID]),
		"hasMaster":       s.masters[roomID] != nil,
	}

	if master := s.masters[roomID]; master != nil {
		status["masterId"] = master.UserID
		status["masterName"] = master.Username
	}

	subscriberIDs := make([]int64, 0)
	if subs, ok := s.subscribers[roomID]; ok {
		for uid := range subs {
			subscriberIDs = append(subscriberIDs, uid)
		}
	}
	status["subscriberIds"] = subscriberIDs

	return status
}
