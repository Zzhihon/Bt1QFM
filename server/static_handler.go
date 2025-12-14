package server

import (
	"context"
	"io"
	"net/http"
	"strings"
	"time"

	"Bt1QFM/config"
	"Bt1QFM/logger"
	"Bt1QFM/storage"

	"github.com/minio/minio-go/v7"
)

// StaticHandler 处理 MinIO 静态文件请求
type StaticHandler struct {
	cfg *config.Config
}

// NewStaticHandler 创建 StaticHandler 实例
func NewStaticHandler(cfg *config.Config) *StaticHandler {
	return &StaticHandler{cfg: cfg}
}

// ServeHTTP 实现 http.Handler 接口
func (h *StaticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	objectPath := strings.TrimPrefix(r.URL.Path, "/static/")

	client := storage.GetMinioClient()
	if client == nil {
		http.Error(w, "MinIO client not available", http.StatusInternalServerError)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	object, err := client.GetObject(ctx, h.cfg.MinioBucket, objectPath, minio.GetObjectOptions{})
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	defer object.Close()

	contentType := detectContentType(objectPath)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "public, max-age=31536000")

	if _, err := io.Copy(w, object); err != nil {
		logger.Error("Error serving file from MinIO", logger.ErrorField(err))
	}
}

// detectContentType 根据路径前缀检测内容类型
func detectContentType(path string) string {
	switch {
	case strings.HasPrefix(path, "covers/"):
		return "image/jpeg"
	case strings.HasPrefix(path, "audio/"):
		return "audio/mpeg"
	default:
		return "application/octet-stream"
	}
}
