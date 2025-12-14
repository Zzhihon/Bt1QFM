package room

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"strconv"
	"strings"
	"time"

	"Bt1QFM/cache"
	"Bt1QFM/core/netease"
	"Bt1QFM/logger"
	"Bt1QFM/model"
	"Bt1QFM/repository"
)

// RoomManager 房间业务管理器
type RoomManager struct {
	repo          repository.RoomRepository
	cache         *cache.RoomCache
	hub           *RoomHub
	neteaseClient *netease.Client
	maxMembers    int
}

// NewRoomManager 创建房间管理器
func NewRoomManager(repo repository.RoomRepository, roomCache *cache.RoomCache, hub *RoomHub) *RoomManager {
	return &RoomManager{
		repo:          repo,
		cache:         roomCache,
		hub:           hub,
		neteaseClient: netease.NewClient(),
		maxMembers:    10,
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

// LeaveRoom 离开房间（暂时离开，不会解散房间）
func (m *RoomManager) LeaveRoom(ctx context.Context, roomID string, userID int64, transferTo *int64) error {
	// 获取成员信息
	member, err := m.repo.GetMember(ctx, roomID, userID)
	if err != nil {
		return fmt.Errorf("获取成员信息失败: %w", err)
	}
	if member == nil {
		return fmt.Errorf("用户不在房间中")
	}

	// 获取房间信息判断是否是房主
	room, _ := m.GetRoom(ctx, roomID)
	isOwner := room != nil && room.OwnerID == userID

	// 清理该用户的订阅（如果是订阅者）
	subMgr := GetSubscriptionManager()
	subMgr.Unsubscribe(roomID, userID)

	// 注意：房主离开房间时 **不** 清除 Master 状态
	// 这样听歌模式可以继续，房主回来后可以继续上报
	// 只有房主主动切换到聊天模式时才清除 Master

	// 注意：离开房间不再自动转让房主或关闭房间
	// 房主离开后仍然是房主，房间保持存在
	// 只有调用 DisbandRoom 才会真正解散房间

	// 移除在线状态（但保留成员记录，方便重新加入）
	if err := m.cache.RemoveMemberOnline(ctx, roomID, userID); err != nil {
		logger.Warn("移除在线状态失败", logger.ErrorField(err))
	}

	// 广播离开消息
	m.broadcastMemberLeave(roomID, userID)

	logger.Info("用户离开房间",
		logger.String("roomId", roomID),
		logger.Int64("userId", userID),
		logger.Bool("isOwner", isOwner))

	return nil
}

// DisbandRoom 解散房间（仅房主可操作）
func (m *RoomManager) DisbandRoom(ctx context.Context, roomID string, userID int64) error {
	// 获取房间信息
	room, err := m.GetRoom(ctx, roomID)
	if err != nil {
		return fmt.Errorf("获取房间失败: %w", err)
	}
	if room == nil {
		return fmt.Errorf("房间不存在")
	}

	// 验证是否是房主
	if room.OwnerID != userID {
		return fmt.Errorf("只有房主可以解散房间")
	}

	// 广播房间解散消息
	m.broadcastRoomDisband(roomID)

	// 关闭房间
	if err := m.CloseRoom(ctx, roomID); err != nil {
		return fmt.Errorf("解散房间失败: %w", err)
	}

	logger.Info("房间已解散",
		logger.String("roomId", roomID),
		logger.Int64("ownerId", userID))

	return nil
}

// CloseRoom 关闭房间
func (m *RoomManager) CloseRoom(ctx context.Context, roomID string) error {
	// 清理订阅
	GetSubscriptionManager().CleanupRoom(roomID)

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

	// 获取房间信息判断是否是房主
	room, _ := m.GetRoom(ctx, roomID)
	isOwner := room != nil && room.OwnerID == userID
	client := m.hub.GetClient(roomID, userID)

	// ========== 订阅管理 ==========
	subMgr := GetSubscriptionManager()

	if mode == model.RoomModeListen {
		// 切换到听歌模式 → 订阅
		if client != nil {
			subMgr.Subscribe(roomID, client)
		}

		if isOwner {
			// 房主进入听歌模式，注册为发布者
			if client != nil {
				subMgr.SetMaster(roomID, client)
			}
			// 广播房主模式变更
			m.broadcastMasterModeChange(roomID, mode)
		} else {
			// 非房主，检查房主是否在听歌模式，如果是则请求同步
			if subMgr.IsMasterInListenMode(roomID) {
				m.requestMasterStateForUser(ctx, roomID, userID)
			}
		}
	} else {
		// 切换到聊天模式 → 取消订阅
		subMgr.Unsubscribe(roomID, userID)

		if isOwner {
			// 房主退出听歌模式，清除发布者
			subMgr.ClearMaster(roomID)
			// 广播房主模式变更
			m.broadcastMasterModeChange(roomID, mode)
		}
	}

	logger.Info("用户切换模式",
		logger.String("roomId", roomID),
		logger.Int64("userId", userID),
		logger.String("mode", mode),
		logger.Bool("isOwner", isOwner))

	return nil
}

// broadcastMasterModeChange 广播房主模式变更
func (m *RoomManager) broadcastMasterModeChange(roomID string, mode string) {
	data, _ := json.Marshal(map[string]interface{}{
		"mode": mode,
	})
	msg := &WSMessage{
		Type:   MsgTypeMasterModeChange,
		RoomID: roomID,
		Data:   data,
	}
	m.hub.BroadcastWSMessage(roomID, msg, 0, "")
}

// requestMasterStateForUser 为特定用户请求房主状态
func (m *RoomManager) requestMasterStateForUser(ctx context.Context, roomID string, userID int64) {
	room, err := m.GetRoom(ctx, roomID)
	if err != nil || room == nil {
		return
	}

	// 通知房主有用户需要同步
	msg := &WSMessage{
		Type:   MsgTypeMasterRequest,
		RoomID: roomID,
		UserID: userID,
	}
	m.hub.SendToUser(roomID, room.OwnerID, msg)

	logger.Debug("请求房主上报状态给新订阅用户",
		logger.String("roomId", roomID),
		logger.Int64("requesterId", userID),
		logger.Int64("ownerId", room.OwnerID))
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

// GetMessages 获取历史消息（带用户名）
func (m *RoomManager) GetMessages(ctx context.Context, roomID string, limit, offset int) ([]*model.RoomMessageWithUser, error) {
	return m.repo.GetMessagesWithUser(ctx, roomID, limit, offset)
}

// handleNeteaseSearch 处理 /netease 命令搜索歌曲
func (m *RoomManager) handleNeteaseSearch(ctx context.Context, roomID string, userID int64, username, keyword string) {
	logger.Info("处理 /netease 搜索命令",
		logger.String("roomId", roomID),
		logger.Int64("userId", userID),
		logger.String("keyword", keyword))

	// 搜索歌曲，限制返回 3 首
	result, err := m.neteaseClient.SearchSongs(keyword, 3, 0, nil, "")
	if err != nil {
		logger.Warn("网易云搜索失败",
			logger.String("keyword", keyword),
			logger.ErrorField(err))
		// 发送错误消息
		m.SendMessage(ctx, roomID, userID, username, "搜索失败: "+err.Error())
		return
	}

	if len(result.Songs) == 0 {
		m.SendMessage(ctx, roomID, userID, username, "没有找到相关歌曲: "+keyword)
		return
	}

	// 转换搜索结果为 SongCard 格式，并获取详细封面
	songs := make(model.SongCardList, 0, len(result.Songs))
	for _, song := range result.Songs {
		// 提取艺术家名称
		artistNames := make([]string, 0, len(song.Artists))
		for _, artist := range song.Artists {
			artistNames = append(artistNames, artist.Name)
		}

		// 默认使用搜索结果中的封面
		coverURL := song.Album.PicURL

		// 尝试通过详情接口获取更准确的封面
		songIDStr := strconv.FormatInt(song.ID, 10)
		if detail, err := m.neteaseClient.GetSongDetail(songIDStr); err == nil && detail != nil {
			if detail.Album.PicURL != "" {
				coverURL = detail.Album.PicURL
			}
		}

		songs = append(songs, model.SongCard{
			ID:       songIDStr,
			Name:     song.Name,
			Artists:  artistNames,
			Album:    song.Album.Name,
			Duration: song.Duration,
			CoverURL: coverURL,
			HLSURL:   fmt.Sprintf("/streams/netease/%d/playlist.m3u8", song.ID),
			Source:   "netease",
		})
	}

	// 发送歌曲搜索结果消息
	m.SendSongSearchMessage(ctx, roomID, userID, username, keyword, songs)
}

// SendSongSearchMessage 发送歌曲搜索结果消息
func (m *RoomManager) SendSongSearchMessage(ctx context.Context, roomID string, userID int64, username, query string, songs model.SongCardList) error {
	content := fmt.Sprintf("搜索 \"%s\" 的结果:", query)

	// 保存消息到数据库
	msg := &model.RoomMessage{
		RoomID:      roomID,
		UserID:      userID,
		Content:     content,
		MessageType: model.RoomMsgTypeSongSearch,
		Songs:       songs,
		CreatedAt:   time.Now(),
	}
	if err := m.repo.CreateMessage(ctx, msg); err != nil {
		logger.Warn("保存歌曲搜索消息失败", logger.ErrorField(err))
	}

	// 构建 WebSocket 广播数据
	searchData := &SongSearchData{
		Query: query,
		Songs: make([]SongCardData, 0, len(songs)),
	}
	for _, song := range songs {
		searchData.Songs = append(searchData.Songs, SongCardData{
			ID:       parseSongID(song.ID),
			Name:     song.Name,
			Artists:  song.Artists,
			Album:    song.Album,
			Duration: song.Duration,
			CoverURL: song.CoverURL,
			HLSURL:   song.HLSURL,
			Source:   song.Source,
		})
	}

	data, _ := json.Marshal(searchData)
	wsMsg := &WSMessage{
		Type:     MsgTypeSongSearch,
		RoomID:   roomID,
		UserID:   userID,
		Username: username,
		Data:     data,
	}
	m.hub.BroadcastWSMessage(roomID, wsMsg, 0, "")

	logger.Info("歌曲搜索结果已广播",
		logger.String("roomId", roomID),
		logger.Int64("userId", userID),
		logger.String("query", query),
		logger.Int("songsCount", len(songs)))

	return nil
}

// parseSongID 将字符串ID解析为int64
func parseSongID(id string) int64 {
	n, _ := strconv.ParseInt(id, 10, 64)
	return n
}

// GetUserRooms 获取用户参与的房间列表
func (m *RoomManager) GetUserRooms(ctx context.Context, userID int64) ([]*model.UserRoomInfo, error) {
	return m.repo.GetUserRooms(ctx, userID)
}

// IsMember 检查用户是否是房间成员
func (m *RoomManager) IsMember(ctx context.Context, roomID string, userID int64) (bool, error) {
	member, err := m.repo.GetMember(ctx, roomID, userID)
	if err != nil {
		return false, err
	}
	return member != nil, nil
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

func (m *RoomManager) broadcastRoomDisband(roomID string) {
	msg := &WSMessage{
		Type:   MsgTypeRoomDisband,
		RoomID: roomID,
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
			content := chatData.Content
			// 检测 /netease 命令
			if strings.HasPrefix(content, "/netease ") {
				keyword := strings.TrimPrefix(content, "/netease ")
				keyword = strings.TrimSpace(keyword)
				if keyword != "" {
					m.handleNeteaseSearch(ctx, client.RoomID, client.UserID, client.Username, keyword)
				}
			} else {
				// 普通聊天消息
				m.SendMessage(ctx, client.RoomID, client.UserID, client.Username, content)
			}
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

	case MsgTypeSongPlay:
		// 播放歌曲：添加到歌单并立即播放（仅房主可触发播放）
		var songData SongData
		if err := json.Unmarshal(data, &songData); err == nil {
			// 添加到歌单
			m.AddSong(ctx, client.RoomID, client.UserID, &songData)

			// 如果是房主且在听歌模式，更新当前播放为这首歌
			room, _ := m.GetRoom(ctx, client.RoomID)
			subMgr := GetSubscriptionManager()
			if room != nil && room.OwnerID == client.UserID && subMgr.IsMasterInListenMode(client.RoomID) {
				playlist, _ := m.GetPlaylist(ctx, client.RoomID)
				if len(playlist) > 0 {
					newIndex := len(playlist) - 1
					state := &model.RoomPlaybackState{
						CurrentIndex: newIndex,
						CurrentSong:  playlist[newIndex],
						Position:     0,
						IsPlaying:    true,
					}
					m.UpdatePlayback(ctx, client.RoomID, client.UserID, state)
				}
			}
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

	case MsgTypeMasterReport:
		// 房主上报播放状态，转发给房间内所有听歌模式的用户
		m.handleMasterReport(ctx, client, data)

	case MsgTypeMasterRequest:
		// 用户请求房主播放状态，转发给房主
		m.handleMasterRequest(ctx, client)

	case MsgTypeSongChange:
		// 有权限用户切歌，广播给所有 listen 模式用户
		m.handleSongChange(ctx, client, data)
	}
}

// GetHub 获取 Hub 实例
func (m *RoomManager) GetHub() *RoomHub {
	return m.hub
}

// handleMasterReport 处理房主上报的播放状态，通过订阅发布机制推送给听歌模式的用户
func (m *RoomManager) handleMasterReport(ctx context.Context, client *Client, data json.RawMessage) {
	// 验证是否是房主
	room, err := m.GetRoom(ctx, client.RoomID)
	if err != nil || room == nil {
		logger.Warn("房主上报失败：房间不存在",
			logger.String("roomId", client.RoomID))
		return
	}

	if room.OwnerID != client.UserID {
		logger.Warn("房主上报失败：非房主用户",
			logger.String("roomId", client.RoomID),
			logger.Int64("userId", client.UserID),
			logger.Int64("ownerId", room.OwnerID))
		return
	}

	// 解析上报数据
	var syncData MasterSyncData
	if err := json.Unmarshal(data, &syncData); err != nil {
		logger.Warn("解析房主同步数据失败",
			logger.ErrorField(err),
			logger.String("data", string(data)))
		return
	}

	// 补充服务器信息
	syncData.ServerTime = time.Now().UnixMilli()
	syncData.MasterID = client.UserID
	syncData.MasterName = client.Username

	// 将播放状态保存到 Redis 缓存，以便 HTTP API 可以获取
	playbackState := &model.RoomPlaybackState{
		CurrentIndex: 0,
		CurrentSong: map[string]interface{}{
			"songId":   syncData.SongID,
			"name":     syncData.SongName,
			"artist":   syncData.Artist,
			"cover":    syncData.Cover,
			"duration": syncData.Duration,
			"hlsUrl":   syncData.HlsURL,
		},
		Position:  syncData.Position,
		IsPlaying: syncData.IsPlaying,
		UpdatedAt: syncData.ServerTime,
		UpdatedBy: client.UserID,
	}

	if err := m.cache.SetPlaybackState(ctx, client.RoomID, playbackState); err != nil {
		logger.Warn("保存房主播放状态到缓存失败",
			logger.ErrorField(err),
			logger.String("roomId", client.RoomID))
	}

	// 广播给所有听歌模式的用户（无论房主是否在听歌模式）
	// 这样即使房主在聊天模式，听歌模式的用户也能同步
	m.broadcastMasterSyncToListeners(client.RoomID, &syncData, client.UserID)
}

// broadcastMasterSyncToListeners 广播房主播放状态给所有听歌模式的用户
func (m *RoomManager) broadcastMasterSyncToListeners(roomID string, syncData *MasterSyncData, excludeUserID int64) {
	// 首先尝试通过订阅管理器推送（如果房主在听歌模式）
	subMgr := GetSubscriptionManager()
	if subMgr.HasSubscribers(roomID) {
		subMgr.Publish(roomID, syncData, excludeUserID)
		return
	}

	// 如果没有订阅者，则广播给所有听歌模式的用户
	data, err := json.Marshal(syncData)
	if err != nil {
		return
	}

	msg := &WSMessage{
		Type:      MsgTypeMasterSync,
		RoomID:    roomID,
		UserID:    syncData.MasterID,
		Username:  syncData.MasterName,
		Data:      data,
		Timestamp: time.Now().UnixMilli(),
	}

	// 只发送给听歌模式的用户
	m.hub.BroadcastWSMessage(roomID, msg, excludeUserID, model.RoomModeListen)
}

// handleMasterRequest 处理用户请求房主播放状态，通知房主上报
func (m *RoomManager) handleMasterRequest(ctx context.Context, client *Client) {
	// 获取房间信息
	room, err := m.GetRoom(ctx, client.RoomID)
	if err != nil || room == nil {
		logger.Warn("请求房主状态失败：房间不存在",
			logger.String("roomId", client.RoomID))
		return
	}

	// 构建请求消息，发送给房主
	msg := &WSMessage{
		Type:      MsgTypeMasterRequest,
		RoomID:    client.RoomID,
		UserID:    client.UserID,
		Username:  client.Username,
		Timestamp: time.Now().UnixMilli(),
	}

	// 只发送给房主
	m.hub.SendToUser(client.RoomID, room.OwnerID, msg)

	logger.Debug("已转发播放状态请求给房主",
		logger.String("roomId", client.RoomID),
		logger.Int64("requesterId", client.UserID),
		logger.Int64("ownerId", room.OwnerID))
}

// handleSongChange 处理有权限用户的切歌操作，广播给所有 listen 模式用户
func (m *RoomManager) handleSongChange(ctx context.Context, client *Client, data json.RawMessage) {
	// 验证用户权限：房主或有 CanControl 权限的用户
	member, err := m.cache.GetMemberOnline(ctx, client.RoomID, client.UserID)
	if err != nil || member == nil {
		logger.Warn("切歌失败：用户不在房间中",
			logger.String("roomId", client.RoomID),
			logger.Int64("userId", client.UserID))
		return
	}

	// 获取房间信息判断是否是房主
	room, err := m.GetRoom(ctx, client.RoomID)
	if err != nil || room == nil {
		logger.Warn("切歌失败：房间不存在",
			logger.String("roomId", client.RoomID))
		return
	}

	isOwner := room.OwnerID == client.UserID
	if !isOwner && !member.CanControl {
		logger.Warn("切歌失败：无权限",
			logger.String("roomId", client.RoomID),
			logger.Int64("userId", client.UserID),
			logger.Bool("isOwner", isOwner),
			logger.Bool("canControl", member.CanControl))
		return
	}

	// 解析切歌数据
	var songData SongChangeData
	if err := json.Unmarshal(data, &songData); err != nil {
		logger.Warn("解析切歌数据失败",
			logger.ErrorField(err),
			logger.String("data", string(data)))
		return
	}

	// 补充切歌用户信息和时间戳
	songData.ChangedBy = client.UserID
	songData.ChangedByName = client.Username
	songData.Timestamp = time.Now().UnixMilli()

	// 先写入缓存（先写后删策略）
	playbackState := &model.RoomPlaybackState{
		CurrentIndex: 0,
		CurrentSong: map[string]interface{}{
			"songId":   songData.SongID,
			"name":     songData.SongName,
			"artist":   songData.Artist,
			"cover":    songData.Cover,
			"duration": songData.Duration,
			"hlsUrl":   songData.HlsURL,
		},
		Position:  songData.Position,
		IsPlaying: songData.IsPlaying,
		UpdatedAt: songData.Timestamp,
		UpdatedBy: client.UserID,
	}

	if err := m.cache.SetPlaybackState(ctx, client.RoomID, playbackState); err != nil {
		logger.Warn("保存切歌状态到缓存失败",
			logger.ErrorField(err),
			logger.String("roomId", client.RoomID))
	}

	// 广播切歌消息给所有 listen 模式用户
	m.broadcastSongChange(client.RoomID, &songData)

	logger.Info("用户切歌成功",
		logger.String("roomId", client.RoomID),
		logger.Int64("userId", client.UserID),
		logger.String("songId", songData.SongID),
		logger.String("songName", songData.SongName))
}

// broadcastSongChange 广播切歌消息给所有 listen 模式用户
func (m *RoomManager) broadcastSongChange(roomID string, songData *SongChangeData) {
	data, err := json.Marshal(songData)
	if err != nil {
		logger.Warn("序列化切歌数据失败", logger.ErrorField(err))
		return
	}

	msg := &WSMessage{
		Type:      MsgTypeSongChange,
		RoomID:    roomID,
		UserID:    songData.ChangedBy,
		Username:  songData.ChangedByName,
		Data:      data,
		Timestamp: songData.Timestamp,
	}

	// 广播给所有 listen 模式用户（包括切歌用户自己，因为要确认同步）
	m.hub.BroadcastWSMessage(roomID, msg, 0, model.RoomModeListen)
}
