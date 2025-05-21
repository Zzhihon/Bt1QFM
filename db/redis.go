package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"Bt1QFM/config"

	"github.com/go-redis/redis/v8"
)

// RedisClient 是全局Redis客户端
var RedisClient *redis.Client

// ConnectRedis 初始化Redis连接
func ConnectRedis(cfg *config.Config) error {
	RedisClient = redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%s", cfg.RedisHost, cfg.RedisPort),
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})

	// 测试连接
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := RedisClient.Ping(ctx).Result()
	if err != nil {
		return fmt.Errorf("failed to connect to Redis: %w", err)
	}

	return nil
}

// CloseRedis 关闭Redis连接
func CloseRedis() error {
	if RedisClient != nil {
		return RedisClient.Close()
	}
	return nil
}

// TestRedis 测试Redis连接和基本操作
func TestRedis() error {
	if RedisClient == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	ctx := context.Background()

	// 测试设置值
	err := RedisClient.Set(ctx, "test_key", "Redis connection successful!", 5*time.Minute).Err()
	if err != nil {
		return fmt.Errorf("failed to set Redis key: %w", err)
	}

	// 测试获取值
	val, err := RedisClient.Get(ctx, "test_key").Result()
	if err != nil {
		return fmt.Errorf("failed to get Redis key: %w", err)
	}

	// 检查值是否符合预期
	if val != "Redis connection successful!" {
		return fmt.Errorf("unexpected value from Redis: got %s", val)
	}

	// 测试删除值
	_, err = RedisClient.Del(ctx, "test_key").Result()
	if err != nil {
		return fmt.Errorf("failed to delete Redis key: %w", err)
	}

	return nil
}

// PlaylistItem 表示播放列表中的一个项目
type PlaylistItem struct {
	TrackID  int64  `json:"trackId"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	Album    string `json:"album"`
	Position int    `json:"position"` // 在播放列表中的位置
}

// GetPlaylistKey 根据用户ID生成播放列表的Redis键
func GetPlaylistKey(userID int64) string {
	return fmt.Sprintf("playlist:%d", userID)
}

// AddTrackToPlaylist 将歌曲添加到用户的播放列表中
func AddTrackToPlaylist(ctx context.Context, userID int64, item PlaylistItem) error {
	if RedisClient == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	playlistKey := GetPlaylistKey(userID)

	// 获取当前播放列表以确定新项目的位置
	items, err := GetPlaylist(ctx, userID)
	if err != nil && err != redis.Nil {
		return fmt.Errorf("failed to get current playlist: %w", err)
	}

	// 如果播放列表为空或发生错误，则重置位置为0
	if len(items) == 0 || err == redis.Nil {
		item.Position = 0
	} else {
		// 找到最大位置值并加1
		maxPos := 0
		for _, existingItem := range items {
			if existingItem.Position > maxPos {
				maxPos = existingItem.Position
			}
		}
		item.Position = maxPos + 1
	}

	// 将项目转换为JSON
	itemJSON, err := json.Marshal(item)
	if err != nil {
		return fmt.Errorf("failed to marshal playlist item: %w", err)
	}

	// 使用有序集合来存储播放列表项目，分数为项目位置
	err = RedisClient.ZAdd(ctx, playlistKey, &redis.Z{
		Score:  float64(item.Position),
		Member: itemJSON,
	}).Err()

	if err != nil {
		return fmt.Errorf("failed to add track to playlist: %w", err)
	}

	// 设置播放列表的过期时间，例如24小时
	err = RedisClient.Expire(ctx, playlistKey, 24*time.Hour).Err()
	if err != nil {
		return fmt.Errorf("failed to set playlist expiration: %w", err)
	}

	return nil
}

// RemoveTrackFromPlaylist 从用户的播放列表中删除指定的歌曲
func RemoveTrackFromPlaylist(ctx context.Context, userID int64, trackID int64) error {
	if RedisClient == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	playlistKey := GetPlaylistKey(userID)

	// 获取当前播放列表
	items, err := GetPlaylist(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to get playlist: %w", err)
	}

	// 找到要删除的项目
	for i, item := range items {
		if item.TrackID == trackID {
			// 将项目转换为JSON
			itemJSON, err := json.Marshal(item)
			if err != nil {
				return fmt.Errorf("failed to marshal playlist item: %w", err)
			}

			// 从有序集合中删除项目
			err = RedisClient.ZRem(ctx, playlistKey, itemJSON).Err()
			if err != nil {
				return fmt.Errorf("failed to remove track from playlist: %w", err)
			}

			// 如果存在后续项目，需要重新排序
			if i < len(items)-1 {
				err = reorderPlaylist(ctx, userID)
				if err != nil {
					return fmt.Errorf("failed to reorder playlist: %w", err)
				}
			}

			return nil
		}
	}

	return fmt.Errorf("track not found in playlist")
}

// GetPlaylist 获取用户的整个播放列表
func GetPlaylist(ctx context.Context, userID int64) ([]PlaylistItem, error) {
	if RedisClient == nil {
		return nil, fmt.Errorf("Redis client not initialized")
	}

	playlistKey := GetPlaylistKey(userID)

	// 从有序集合中获取所有项目，按分数升序（即播放顺序）
	result, err := RedisClient.ZRangeByScore(ctx, playlistKey, &redis.ZRangeBy{
		Min: "-inf",
		Max: "+inf",
	}).Result()

	if err != nil {
		if err == redis.Nil {
			return []PlaylistItem{}, nil
		}
		return nil, fmt.Errorf("failed to get playlist: %w", err)
	}

	var playlist []PlaylistItem
	for _, itemJSON := range result {
		var item PlaylistItem
		if err := json.Unmarshal([]byte(itemJSON), &item); err != nil {
			return nil, fmt.Errorf("failed to unmarshal playlist item: %w", err)
		}
		playlist = append(playlist, item)
	}

	return playlist, nil
}

// ClearPlaylist 清空用户的播放列表
func ClearPlaylist(ctx context.Context, userID int64) error {
	if RedisClient == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	playlistKey := GetPlaylistKey(userID)
	err := RedisClient.Del(ctx, playlistKey).Err()
	if err != nil {
		return fmt.Errorf("failed to clear playlist: %w", err)
	}

	return nil
}

// UpdatePlaylistOrder 更新播放列表中的歌曲顺序
func UpdatePlaylistOrder(ctx context.Context, userID int64, trackIDs []int64) error {
	if RedisClient == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	// 获取当前播放列表
	items, err := GetPlaylist(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to get playlist: %w", err)
	}

	// 创建trackID到播放列表项的映射
	itemMap := make(map[int64]PlaylistItem)
	for _, item := range items {
		itemMap[item.TrackID] = item
	}

	// 清空当前播放列表
	err = ClearPlaylist(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to clear playlist before reordering: %w", err)
	}

	// 按照新的顺序重新添加项目
	playlistKey := GetPlaylistKey(userID)
	for i, trackID := range trackIDs {
		if item, exists := itemMap[trackID]; exists {
			item.Position = i
			itemJSON, err := json.Marshal(item)
			if err != nil {
				return fmt.Errorf("failed to marshal playlist item: %w", err)
			}

			err = RedisClient.ZAdd(ctx, playlistKey, &redis.Z{
				Score:  float64(i),
				Member: itemJSON,
			}).Err()

			if err != nil {
				return fmt.Errorf("failed to add track to reordered playlist: %w", err)
			}
		}
	}

	// 设置播放列表的过期时间
	err = RedisClient.Expire(ctx, playlistKey, 24*time.Hour).Err()
	if err != nil {
		return fmt.Errorf("failed to set playlist expiration: %w", err)
	}

	return nil
}

// ShufflePlaylist 随机打乱用户的播放列表顺序
func ShufflePlaylist(ctx context.Context, userID int64) error {
	if RedisClient == nil {
		return fmt.Errorf("Redis client not initialized")
	}

	// 获取当前播放列表
	items, err := GetPlaylist(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to get playlist: %w", err)
	}

	if len(items) <= 1 {
		return nil // 如果列表为空或只有一项，无需打乱
	}

	// 创建一个随机顺序的trackID列表
	trackIDs := make([]int64, len(items))
	for i, item := range items {
		trackIDs[i] = item.TrackID
	}

	// Fisher-Yates 洗牌算法
	for i := len(trackIDs) - 1; i > 0; i-- {
		j := int64(time.Now().UnixNano()) % int64(i+1)
		trackIDs[i], trackIDs[j] = trackIDs[j], trackIDs[i]
	}

	// 更新播放列表顺序
	return UpdatePlaylistOrder(ctx, userID, trackIDs)
}

// 重新排序播放列表
func reorderPlaylist(ctx context.Context, userID int64) error {
	items, err := GetPlaylist(ctx, userID)
	if err != nil {
		return err
	}

	// 清空当前播放列表
	playlistKey := GetPlaylistKey(userID)
	err = RedisClient.Del(ctx, playlistKey).Err()
	if err != nil {
		return err
	}

	// 重新设置每个项目的位置并添加回播放列表
	for i, item := range items {
		item.Position = i
		itemJSON, err := json.Marshal(item)
		if err != nil {
			return err
		}

		err = RedisClient.ZAdd(ctx, playlistKey, &redis.Z{
			Score:  float64(i),
			Member: itemJSON,
		}).Err()

		if err != nil {
			return err
		}
	}

	return nil
}
