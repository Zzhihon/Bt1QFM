package room

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"time"

	"Bt1QFM/cache"
	"Bt1QFM/logger"
	"Bt1QFM/model"
	"Bt1QFM/repository"
)

// RoomManager 房间业务管理器
type RoomManager struct {
	repo       repository.RoomRepository
	cache      *cache.RoomCache
	hub        *RoomHub
	maxMembers int
}

// NewRoomManager 创建房间管理器
func NewRoomManager(repo repository.RoomRepository, roomCache *cache.RoomCache, hub *RoomHub) *RoomManager {
	return &RoomManager{
		repo:       repo,
		cache:      roomCache,
		hub:        hub,
		maxMembers: 10,
	}
}

// ========== 房间管理 ==========

// CreateRoom 创建房间
func (m *RoomManager) CreateRoom(ctx context.Context, ownerID int64, ownerName string, roomName string) (*model.Room, error) {
	// 生成唯一房间ID
	roomID, err := m.generateUniqueRoomID(ctx)
	if err != nil {
		return nil, fmt.Errorf("生成房间ID失败: %w", err)
	}

	// 创建房间
	room := &model.Room{
		ID:         roomID,
		Name:       roomName,
		OwnerID:    ownerID,
		MaxMembers: m.maxMembers,
		Status:     model.RoomStatusActive,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	if err := m.repo.Create(ctx, room); err != nil {
		return nil, fmt.Errorf("创建房间失败: %w", err)
	}

	// 房主自动加入房间
	member := &model.RoomMember{
		RoomID:     roomID,
		UserID:     ownerID,
		Role:       model.RoomRoleOwner,
		Mode:       model.RoomModeChat,
		CanControl: true,
		JoinedAt:   time.Now(),
	}
	if err := m.repo.AddMember(ctx, member); err != nil {
		return nil, fmt.Errorf("房主加入房间失败: %w", err)
	}

	// 设置缓存
	memberOnline := &model.RoomMemberOnline{
		UserID:     ownerID,
		Username:   ownerName,
		Role:       model.RoomRoleOwner,
		Mode:       model.RoomModeChat,
		CanControl: true,
		JoinedAt:   time.Now().UnixMilli(),
	}
	if err := m.cache.SetMemberOnline(ctx, roomID, memberOnline); err != nil {
		logger.Warn("设置成员在线状态失败", logger.ErrorField(err))
	}

	logger.Info("房间创建成功",
		logger.String("roomId", roomID),
		logger.Int64("ownerId", ownerID),
		logger.String("roomName", roomName))

	return room, nil
}

// generateUniqueRoomID 生成唯一的6位数字房间ID
func (m *RoomManager) generateUniqueRoomID(ctx context.Context) (string, error) {
	r := rand.New(rand.NewSource(time.Now().UnixNano()))

	for i := 0; i < 100; i++ { // 最多尝试100次
		// 生成6位数字 (100000-999999)
		id := fmt.Sprintf("%06d", r.Intn(900000)+100000)

		exists, err := m.repo.ExistsByID(ctx, id)
		if err != nil {
			return "", err
		}
		if !exists {
			return id, nil
		}
	}

	return "", fmt.Errorf("无法生成唯一房间ID")
}

// JoinRoom 加入房间
func (m *RoomManager) JoinRoom(ctx context.Context, roomID string, userID int64, username, avatar string) (*model.Room, *model.RoomMember, error) {
	// 获取房间
	room, err := m.repo.GetByID(ctx, roomID)
	if err != nil {
		return nil, nil, fmt.Errorf("获取房间失败: %w", err)
	}
	if room == nil {
		return nil, nil, fmt.Errorf("房间不存在")
	}

	// 检查房间人数
	count, err := m.cache.GetOnlineMemberCount(ctx, roomID)
	if err != nil {
		logger.Warn("获取在线人数失败", logger.ErrorField(err))
		// 降级到数据库查询
		count, _ = m.repo.CountActiveMembers(ctx, roomID)
	}
	if count >= int64(room.MaxMembers) {
		return nil, nil, fmt.Errorf("房间已满")
	}

	// 检查是否已经是成员
	existingMember, err := m.repo.GetMember(ctx, roomID, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("查询成员失败: %w", err)
	}

	var member *model.RoomMember
	if existingMember != nil {
		// 已经是成员，更新状态
		member = existingMember
	} else {
		// 新成员加入
		member = &model.RoomMember{
			RoomID:     roomID,
			UserID:     userID,
			Role:       model.RoomRoleMember,
			Mode:       model.RoomModeChat,
			CanControl: false,
			JoinedAt:   time.Now(),
		}
		if err := m.repo.AddMember(ctx, member); err != nil {
			return nil, nil, fmt.Errorf("加入房间失败: %w", err)
		}
	}

	// 设置在线状态
	memberOnline := &model.RoomMemberOnline{
		UserID:     userID,
		Username:   username,
		Avatar:     avatar,
		Role:       member.Role,
		Mode:       member.Mode,
		CanControl: member.CanControl,
		JoinedAt:   time.Now().UnixMilli(),
	}
	if err := m.cache.SetMemberOnline(ctx, roomID, memberOnline); err != nil {
		logger.Warn("设置成员在线状态失败", logger.ErrorField(err))
	}

	// 广播加入消息
	m.broadcastMemberJoin(roomID, userID, username)

	logger.Info("用户加入房间",
		logger.String("roomId", roomID),
		logger.Int64("userId", userID),
		logger.String("username", username))

	return room, member, nil
}

// LeaveRoom 离开房间
func (m *RoomManager) LeaveRoom(ctx context.Context, roomID string, userID int64, transferTo *int64) error {
	// 获取成员信息
	member, err := m.repo.GetMember(ctx, roomID, userID)
	if err != nil {
		return fmt.Errorf("获取成员信息失败: %w", err)
	}
	if member == nil {
		return fmt.Errorf("用户不在房间中")
	}

	// 如果是房主且需要转让
	if member.Role == model.RoomRoleOwner {
		if transferTo != nil && *transferTo != userID {
			// 转让房主
			if err := m.TransferOwner(ctx, roomID, userID, *transferTo); err != nil {
				return fmt.Errorf("转让房主失败: %w", err)
			}
		} else {
			// 检查是否还有其他成员
			members, err := m.cache.GetMembersOnline(ctx, roomID)
			if err == nil && len(members) > 1 {
				// 自动选择一个成员转让
				for _, member := range members {
					if member.UserID != userID {
						if err := m.repo.TransferOwner(ctx, roomID, userID, member.UserID); err == nil {
							// 更新缓存
							m.cache.UpdateMemberRole(ctx, roomID, member.UserID, model.RoomRoleOwner)
							m.hub.UpdateClientRole(roomID, member.UserID, model.RoomRoleOwner)
							m.broadcastRoleUpdate(roomID, member.UserID, model.RoomRoleOwner)
						}
						break
					}
				}
			} else {
				// 没有其他成员，关闭房间
				if err := m.CloseRoom(ctx, roomID); err != nil {
					logger.Warn("关闭房间失败", logger.ErrorField(err))
				}
			}
		}
	}

	// 移除成员
	if err := m.repo.RemoveMember(ctx, roomID, userID); err != nil {
		return fmt.Errorf("移除成员失败: %w", err)
	}

	// 移除在线状态
	if err := m.cache.RemoveMemberOnline(ctx, roomID, userID); err != nil {
		logger.Warn("移除在线状态失败", logger.ErrorField(err))
	}

	// 广播离开消息
	m.broadcastMemberLeave(roomID, userID)

	logger.Info("用户离开房间",
		logger.String("roomId", roomID),
		logger.Int64("userId", userID))

	return nil
}

// CloseRoom 关闭房间
func (m *RoomManager) CloseRoom(ctx context.Context, roomID string) error {
	// 关闭数据库记录
	if err := m.repo.Close(ctx, roomID); err != nil {
		return fmt.Errorf("关闭房间失败: %w", err)
	}

	// 清理缓存
	if err := m.cache.ClearRoom(ctx, roomID); err != nil {
		logger.Warn("清理房间缓存失败", logger.ErrorField(err))
	}

	logger.Info("房间已关闭", logger.String("roomId", roomID))
	return nil
}

// GetRoom 获取房间信息
func (m *RoomManager) GetRoom(ctx context.Context, roomID string) (*model.Room, error) {
	return m.repo.GetByID(ctx, roomID)
}

// GetRoomInfo 获取房间完整信息
func (m *RoomManager) GetRoomInfo(ctx context.Context, roomID string, ownerName string) (*model.RoomInfo, error) {
	room, err := m.repo.GetByID(ctx, roomID)
	if err != nil {
		return nil, err
	}
	if room == nil {
		return nil, fmt.Errorf("房间不存在")
	}

	// 获取在线成员
	members, err := m.cache.GetMembersOnline(ctx, roomID)
	if err != nil {
		logger.Warn("获取在线成员失败", logger.ErrorField(err))
		members = []model.RoomMemberOnline{}
	}

	return &model.RoomInfo{
		Room:        *room,
		OwnerName:   ownerName,
		MemberCount: len(members),
		Members:     members,
	}, nil
}

// ========== 权限管理 ==========

// TransferOwner 转让房主
func (m *RoomManager) TransferOwner(ctx context.Context, roomID string, fromUserID, toUserID int64) error {
	// 验证当前用户是房主
	member, err := m.repo.GetMember(ctx, roomID, fromUserID)
	if err != nil || member == nil || member.Role != model.RoomRoleOwner {
		return fmt.Errorf("只有房主可以转让权限")
	}

	// 验证目标用户在房间中
	targetMember, err := m.repo.GetMember(ctx, roomID, toUserID)
	if err != nil || targetMember == nil {
		return fmt.Errorf("目标用户不在房间中")
	}

	// 执行转让
	if err := m.repo.TransferOwner(ctx, roomID, fromUserID, toUserID); err != nil {
		return fmt.Errorf("转让失败: %w", err)
	}

	// 更新缓存
	m.cache.UpdateMemberRole(ctx, roomID, fromUserID, model.RoomRoleMember)
	m.cache.UpdateMemberRole(ctx, roomID, toUserID, model.RoomRoleOwner)
	m.cache.UpdateMemberControl(ctx, roomID, fromUserID, false)
	m.cache.UpdateMemberControl(ctx, roomID, toUserID, true)

	// 更新 Hub 中的客户端状态
	m.hub.UpdateClientRole(roomID, fromUserID, model.RoomRoleMember)
	m.hub.UpdateClientRole(roomID, toUserID, model.RoomRoleOwner)

	// 广播角色变更
	m.broadcastRoleUpdate(roomID, toUserID, model.RoomRoleOwner)
	m.broadcastRoleUpdate(roomID, fromUserID, model.RoomRoleMember)

	logger.Info("房主转让成功",
		logger.String("roomId", roomID),
		logger.Int64("from", fromUserID),
		logger.Int64("to", toUserID))

	return nil
}

// GrantControl 授予/撤销播放控制权限
func (m *RoomManager) GrantControl(ctx context.Context, roomID string, operatorID, targetUserID int64, canControl bool) error {
	// 验证操作者是房主
	operator, err := m.repo.GetMember(ctx, roomID, operatorID)
	if err != nil || operator == nil || operator.Role != model.RoomRoleOwner {
		return fmt.Errorf("只有房主可以授权")
	}

	// 更新数据库
	if err := m.repo.GrantControl(ctx, roomID, targetUserID, canControl); err != nil {
		return fmt.Errorf("更新权限失败: %w", err)
	}

	// 更新缓存
	m.cache.UpdateMemberControl(ctx, roomID, targetUserID, canControl)

	// 广播权限变更
	m.broadcastControlUpdate(roomID, targetUserID, canControl)

	logger.Info("控制权限变更",
		logger.String("roomId", roomID),
		logger.Int64("targetUser", targetUserID),
		logger.Bool("canControl", canControl))

	return nil
}

// ========== 模式切换 ==========

// SwitchMode 切换用户模式
func (m *RoomManager) SwitchMode(ctx context.Context, roomID string, userID int64, mode string) error {
	if mode != model.RoomModeChat && mode != model.RoomModeListen {
		return fmt.Errorf("无效的模式: %s", mode)
	}

	// 更新数据库
	if err := m.repo.UpdateMemberMode(ctx, roomID, userID, mode); err != nil {
		return fmt.Errorf("更新模式失败: %w", err)
	}

	// 更新缓存
	if err := m.cache.UpdateMemberMode(ctx, roomID, userID, mode); err != nil {
		logger.Warn("更新缓存模式失败", logger.ErrorField(err))
	}

	// 更新 Hub
	m.hub.UpdateClientMode(roomID, userID, mode)

	// 如果切换到 listen 模式，同步当前播放状态
	if mode == model.RoomModeListen {
		m.syncPlaybackToUser(ctx, roomID, userID)
	}

	logger.Info("用户切换模式",
		logger.String("roomId", roomID),
		logger.Int64("userId", userID),
		logger.String("mode", mode))

	return nil
}

// ========== 播放控制 ==========

// UpdatePlayback 更新播放状态
func (m *RoomManager) UpdatePlayback(ctx context.Context, roomID string, userID int64, state *model.RoomPlaybackState) error {
	// 验证用户有控制权限
	member, err := m.cache.GetMemberOnline(ctx, roomID, userID)
	if err != nil || member == nil {
		return fmt.Errorf("用户不在房间中")
	}
	if !member.CanControl && member.Role != model.RoomRoleOwner {
		return fmt.Errorf("没有播放控制权限")
	}

	state.UpdatedAt = time.Now().UnixMilli()
	state.UpdatedBy = userID

	// 更新缓存
	if err := m.cache.SetPlaybackState(ctx, roomID, state); err != nil {
		return fmt.Errorf("更新播放状态失败: %w", err)
	}

	// 广播给 listen 模式的用户
	m.broadcastPlayback(roomID, state, userID)

	return nil
}

// GetPlayback 获取播放状态
func (m *RoomManager) GetPlayback(ctx context.Context, roomID string) (*model.RoomPlaybackState, error) {
	return m.cache.GetPlaybackState(ctx, roomID)
}

// syncPlaybackToUser 向用户同步当前播放状态
func (m *RoomManager) syncPlaybackToUser(ctx context.Context, roomID string, userID int64) {
	state, err := m.cache.GetPlaybackState(ctx, roomID)
	if err != nil || state == nil {
		return
	}

	client := m.hub.GetClient(roomID, userID)
	if client == nil {
		return
	}

	data, _ := json.Marshal(state)
	msg := &WSMessage{
		Type: MsgTypeSync,
		Data: data,
	}
	client.SendMessage(msg)
}

// ========== 歌单管理 ==========

// AddSong 添加歌曲到歌单
func (m *RoomManager) AddSong(ctx context.Context, roomID string, userID int64, song *SongData) error {
	item := &cache.PlaylistItem{
		SongID:   song.SongID,
		Name:     song.Name,
		Artist:   song.Artist,
		Cover:    song.Cover,
		Duration: song.Duration,
		Source:   song.Source,
		AddedBy:  userID,
		AddedAt:  time.Now().UnixMilli(),
	}

	if err := m.cache.AddToRoomPlaylist(ctx, roomID, item); err != nil {
		return fmt.Errorf("添加歌曲失败: %w", err)
	}

	// 广播歌曲添加
	m.broadcastSongAdd(roomID, userID, song)

	return nil
}

// RemoveSong 从歌单移除歌曲
func (m *RoomManager) RemoveSong(ctx context.Context, roomID string, userID int64, position int) error {
	// 验证权限
	member, err := m.cache.GetMemberOnline(ctx, roomID, userID)
	if err != nil || member == nil {
		return fmt.Errorf("用户不在房间中")
	}
	if !member.CanControl && member.Role != model.RoomRoleOwner {
		return fmt.Errorf("没有删除权限")
	}

	if err := m.cache.RemoveFromRoomPlaylist(ctx, roomID, position); err != nil {
		return fmt.Errorf("移除歌曲失败: %w", err)
	}

	// 广播歌曲删除
	m.broadcastSongRemove(roomID, position)

	return nil
}

// GetPlaylist 获取歌单
func (m *RoomManager) GetPlaylist(ctx context.Context, roomID string) ([]cache.PlaylistItem, error) {
	return m.cache.GetRoomPlaylist(ctx, roomID)
}

// ========== 消息管理 ==========

// SendMessage 发送聊天消息
func (m *RoomManager) SendMessage(ctx context.Context, roomID string, userID int64, username, content string) error {
	// 保存消息到数据库
	msg := &model.RoomMessage{
		RoomID:      roomID,
		UserID:      userID,
		Content:     content,
		MessageType: model.RoomMsgTypeText,
		CreatedAt:   time.Now(),
	}
	if err := m.repo.CreateMessage(ctx, msg); err != nil {
		logger.Warn("保存消息失败", logger.ErrorField(err))
	}

	// 广播消息
	chatData, _ := json.Marshal(&ChatData{Content: content})
	wsMsg := &WSMessage{
		Type:     MsgTypeChat,
		RoomID:   roomID,
		UserID:   userID,
		Username: username,
		Data:     chatData,
	}
	m.hub.BroadcastWSMessage(roomID, wsMsg, 0, "")

	return nil
}

// GetMessages 获取历史消息
func (m *RoomManager) GetMessages(ctx context.Context, roomID string, limit, offset int) ([]*model.RoomMessage, error) {
	return m.repo.GetMessages(ctx, roomID, limit, offset)
}

// ========== 广播辅助方法 ==========

func (m *RoomManager) broadcastMemberJoin(roomID string, userID int64, username string) {
	msg := &WSMessage{
		Type:     MsgTypeJoin,
		RoomID:   roomID,
		UserID:   userID,
		Username: username,
	}
	m.hub.BroadcastWSMessage(roomID, msg, userID, "")
}

func (m *RoomManager) broadcastMemberLeave(roomID string, userID int64) {
	msg := &WSMessage{
		Type:   MsgTypeLeave,
		RoomID: roomID,
		UserID: userID,
	}
	m.hub.BroadcastWSMessage(roomID, msg, 0, "")
}

func (m *RoomManager) broadcastRoleUpdate(roomID string, userID int64, role string) {
	data, _ := json.Marshal(map[string]interface{}{
		"userId": userID,
		"role":   role,
	})
	msg := &WSMessage{
		Type:   MsgTypeRoleUpdate,
		RoomID: roomID,
		Data:   data,
	}
	m.hub.BroadcastWSMessage(roomID, msg, 0, "")
}

func (m *RoomManager) broadcastControlUpdate(roomID string, userID int64, canControl bool) {
	data, _ := json.Marshal(map[string]interface{}{
		"userId":     userID,
		"canControl": canControl,
	})
	msg := &WSMessage{
		Type:   MsgTypeGrantControl,
		RoomID: roomID,
		Data:   data,
	}
	m.hub.BroadcastWSMessage(roomID, msg, 0, "")
}

func (m *RoomManager) broadcastPlayback(roomID string, state *model.RoomPlaybackState, excludeUserID int64) {
	data, _ := json.Marshal(state)
	msg := &WSMessage{
		Type:   MsgTypePlayback,
		RoomID: roomID,
		Data:   data,
	}
	// 只发送给 listen 模式的用户
	m.hub.BroadcastWSMessage(roomID, msg, excludeUserID, model.RoomModeListen)
}

func (m *RoomManager) broadcastSongAdd(roomID string, userID int64, song *SongData) {
	data, _ := json.Marshal(song)
	msg := &WSMessage{
		Type:   MsgTypeSongAdd,
		RoomID: roomID,
		UserID: userID,
		Data:   data,
	}
	m.hub.BroadcastWSMessage(roomID, msg, 0, "")
}

func (m *RoomManager) broadcastSongRemove(roomID string, position int) {
	data, _ := json.Marshal(map[string]int{"position": position})
	msg := &WSMessage{
		Type:   MsgTypeSongDel,
		RoomID: roomID,
		Data:   data,
	}
	m.hub.BroadcastWSMessage(roomID, msg, 0, "")
}

// ========== 消息处理器 ==========

// HandleMessage 处理 WebSocket 消息
func (m *RoomManager) HandleMessage(ctx context.Context, client *Client, msg *WSMessage) {
	// 处理前端双重序列化的 data 字段
	data := msg.Data
	if len(data) > 0 && data[0] == '"' {
		// data 是一个 JSON 字符串，需要先解码
		var decoded string
		if err := json.Unmarshal(data, &decoded); err == nil {
			data = json.RawMessage(decoded)
		}
	}

	switch msg.Type {
	case MsgTypeChat:
		var chatData ChatData
		if err := json.Unmarshal(data, &chatData); err == nil {
			m.SendMessage(ctx, client.RoomID, client.UserID, client.Username, chatData.Content)
		} else {
			logger.Warn("解析聊天消息失败",
				logger.ErrorField(err),
				logger.String("data", string(data)))
		}

	case MsgTypePlay, MsgTypePause, MsgTypeSeek:
		var playbackData PlaybackData
		if err := json.Unmarshal(data, &playbackData); err == nil {
			state := &model.RoomPlaybackState{
				Position:  playbackData.Position,
				IsPlaying: msg.Type == MsgTypePlay,
			}
			if msg.Type == MsgTypeSeek {
				// 获取当前播放状态，只更新位置
				if current, err := m.GetPlayback(ctx, client.RoomID); err == nil && current != nil {
					state.IsPlaying = current.IsPlaying
					state.CurrentIndex = current.CurrentIndex
					state.CurrentSong = current.CurrentSong
				}
			}
			m.UpdatePlayback(ctx, client.RoomID, client.UserID, state)
		}

	case MsgTypeNext, MsgTypePrev:
		// 切换歌曲
		if current, err := m.GetPlayback(ctx, client.RoomID); err == nil && current != nil {
			newIndex := current.CurrentIndex
			if msg.Type == MsgTypeNext {
				newIndex++
			} else {
				newIndex--
			}
			// 获取歌单检查边界
			playlist, _ := m.GetPlaylist(ctx, client.RoomID)
			if newIndex < 0 {
				newIndex = 0
			} else if newIndex >= len(playlist) {
				newIndex = len(playlist) - 1
			}
			if newIndex >= 0 && newIndex < len(playlist) {
				current.CurrentIndex = newIndex
				current.CurrentSong = playlist[newIndex]
				current.Position = 0
				m.UpdatePlayback(ctx, client.RoomID, client.UserID, current)
			}
		}

	case MsgTypeSongAdd:
		var songData SongData
		if err := json.Unmarshal(data, &songData); err == nil {
			m.AddSong(ctx, client.RoomID, client.UserID, &songData)
		}

	case MsgTypeSongDel:
		var delData struct {
			Position int `json:"position"`
		}
		if err := json.Unmarshal(data, &delData); err == nil {
			m.RemoveSong(ctx, client.RoomID, client.UserID, delData.Position)
		}

	case MsgTypeModeSync:
		var modeData struct {
			Mode string `json:"mode"`
		}
		if err := json.Unmarshal(data, &modeData); err == nil {
			m.SwitchMode(ctx, client.RoomID, client.UserID, modeData.Mode)
		}

	case MsgTypeTransferOwner:
		var controlData ControlData
		if err := json.Unmarshal(data, &controlData); err == nil {
			m.TransferOwner(ctx, client.RoomID, client.UserID, controlData.TargetUserID)
		}

	case MsgTypeGrantControl:
		var controlData ControlData
		if err := json.Unmarshal(data, &controlData); err == nil {
			m.GrantControl(ctx, client.RoomID, client.UserID, controlData.TargetUserID, controlData.CanControl)
		}
	}
}

// GetHub 获取 Hub 实例
func (m *RoomManager) GetHub() *RoomHub {
	return m.hub
}
