package cache

import (
	"context"
	"time"

	"Bt1QFM/logger"

	"github.com/go-redis/redis/v8"
)

// SetSegmentCache 设置分片缓存
func SetSegmentCache(key string, data []byte, expiration time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := RedisClient.Set(ctx, key, data, expiration).Err()
	if err != nil {
		logger.Error("设置分片缓存失败",
			logger.String("key", key),
			logger.Int("dataSize", len(data)),
			logger.ErrorField(err))
		return err
	}

	logger.Debug("分片缓存设置成功",
		logger.String("key", key),
		logger.Int("dataSize", len(data)),
		logger.Duration("expiration", expiration))

	return nil
}

// GetSegmentCache 获取分片缓存
func GetSegmentCache(key string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 最多重试2次
	maxRetries := 2
	retryDelay := 100 * time.Millisecond

	for attempt := 0; attempt < maxRetries; attempt++ {
		data, err := RedisClient.Get(ctx, key).Bytes()
		if err != nil {
			// 如果是 redis nil 错误（键不存在），返回nil但不返回错误，让调用方继续查找MinIO
			if err.Error() == "redis: nil" {
				logger.Debug("分片缓存不存在",
					logger.String("key", key))
				return nil, nil // 返回nil, nil表示缓存未命中但无错误
			}

			// 如果是其他错误且不是最后一次尝试，继续重试
			if attempt < maxRetries-1 {
				logger.Warn("获取分片缓存失败，准备重试",
					logger.String("key", key),
					logger.Int("attempt", attempt+1),
					logger.Int("maxRetries", maxRetries),
					logger.ErrorField(err))

				time.Sleep(retryDelay)
				retryDelay *= 2 // 指数退避
				continue
			}

			// 最后一次尝试仍然失败，返回nil但不返回错误，让调用方继续查找MinIO
			logger.Error("获取分片缓存最终失败，将尝试从MinIO获取",
				logger.String("key", key),
				logger.Int("totalAttempts", maxRetries),
				logger.ErrorField(err))
			return nil, nil // 返回nil, nil让调用方继续查找
		}

		// 成功获取
		logger.Debug("分片缓存获取成功",
			logger.String("key", key),
			logger.Int("dataSize", len(data)),
			logger.Int("attempt", attempt+1))

		return data, nil
	}

	return nil, nil
}

// DeleteSegmentCache 删除分片缓存
func DeleteSegmentCache(key string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := RedisClient.Del(ctx, key).Err()
	if err != nil {
		logger.Error("删除分片缓存失败",
			logger.String("key", key),
			logger.ErrorField(err))
		return err
	}

	logger.Debug("分片缓存删除成功", logger.String("key", key))
	return nil
}

// DeleteSegmentPattern 批量删除匹配模式的分片缓存
func DeleteSegmentPattern(pattern string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	keys, err := RedisClient.Keys(ctx, pattern).Result()
	if err != nil {
		logger.Error("查找缓存键失败",
			logger.String("pattern", pattern),
			logger.ErrorField(err))
		return err
	}

	if len(keys) == 0 {
		return nil
	}

	err = RedisClient.Del(ctx, keys...).Err()
	if err != nil {
		logger.Error("批量删除分片缓存失败",
			logger.String("pattern", pattern),
			logger.Int("keysCount", len(keys)),
			logger.ErrorField(err))
		return err
	}

	logger.Info("批量删除分片缓存成功",
		logger.String("pattern", pattern),
		logger.Int("deletedCount", len(keys)))

	return nil
}

// SetSegmentCacheBatch 批量写入分片缓存（使用 Pipeline 优化）
// 相比串行写入，网络往返从 N 次减少到 1 次，性能提升约 10x
func SetSegmentCacheBatch(segments map[string][]byte, expiration time.Duration) error {
	if RedisClient == nil {
		return nil // Redis 未初始化时静默跳过
	}

	if len(segments) == 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pipe := RedisClient.Pipeline()

	for key, data := range segments {
		pipe.Set(ctx, key, data, expiration)
	}

	results, err := pipe.Exec(ctx)
	if err != nil {
		logger.Error("批量写入分片缓存失败",
			logger.Int("segmentCount", len(segments)),
			logger.ErrorField(err))
		return err
	}

	// 统计成功/失败数量
	successCount := 0
	for _, result := range results {
		if result.Err() == nil {
			successCount++
		}
	}

	logger.Info("批量写入分片缓存完成",
		logger.Int("totalCount", len(segments)),
		logger.Int("successCount", successCount),
		logger.Duration("expiration", expiration))

	return nil
}

// GetSegmentCacheBatch 批量读取分片缓存（使用 Pipeline 优化）
func GetSegmentCacheBatch(keys []string) (map[string][]byte, error) {
	if RedisClient == nil || len(keys) == 0 {
		return nil, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pipe := RedisClient.Pipeline()
	cmds := make(map[string]*redis.StringCmd, len(keys))

	for _, key := range keys {
		cmds[key] = pipe.Get(ctx, key)
	}

	_, err := pipe.Exec(ctx)
	if err != nil && err != redis.Nil {
		logger.Warn("批量读取分片缓存部分失败", logger.ErrorField(err))
	}

	result := make(map[string][]byte)
	for key, cmd := range cmds {
		data, err := cmd.Bytes()
		if err == nil {
			result[key] = data
		}
	}

	logger.Debug("批量读取分片缓存完成",
		logger.Int("requestCount", len(keys)),
		logger.Int("hitCount", len(result)))

	return result, nil
}

// GetSegmentCacheInfo 获取分片缓存信息
func GetSegmentCacheInfo(streamID string) (map[string]int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pattern := "segment:" + streamID + ":*"
	keys, err := RedisClient.Keys(ctx, pattern).Result()
	if err != nil {
		return nil, err
	}

	info := make(map[string]int64)
	for _, key := range keys {
		ttl, err := RedisClient.TTL(ctx, key).Result()
		if err != nil {
			continue
		}
		info[key] = int64(ttl.Seconds())
	}

	return info, nil
}
