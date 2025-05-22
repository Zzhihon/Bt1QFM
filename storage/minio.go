package storage

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"time"

	"Bt1QFM/config"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var (
	minioClient *minio.Client
)

// InitMinio 初始化 MinIO 客户端
func InitMinio() error {
	cfg := config.Load()

	log.Printf("正在连接 MinIO 服务器...")
	log.Printf("Endpoint: %s...", cfg.MinioEndpoint[:4])
	log.Printf("Region: %s...", cfg.MinioRegion[:4])
	log.Printf("Bucket: %s", cfg.MinioBucket)
	if len(cfg.MinioAccessKey) > 4 {
		log.Printf("AccessKey: %s...", cfg.MinioAccessKey[:4])
	}
	if len(cfg.MinioSecretKey) > 4 {
		log.Printf("SecretKey: %s...", cfg.MinioSecretKey[:4])
	}

	// 初始化 MinIO 客户端
	client, err := minio.New(cfg.MinioEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinioAccessKey, cfg.MinioSecretKey, ""),
		Secure: cfg.MinioUseSSL,
		Region: cfg.MinioRegion,
	})
	if err != nil {
		return fmt.Errorf("创建 MinIO 客户端失败: %v", err)
	}

	// 测试连接
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 检查存储桶是否存在
	exists, err := client.BucketExists(ctx, cfg.MinioBucket)
	if err != nil {
		return fmt.Errorf("检查存储桶失败: %v", err)
	}

	if !exists {
		// 如果存储桶不存在，尝试创建它
		err = client.MakeBucket(ctx, cfg.MinioBucket, minio.MakeBucketOptions{
			Region: cfg.MinioRegion,
		})
		if err != nil {
			return fmt.Errorf("创建存储桶失败: %v", err)
		}
		log.Printf("✅ 成功创建存储桶: %s", cfg.MinioBucket)
	} else {
		log.Printf("✅ 存储桶已存在: %s", cfg.MinioBucket)
	}

	// 测试上传权限
	testObjectName := fmt.Sprintf("test-%d.txt", time.Now().Unix())
	testContent := []byte("Hello, MinIO! This is a test file.")

	// 尝试使用不同的上传选项
	opts := minio.PutObjectOptions{
		ContentType: "text/plain",
		UserMetadata: map[string]string{
			"x-amz-meta-test": "test-value",
		},
		DisableMultipart: true,
	}

	_, err = client.PutObject(ctx, cfg.MinioBucket, testObjectName, bytes.NewReader(testContent), int64(len(testContent)), opts)
	if err != nil {
		return fmt.Errorf("上传测试文件失败: %v", err)
	}
	log.Println("✅ 成功上传测试文件")

	// 测试读取权限
	object, err := client.GetObject(ctx, cfg.MinioBucket, testObjectName, minio.GetObjectOptions{})
	if err != nil {
		return fmt.Errorf("读取测试文件失败: %v", err)
	}
	defer object.Close()
	log.Println("✅ 成功读取测试文件")

	// 测试删除权限
	err = client.RemoveObject(ctx, cfg.MinioBucket, testObjectName, minio.RemoveObjectOptions{})
	if err != nil {
		return fmt.Errorf("删除测试文件失败: %v", err)
	}
	log.Println("✅ 成功删除测试文件")

	log.Println("🎉 所有测试完成！")

	// 保存客户端实例
	minioClient = client
	log.Println("✅ MinIO 客户端初始化成功！")
	return nil
}

// GetMinioClient 获取 MinIO 客户端实例
func GetMinioClient() *minio.Client {
	return minioClient
}
