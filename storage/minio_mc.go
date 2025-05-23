package storage

import (
	"Bt1QFM/config"
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// BucketStats 存储桶统计信息
type BucketStats struct {
	TotalObjects int64
	TotalSize    int64
	LastModified time.Time
}

// ObjectInfo 文件信息
type ObjectInfo struct {
	Key          string
	Size         int64
	LastModified time.Time
	ContentType  string
	ETag         string
}

// MinioClient 封装了 MinIO 客户端
type MinioClient struct {
	client     *minio.Client
	bucketName string
}

// NewMinioClient 创建一个新的 MinIO 客户端
func NewMinioClient(endpoint, accessKey, secretKey, bucketName string, useSSL bool) (*MinioClient, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("创建 MinIO 客户端失败: %v", err)
	}

	return &MinioClient{
		client:     client,
		bucketName: bucketName,
	}, nil
}

// ListObjects 列出存储桶中的所有对象
func (m *MinioClient) ListObjects() error {
	ctx := context.Background()

	// 检查存储桶是否存在
	exists, err := m.client.BucketExists(ctx, m.bucketName)
	if err != nil {
		return fmt.Errorf("检查存储桶是否存在失败: %v", err)
	}
	if !exists {
		return fmt.Errorf("存储桶 %s 不存在", m.bucketName)
	}

	// 获取存储桶统计信息
	var totalSize int64
	var objectCount int64
	var lastModified time.Time

	// 列出所有对象
	objectCh := m.client.ListObjects(ctx, m.bucketName, minio.ListObjectsOptions{})
	for object := range objectCh {
		if object.Err != nil {
			log.Printf("列出对象时出错: %v", object.Err)
			continue
		}
		totalSize += object.Size
		objectCount++
		if object.LastModified.After(lastModified) {
			lastModified = object.LastModified
		}
	}

	fmt.Printf("存储桶信息:\n")
	fmt.Printf("名称: %s\n", m.bucketName)
	fmt.Printf("总大小: %.2f MB\n", float64(totalSize)/1024/1024)
	fmt.Printf("对象数量: %d\n", objectCount)
	fmt.Printf("最后修改时间: %s\n", lastModified.Format(time.RFC3339))
	fmt.Println("\n文件列表:")

	// 重新列出所有对象以显示详细信息
	objectCh = m.client.ListObjects(ctx, m.bucketName, minio.ListObjectsOptions{})
	for object := range objectCh {
		if object.Err != nil {
			log.Printf("列出对象时出错: %v", object.Err)
			continue
		}
		fmt.Printf("文件名: %s, 大小: %.2f MB, 最后修改时间: %s\n",
			object.Key,
			float64(object.Size)/1024/1024,
			object.LastModified.Format(time.RFC3339))
	}

	return nil
}

// ListBucketObjects 列出存储桶中的所有对象
func ListBucketObjects(prefix string, recursive bool) ([]ObjectInfo, *BucketStats, error) {
	minioClient := GetMinioClient()
	if minioClient == nil {
		return nil, nil, fmt.Errorf("MinIO 客户端未初始化")
	}

	ctx := context.Background()
	cfg := config.Load()

	// 初始化统计信息
	stats := &BucketStats{}
	var objects []ObjectInfo

	// 创建对象列表通道
	objectCh := minioClient.ListObjects(ctx, cfg.MinioBucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: recursive,
	})

	// 遍历所有对象
	for object := range objectCh {
		if object.Err != nil {
			return nil, nil, fmt.Errorf("列出对象时出错: %v", object.Err)
		}

		// 更新统计信息
		stats.TotalObjects++
		stats.TotalSize += object.Size
		if object.LastModified.After(stats.LastModified) {
			stats.LastModified = object.LastModified
		}

		// 添加到对象列表
		objects = append(objects, ObjectInfo{
			Key:          object.Key,
			Size:         object.Size,
			LastModified: object.LastModified,
			ContentType:  object.ContentType,
			ETag:         object.ETag,
		})
	}

	return objects, stats, nil
}

// PrintBucketStatus 打印存储桶状态
func PrintBucketStatus(prefix string) error {
	objects, stats, err := ListBucketObjects(prefix, true)
	if err != nil {
		return err
	}

	cfg := config.Load()
	log.Printf("\n📊 存储桶状态报告: %s", cfg.MinioBucket)
	log.Printf("🔍 前缀过滤: %s", prefix)
	log.Printf("📝 总文件数: %d", stats.TotalObjects)
	log.Printf("💾 总存储大小: %s", formatSize(stats.TotalSize))
	log.Printf("🕒 最后更新时间: %s", stats.LastModified.Format("2006-01-02 15:04:05"))
	log.Printf("\n📋 文件列表:")

	// 打印文件列表
	for _, obj := range objects {
		log.Printf("  ├─ %s", obj.Key)
		log.Printf("  │  ├─ 大小: %s", formatSize(obj.Size))
		log.Printf("  │  ├─ 类型: %s", obj.ContentType)
		log.Printf("  │  └─ 修改时间: %s", obj.LastModified.Format("2006-01-02 15:04:05"))
	}

	return nil
}

// formatSize 格式化文件大小
func formatSize(size int64) string {
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}
	div, exp := int64(unit), 0
	for n := size / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(size)/float64(div), "KMGTPE"[exp])
}

// GetBucketUsage 获取存储桶使用情况
func GetBucketUsage() (map[string]int64, error) {
	objects, _, err := ListBucketObjects("", true)
	if err != nil {
		return nil, err
	}

	// 按文件类型统计大小
	usage := make(map[string]int64)
	for _, obj := range objects {
		contentType := obj.ContentType
		if contentType == "" {
			// 如果没有 ContentType，尝试从文件名推断
			contentType = inferContentType(obj.Key)
		}
		usage[contentType] += obj.Size
	}

	return usage, nil
}

// inferContentType 从文件名推断内容类型
func inferContentType(filename string) string {
	ext := strings.ToLower(getFileExtension(filename))
	switch ext {
	case ".mp3", ".wav", ".flac", ".m4a":
		return "audio"
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
		return "image"
	case ".mp4", ".avi", ".mov", ".mkv":
		return "video"
	case ".pdf", ".doc", ".docx", ".txt":
		return "document"
	default:
		return "other"
	}
}

// getFileExtension 获取文件扩展名
func getFileExtension(filename string) string {
	for i := len(filename) - 1; i >= 0; i-- {
		if filename[i] == '.' {
			return filename[i+1:]
		}
	}
	return "unknown"
}

// GetBucketStats 获取存储桶的统计信息
func (m *MinioClient) GetBucketStats() (map[string]interface{}, error) {
	ctx := context.Background()

	stats := make(map[string]interface{})

	// 检查存储桶是否存在
	exists, err := m.client.BucketExists(ctx, m.bucketName)
	if err != nil {
		return nil, fmt.Errorf("检查存储桶是否存在失败: %v", err)
	}
	if !exists {
		return nil, fmt.Errorf("存储桶 %s 不存在", m.bucketName)
	}

	stats["bucketName"] = m.bucketName

	// 计算文件类型统计
	typeStats := make(map[string]int64)
	var totalSize int64
	var objectCount int64
	var lastModified time.Time

	objectCh := m.client.ListObjects(ctx, m.bucketName, minio.ListObjectsOptions{})
	for object := range objectCh {
		if object.Err != nil {
			continue
		}
		// 获取文件扩展名
		ext := getFileExtension(object.Key)
		typeStats[ext]++
		totalSize += object.Size
		objectCount++
		if object.LastModified.After(lastModified) {
			lastModified = object.LastModified
		}
	}

	stats["totalSize"] = totalSize
	stats["objects"] = objectCount
	stats["lastModified"] = lastModified
	stats["typeStats"] = typeStats

	return stats, nil
}

// PrintBucketStats 打印存储桶统计信息
func (m *MinioClient) PrintBucketStats() error {
	stats, err := m.GetBucketStats()
	if err != nil {
		return err
	}

	fmt.Printf("\n=== 存储桶统计信息 ===\n")
	fmt.Printf("存储桶名称: %s\n", stats["bucketName"])
	fmt.Printf("总大小: %.2f MB\n", float64(stats["totalSize"].(int64))/1024/1024)
	fmt.Printf("对象总数: %d\n", stats["objects"])
	fmt.Printf("最后修改时间: %s\n", stats["lastModified"].(time.Time).Format(time.RFC3339))

	fmt.Printf("\n文件类型统计:\n")
	typeStats := stats["typeStats"].(map[string]int64)
	for ext, count := range typeStats {
		fmt.Printf("%s: %d 个文件\n", ext, count)
	}

	return nil
}

// ListObjectsRecursive 递归列出存储桶中的所有对象
func (m *MinioClient) ListObjectsRecursive(prefix string) error {
	ctx := context.Background()

	// 检查存储桶是否存在
	exists, err := m.client.BucketExists(ctx, m.bucketName)
	if err != nil {
		return fmt.Errorf("检查存储桶是否存在失败: %v", err)
	}
	if !exists {
		return fmt.Errorf("存储桶 %s 不存在", m.bucketName)
	}

	// 获取存储桶统计信息
	var totalSize int64
	var objectCount int64
	var lastModified time.Time

	// 列出所有对象
	objectCh := m.client.ListObjects(ctx, m.bucketName, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	})

	// 用于存储目录结构
	dirs := make(map[string]bool)
	var objects []minio.ObjectInfo

	// 第一次遍历，收集所有对象和目录
	for object := range objectCh {
		if object.Err != nil {
			log.Printf("列出对象时出错: %v", object.Err)
			continue
		}

		// 更新统计信息
		totalSize += object.Size
		objectCount++
		if object.LastModified.After(lastModified) {
			lastModified = object.LastModified
		}

		// 收集目录信息
		parts := strings.Split(object.Key, "/")
		if len(parts) > 1 {
			currentPath := ""
			for i := 0; i < len(parts)-1; i++ {
				if currentPath == "" {
					currentPath = parts[i]
				} else {
					currentPath = currentPath + "/" + parts[i]
				}
				dirs[currentPath] = true
			}
		}

		objects = append(objects, object)
	}

	// 打印存储桶信息
	fmt.Printf("\n存储桶信息:\n")
	fmt.Printf("名称: %s\n", m.bucketName)
	fmt.Printf("总大小: %.2f MB\n", float64(totalSize)/1024/1024)
	fmt.Printf("对象数量: %d\n", objectCount)
	fmt.Printf("最后修改时间: %s\n", lastModified.Format(time.RFC3339))

	// 打印目录结构
	fmt.Printf("\n目录结构:\n")
	printDirectoryStructure(prefix, dirs, objects)

	return nil
}

// printDirectoryStructure 打印目录结构
func printDirectoryStructure(prefix string, dirs map[string]bool, objects []minio.ObjectInfo) {
	// 获取所有目录并排序
	var sortedDirs []string
	for dir := range dirs {
		if strings.HasPrefix(dir, prefix) {
			sortedDirs = append(sortedDirs, dir)
		}
	}
	sort.Strings(sortedDirs)

	// 打印目录和文件
	for _, dir := range sortedDirs {
		// 计算缩进级别
		level := strings.Count(dir, "/")
		indent := strings.Repeat("  ", level)
		fmt.Printf("%s📁 %s/\n", indent, dir)

		// 打印该目录下的文件
		for _, obj := range objects {
			if strings.HasPrefix(obj.Key, dir+"/") && !strings.Contains(strings.TrimPrefix(obj.Key, dir+"/"), "/") {
				fmt.Printf("%s  📄 %s (%.2f MB)\n", indent,
					strings.TrimPrefix(obj.Key, dir+"/"),
					float64(obj.Size)/1024/1024)
			}
		}
	}

	// 打印根目录下的文件
	for _, obj := range objects {
		if !strings.Contains(obj.Key, "/") {
			fmt.Printf("📄 %s (%.2f MB)\n", obj.Key, float64(obj.Size)/1024/1024)
		}
	}
}

// DeleteDirectory 递归删除目录
func (m *MinioClient) DeleteDirectory(prefix string) error {
	ctx := context.Background()

	// 检查存储桶是否存在
	exists, err := m.client.BucketExists(ctx, m.bucketName)
	if err != nil {
		return fmt.Errorf("检查存储桶是否存在失败: %v", err)
	}
	if !exists {
		return fmt.Errorf("存储桶 %s 不存在", m.bucketName)
	}

	// 列出要删除的所有对象
	objectCh := m.client.ListObjects(ctx, m.bucketName, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	})

	// 收集要删除的对象
	var objectsToDelete []minio.ObjectInfo
	for object := range objectCh {
		if object.Err != nil {
			log.Printf("列出对象时出错: %v", object.Err)
			continue
		}
		objectsToDelete = append(objectsToDelete, object)
	}

	if len(objectsToDelete) == 0 {
		return fmt.Errorf("目录 %s 为空或不存在", prefix)
	}

	// 创建对象通道
	objectsCh := make(chan minio.ObjectInfo, len(objectsToDelete))
	go func() {
		defer close(objectsCh)
		for _, obj := range objectsToDelete {
			objectsCh <- obj
		}
	}()

	// 删除所有对象
	errorsCh := m.client.RemoveObjects(ctx, m.bucketName, objectsCh, minio.RemoveObjectsOptions{})
	for err := range errorsCh {
		if err.Err != nil {
			return fmt.Errorf("删除对象 %s 失败: %v", err.ObjectName, err.Err)
		}
	}

	fmt.Printf("成功删除目录 %s 及其下的 %d 个文件\n", prefix, len(objectsToDelete))
	return nil
}
