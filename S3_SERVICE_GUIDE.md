# S3 对象存储服务接入指南

> S3-Compatible Object Storage Integration Guide

---

## 1. 服务信息 | Service Information

### 连接配置 | Connection Configuration

| 配置项 | 值 | 说明 |
|--------|-----|------|
| **Endpoint** | `http://s3.yxvm.server.ygxz.de:8081` | S3 服务端点 |
| **Bucket** | `ygxz-file` | 存储桶名称 |
| **Region** | `us-east-1` | 区域（默认值） |
| **Access Key** | `ygxzfile96d302b2` | 访问密钥 ID |
| **Secret Key** | `MhhLAE2PRKlPI4TzimHhlP5HXsCgfAdc` | 访问密钥 Secret |
| **Path Style** | `true` | 使用路径风格访问 |

### 服务特性 | Service Characteristics

- **服务类型**: S3 兼容对象存储 (S3-Compatible Object Storage)
- **可能实现**: MinIO / SeaweedFS / Ceph RGW
- **版本控制**: 已禁用 (Disabled)
- **访问协议**: HTTP (非 HTTPS)

---

## 2. 权限矩阵 | Permission Matrix

| 操作 | 权限 | API 方法 | 用途 |
|------|------|----------|------|
| **LIST** | ✅ 允许 | `ListObjectsV2` | 列出存储桶中的对象 |
| **PUT** | ✅ 允许 | `PutObject` | 上传文件到存储桶 |
| **GET** | ✅ 允许 | `GetObject` | 下载存储桶中的文件 |
| **DELETE** | ✅ 允许 | `DeleteObject` | 删除存储桶中的对象 |
| **HEAD** | ✅ 允许 | `HeadObject/HeadBucket` | 查询元数据信息 |

---

## 3. Go 语言集成 | Go Integration

### 3.1 安装依赖 | Install Dependencies

```bash
go get github.com/aws/aws-sdk-go-v2/aws
go get github.com/aws/aws-sdk-go-v2/config
go get github.com/aws/aws-sdk-go-v2/credentials
go get github.com/aws/aws-sdk-go-v2/service/s3
```

### 3.2 客户端初始化 | Client Initialization

```go
package s3client

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const (
	Endpoint  = "http://s3.yxvm.server.ygxz.de:8081"
	Bucket    = "ygxz-file"
	Region    = "us-east-1"
	AccessKey = "ygxzfile96d302b2"
	SecretKey = "MhhLAE2PRKlPI4TzimHhlP5HXsCgfAdc"
)

// NewS3Client 创建 S3 客户端
func NewS3Client(ctx context.Context) (*s3.Client, error) {
	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(AccessKey, SecretKey, ""),
		),
		config.WithRegion(Region),
	)
	if err != nil {
		return nil, err
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(Endpoint)
		o.UsePathStyle = true // 必须启用路径风格
	})

	return client, nil
}
```

### 3.3 常用操作示例 | Common Operations

#### 上传文件 | Upload File

```go
package s3client

import (
	"bytes"
	"context"
	"io"
	"os"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// UploadFile 上传文件到 S3
func UploadFile(ctx context.Context, client *s3.Client, key string, data []byte) error {
	_, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(Bucket),
		Key:    aws.String(key),
		Body:   bytes.NewReader(data),
	})
	return err
}

// UploadFromPath 从本地路径上传文件
func UploadFromPath(ctx context.Context, client *s3.Client, key, filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return err
	}

	return UploadFile(ctx, client, key, data)
}
```

#### 下载文件 | Download File

```go
// DownloadFile 从 S3 下载文件
func DownloadFile(ctx context.Context, client *s3.Client, key string) ([]byte, error) {
	result, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	defer result.Body.Close()

	return io.ReadAll(result.Body)
}

// DownloadToPath 下载文件到本地路径
func DownloadToPath(ctx context.Context, client *s3.Client, key, filePath string) error {
	data, err := DownloadFile(ctx, client, key)
	if err != nil {
		return err
	}

	return os.WriteFile(filePath, data, 0644)
}
```

#### 列出文件 | List Files

```go
// ListFiles 列出存储桶中的文件
func ListFiles(ctx context.Context, client *s3.Client, prefix string) ([]string, error) {
	result, err := client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket: aws.String(Bucket),
		Prefix: aws.String(prefix),
	})
	if err != nil {
		return nil, err
	}

	var keys []string
	for _, obj := range result.Contents {
		keys = append(keys, *obj.Key)
	}
	return keys, nil
}
```

#### 删除文件 | Delete File

```go
// DeleteFile 删除 S3 中的文件
func DeleteFile(ctx context.Context, client *s3.Client, key string) error {
	_, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(Bucket),
		Key:    aws.String(key),
	})
	return err
}

// DeleteFiles 批量删除文件
func DeleteFiles(ctx context.Context, client *s3.Client, keys []string) error {
	for _, key := range keys {
		if err := DeleteFile(ctx, client, key); err != nil {
			return err
		}
	}
	return nil
}
```

#### 检查文件是否存在 | Check File Exists

```go
// FileExists 检查文件是否存在
func FileExists(ctx context.Context, client *s3.Client, key string) (bool, error) {
	_, err := client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		// 检查是否是 NotFound 错误
		return false, nil
	}
	return true, nil
}
```

### 3.4 完整使用示例 | Complete Usage Example

```go
package main

import (
	"context"
	"fmt"
	"log"

	"your-project/s3client"
)

func main() {
	ctx := context.Background()

	// 创建客户端
	client, err := s3client.NewS3Client(ctx)
	if err != nil {
		log.Fatalf("Failed to create S3 client: %v", err)
	}

	// 上传文件
	data := []byte("Hello, S3!")
	if err := s3client.UploadFile(ctx, client, "test/hello.txt", data); err != nil {
		log.Fatalf("Failed to upload: %v", err)
	}
	fmt.Println("Upload successful!")

	// 列出文件
	files, err := s3client.ListFiles(ctx, client, "test/")
	if err != nil {
		log.Fatalf("Failed to list: %v", err)
	}
	fmt.Printf("Files: %v\n", files)

	// 下载文件
	content, err := s3client.DownloadFile(ctx, client, "test/hello.txt")
	if err != nil {
		log.Fatalf("Failed to download: %v", err)
	}
	fmt.Printf("Content: %s\n", string(content))

	// 删除文件
	if err := s3client.DeleteFile(ctx, client, "test/hello.txt"); err != nil {
		log.Fatalf("Failed to delete: %v", err)
	}
	fmt.Println("Delete successful!")
}
```

---

## 4. 环境变量配置 | Environment Variables

建议使用环境变量管理敏感信息：

```bash
# .env 文件
S3_ENDPOINT=http://s3.yxvm.server.ygxz.de:8081
S3_BUCKET=ygxz-file
S3_REGION=us-east-1
S3_ACCESS_KEY=ygxzfile96d302b2
S3_SECRET_KEY=MhhLAE2PRKlPI4TzimHhlP5HXsCgfAdc
```

```go
// 从环境变量读取配置
package s3client

import "os"

type Config struct {
	Endpoint  string
	Bucket    string
	Region    string
	AccessKey string
	SecretKey string
}

func LoadConfigFromEnv() *Config {
	return &Config{
		Endpoint:  getEnv("S3_ENDPOINT", "http://s3.yxvm.server.ygxz.de:8081"),
		Bucket:    getEnv("S3_BUCKET", "ygxz-file"),
		Region:    getEnv("S3_REGION", "us-east-1"),
		AccessKey: getEnv("S3_ACCESS_KEY", ""),
		SecretKey: getEnv("S3_SECRET_KEY", ""),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
```

---

## 5. 最佳实践 | Best Practices

### 5.1 文件组织 | File Organization

```
ygxz-file/
├── uploads/          # 用户上传文件
│   ├── images/
│   ├── documents/
│   └── videos/
├── assets/           # 静态资源
│   ├── css/
│   ├── js/
│   └── fonts/
├── backups/          # 备份文件
│   └── YYYY-MM-DD/
└── logs/             # 日志归档
    └── YYYY/MM/
```

### 5.2 命名规范 | Naming Conventions

```go
// 推荐的 Key 命名格式
key := fmt.Sprintf("%s/%s/%s_%s%s",
    category,                          // uploads, assets, backups
    subCategory,                       // images, documents
    time.Now().Format("20060102"),     // 日期前缀
    uuid.New().String()[:8],           // 唯一标识
    filepath.Ext(filename),            // 文件扩展名
)
// 示例: uploads/images/20241202_a1b2c3d4.jpg
```

### 5.3 错误处理 | Error Handling

```go
import (
	"errors"
	"github.com/aws/smithy-go"
)

func handleS3Error(err error) error {
	var ae smithy.APIError
	if errors.As(err, &ae) {
		switch ae.ErrorCode() {
		case "NoSuchKey":
			return fmt.Errorf("file not found")
		case "AccessDenied":
			return fmt.Errorf("access denied")
		case "NoSuchBucket":
			return fmt.Errorf("bucket not found")
		default:
			return fmt.Errorf("S3 error: %s - %s", ae.ErrorCode(), ae.ErrorMessage())
		}
	}
	return err
}
```

### 5.4 连接池与超时 | Connection Pool & Timeout

```go
import (
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws/transport/http"
)

func NewS3ClientWithTimeout(ctx context.Context) (*s3.Client, error) {
	httpClient := awshttp.NewBuildableClient().WithTransportOptions(func(tr *http.Transport) {
		tr.MaxIdleConns = 100
		tr.MaxIdleConnsPerHost = 10
		tr.IdleConnTimeout = 90 * time.Second
	})

	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(AccessKey, SecretKey, ""),
		),
		config.WithRegion(Region),
		config.WithHTTPClient(httpClient),
	)
	if err != nil {
		return nil, err
	}

	return s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(Endpoint)
		o.UsePathStyle = true
	}), nil
}
```

---

## 6. 常见问题 | FAQ

### Q1: 连接超时怎么办？
```go
// 设置超时上下文
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()

// 使用带超时的上下文进行操作
client.PutObject(ctx, &s3.PutObjectInput{...})
```

### Q2: 如何处理大文件上传？
```go
// 使用分片上传 (Multipart Upload)
import "github.com/aws/aws-sdk-go-v2/feature/s3/manager"

uploader := manager.NewUploader(client, func(u *manager.Uploader) {
    u.PartSize = 10 * 1024 * 1024 // 10MB per part
    u.Concurrency = 5
})

_, err := uploader.Upload(ctx, &s3.PutObjectInput{
    Bucket: aws.String(Bucket),
    Key:    aws.String(key),
    Body:   file,
})
```

### Q3: 如何生成预签名 URL？
```go
import "github.com/aws/aws-sdk-go-v2/service/s3"

presignClient := s3.NewPresignClient(client)

// 生成下载链接 (有效期 15 分钟)
presignedURL, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
    Bucket: aws.String(Bucket),
    Key:    aws.String(key),
}, s3.WithPresignExpires(15*time.Minute))

fmt.Println("Download URL:", presignedURL.URL)
```

---

## 7. 安全注意事项 | Security Notes

| 注意事项 | 说明 |
|----------|------|
| **协议** | 当前使用 HTTP，生产环境建议升级为 HTTPS |
| **凭证管理** | 不要将密钥硬编码，使用环境变量或密钥管理服务 |
| **访问控制** | 建议按业务需求设置更细粒度的 IAM 策略 |
| **数据加密** | 敏感数据建议在客户端加密后再上传 |
| **日志审计** | 启用访问日志以便追踪和审计 |

---

## 8. 快速参考卡 | Quick Reference

```
┌────────────────────────────────────────────────────────────┐
│                    S3 服务快速参考                          │
├────────────────────────────────────────────────────────────┤
│ Endpoint:   http://s3.yxvm.server.ygxz.de:8081             │
│ Bucket:     ygxz-file                                      │
│ Region:     us-east-1                                      │
│ Access Key: ygxzfile96d302b2                               │
│ Secret Key: MhhLAE2PRKlPI4TzimHhlP5HXsCgfAdc               │
├────────────────────────────────────────────────────────────┤
│ 权限: LIST ✅ | PUT ✅ | GET ✅ | DELETE ✅ | HEAD ✅       │
├────────────────────────────────────────────────────────────┤
│ Path Style: true (必须)                                    │
└────────────────────────────────────────────────────────────┘
```

---

*文档生成时间: 2024-12-02*
*测试状态: 已验证所有操作权限*
