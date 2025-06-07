package cache

import (
    "context"
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