package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"Bt1QFM/model"

	"github.com/go-redis/redis/v8"
)

const (
	roomMembersKey  = "room:%s:members"  // Hash: userID -> MemberOnline JSON
	roomPlaylistKey = "room:%s:playlist" // Sorted Set (复用 PlaylistItem)
	roomPlaybackKey = "room:%s:playback" // Hash: 播放状态
	roomTTL         = 24 * time.Hour
)

// RoomCache 房间缓存操作
type RoomCache struct {
	client *redis.Client
}

// NewRoomCache 创建房间缓存
func NewRoomCache() *RoomCache {
	return &RoomCache{client: RedisClient}
}

// ========== 成员管理 ==========

// SetMemberOnline 设置成员在线状态
func (c *RoomCache) SetMemberOnline(ctx context.Context, roomID string, member *model.RoomMemberOnline) error {
	if c.client == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	key := fmt.Sprintf(roomMembersKey, roomID)
	data, err := json.Marshal(member)
	if err != nil {
		return fmt.Errorf("failed to marshal member: %w", err)
	}

	pipe := c.client.Pipeline()
	pipe.HSet(ctx, key, fmt.Sprintf("%d", member.UserID), data)
	pipe.Expire(ctx, key, roomTTL)
	_, err = pipe.Exec(ctx)
	return err
}

// RemoveMemberOnline 移除成员在线状态
func (c *RoomCache) RemoveMemberOnline(ctx context.Context, roomID string, userID int64) error {
	if c.client == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	key := fmt.Sprintf(roomMembersKey, roomID)
	return c.client.HDel(ctx, key, fmt.Sprintf("%d", userID)).Err()
}

// GetMemberOnline 获取单个在线成员信息
func (c *RoomCache) GetMemberOnline(ctx context.Context, roomID string, userID int64) (*model.RoomMemberOnline, error) {
	if c.client == nil {
		return nil, fmt.Errorf("Redis client not initialized")
	}

	key := fmt.Sprintf(roomMembersKey, roomID)
	data, err := c.client.HGet(ctx, key, fmt.Sprintf("%d", userID)).Result()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, err
	}

	var member model.RoomMemberOnline
	if err := json.Unmarshal([]byte(data), &member); err != nil {
		return nil, err
	}
	return &member, nil
}

// GetMembersOnline 获取所有在线成员
func (c *RoomCache) GetMembersOnline(ctx context.Context, roomID string) ([]model.RoomMemberOnline, error) {
	if c.client == nil {
		return nil, fmt.Errorf("Redis client not initialized")
	}

	key := fmt.Sprintf(roomMembersKey, roomID)
	result, err := c.client.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, err
	}

	members := make([]model.RoomMemberOnline, 0, len(result))
	for _, data := range result {
		var member model.RoomMemberOnline
		if err := json.Unmarshal([]byte(data), &member); err == nil {
			members = append(members, member)
		}
	}
	return members, nil
}

// GetOnlineMemberCount 获取在线人数
func (c *RoomCache) GetOnlineMemberCount(ctx context.Context, roomID string) (int64, error) {
	if c.client == nil {
		return 0, fmt.Errorf("Redis client not initialized")
	}

	key := fmt.Sprintf(roomMembersKey, roomID)
	return c.client.HLen(ctx, key).Result()
}

// UpdateMemberMode 更新成员模式
func (c *RoomCache) UpdateMemberMode(ctx context.Context, roomID string, userID int64, mode string) error {
	member, err := c.GetMemberOnline(ctx, roomID, userID)
	if err != nil {
		return err
	}
	if member == nil {
		return fmt.Errorf("member not found in room")
	}

	member.Mode = mode
	return c.SetMemberOnline(ctx, roomID, member)
}

// UpdateMemberControl 更新成员控制权限
func (c *RoomCache) UpdateMemberControl(ctx context.Context, roomID string, userID int64, canControl bool) error {
	member, err := c.GetMemberOnline(ctx, roomID, userID)
	if err != nil {
		return err
	}
	if member == nil {
		return fmt.Errorf("member not found in room")
	}

	member.CanControl = canControl
	return c.SetMemberOnline(ctx, roomID, member)
}

// UpdateMemberRole 更新成员角色
func (c *RoomCache) UpdateMemberRole(ctx context.Context, roomID string, userID int64, role string) error {
	member, err := c.GetMemberOnline(ctx, roomID, userID)
	if err != nil {
		return err
	}
	if member == nil {
		return fmt.Errorf("member not found in room")
	}

	member.Role = role
	return c.SetMemberOnline(ctx, roomID, member)
}

// ========== 播放状态 ==========

// SetPlaybackState 设置播放状态
func (c *RoomCache) SetPlaybackState(ctx context.Context, roomID string, state *model.RoomPlaybackState) error {
	if c.client == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	key := fmt.Sprintf(roomPlaybackKey, roomID)

	songJSON := ""
	if state.CurrentSong != nil {
		data, _ := json.Marshal(state.CurrentSong)
		songJSON = string(data)
	}

	pipe := c.client.Pipeline()
	pipe.HSet(ctx, key, map[string]interface{}{
		"current_index": state.CurrentIndex,
		"current_song":  songJSON,
		"position":      state.Position,
		"is_playing":    state.IsPlaying,
		"updated_at":    state.UpdatedAt,
		"updated_by":    state.UpdatedBy,
	})
	pipe.Expire(ctx, key, roomTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// GetPlaybackState 获取播放状态
func (c *RoomCache) GetPlaybackState(ctx context.Context, roomID string) (*model.RoomPlaybackState, error) {
	if c.client == nil {
		return nil, fmt.Errorf("Redis client not initialized")
	}

	key := fmt.Sprintf(roomPlaybackKey, roomID)
	result, err := c.client.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, err
	}
	if len(result) == 0 {
		return nil, nil
	}

	state := &model.RoomPlaybackState{}

	if v, ok := result["current_index"]; ok {
		state.CurrentIndex, _ = strconv.Atoi(v)
	}
	if v, ok := result["current_song"]; ok && v != "" {
		var song interface{}
		if err := json.Unmarshal([]byte(v), &song); err == nil {
			state.CurrentSong = song
		}
	}
	if v, ok := result["position"]; ok {
		state.Position, _ = strconv.ParseFloat(v, 64)
	}
	if v, ok := result["is_playing"]; ok {
		state.IsPlaying = v == "1" || v == "true"
	}
	if v, ok := result["updated_at"]; ok {
		state.UpdatedAt, _ = strconv.ParseInt(v, 10, 64)
	}
	if v, ok := result["updated_by"]; ok {
		state.UpdatedBy, _ = strconv.ParseInt(v, 10, 64)
	}

	return state, nil
}

// UpdatePlaybackPosition 更新播放位置
func (c *RoomCache) UpdatePlaybackPosition(ctx context.Context, roomID string, position float64, updatedBy int64) error {
	if c.client == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	key := fmt.Sprintf(roomPlaybackKey, roomID)
	return c.client.HSet(ctx, key, map[string]interface{}{
		"position":   position,
		"updated_at": time.Now().UnixMilli(),
		"updated_by": updatedBy,
	}).Err()
}

// UpdatePlaybackPlaying 更新播放/暂停状态
func (c *RoomCache) UpdatePlaybackPlaying(ctx context.Context, roomID string, isPlaying bool, position float64, updatedBy int64) error {
	if c.client == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	key := fmt.Sprintf(roomPlaybackKey, roomID)
	return c.client.HSet(ctx, key, map[string]interface{}{
		"is_playing": isPlaying,
		"position":   position,
		"updated_at": time.Now().UnixMilli(),
		"updated_by": updatedBy,
	}).Err()
}

// ========== 共享歌单 (复用 PlaylistItem 结构) ==========

// GetRoomPlaylistKey 获取房间歌单 Redis key
func GetRoomPlaylistKey(roomID string) string {
	return fmt.Sprintf(roomPlaylistKey, roomID)
}

// AddToRoomPlaylist 添加歌曲到房间歌单
func (c *RoomCache) AddToRoomPlaylist(ctx context.Context, roomID string, item *PlaylistItem) error {
	if c.client == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	key := GetRoomPlaylistKey(roomID)

	// 获取当前歌单长度作为 position
	count, _ := c.client.ZCard(ctx, key).Result()
	item.Position = int(count)

	data, err := json.Marshal(item)
	if err != nil {
		return fmt.Errorf("failed to marshal playlist item: %w", err)
	}

	pipe := c.client.Pipeline()
	pipe.ZAdd(ctx, key, &redis.Z{
		Score:  float64(item.Position),
		Member: data,
	})
	pipe.Expire(ctx, key, roomTTL)
	_, err = pipe.Exec(ctx)
	return err
}

// GetRoomPlaylist 获取房间歌单
func (c *RoomCache) GetRoomPlaylist(ctx context.Context, roomID string) ([]PlaylistItem, error) {
	if c.client == nil {
		return nil, fmt.Errorf("Redis client not initialized")
	}

	key := GetRoomPlaylistKey(roomID)
	result, err := c.client.ZRangeByScore(ctx, key, &redis.ZRangeBy{
		Min: "-inf",
		Max: "+inf",
	}).Result()
	if err != nil {
		return nil, err
	}

	items := make([]PlaylistItem, 0, len(result))
	for _, data := range result {
		var item PlaylistItem
		if err := json.Unmarshal([]byte(data), &item); err == nil {
			items = append(items, item)
		}
	}
	return items, nil
}

// RemoveFromRoomPlaylist 从房间歌单移除歌曲
func (c *RoomCache) RemoveFromRoomPlaylist(ctx context.Context, roomID string, position int) error {
	if c.client == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	key := GetRoomPlaylistKey(roomID)

	// 获取指定位置的歌曲
	result, err := c.client.ZRangeByScore(ctx, key, &redis.ZRangeBy{
		Min: fmt.Sprintf("%d", position),
		Max: fmt.Sprintf("%d", position),
	}).Result()
	if err != nil {
		return err
	}
	if len(result) == 0 {
		return fmt.Errorf("item not found at position %d", position)
	}

	// 移除
	return c.client.ZRem(ctx, key, result[0]).Err()
}

// ClearRoomPlaylist 清空房间歌单
func (c *RoomCache) ClearRoomPlaylist(ctx context.Context, roomID string) error {
	if c.client == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	key := GetRoomPlaylistKey(roomID)
	return c.client.Del(ctx, key).Err()
}

// ========== 清理 ==========

// ClearRoom 清理房间所有缓存
func (c *RoomCache) ClearRoom(ctx context.Context, roomID string) error {
	if c.client == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	keys := []string{
		fmt.Sprintf(roomMembersKey, roomID),
		fmt.Sprintf(roomPlaylistKey, roomID),
		fmt.Sprintf(roomPlaybackKey, roomID),
	}
	return c.client.Del(ctx, keys...).Err()
}

// RefreshRoomTTL 刷新房间缓存过期时间
func (c *RoomCache) RefreshRoomTTL(ctx context.Context, roomID string) error {
	if c.client == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	keys := []string{
		fmt.Sprintf(roomMembersKey, roomID),
		fmt.Sprintf(roomPlaylistKey, roomID),
		fmt.Sprintf(roomPlaybackKey, roomID),
	}

	pipe := c.client.Pipeline()
	for _, key := range keys {
		pipe.Expire(ctx, key, roomTTL)
	}
	_, err := pipe.Exec(ctx)
	return err
}
