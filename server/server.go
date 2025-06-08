package server

import (
	"context"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"Bt1QFM/cache"
	"Bt1QFM/config"
	"Bt1QFM/core/audio"
	"Bt1QFM/core/netease"
	"Bt1QFM/db"
	"Bt1QFM/logger"
	"Bt1QFM/repository"
	"Bt1QFM/storage"

	"github.com/gorilla/mux"
	"github.com/minio/minio-go/v7"
)

// Start initializes and starts the HTTP server.
func Start() {
	cfg := config.Load()

	// 初始化日志系统
	logger.InitLogger(logger.Config{
		Level:      logger.DebugLevel, // 设置为 Debug 级别以显示所有日志
		OutputPath: "logs/app.log",    // 日志文件路径
		MaxSize:    100,               // 单个日志文件最大大小（MB）
		MaxBackups: 10,                // 保留的旧日志文件数量
		MaxAge:     30,                // 日志文件保留天数
		Compress:   true,              // 压缩旧日志文件
	})

	// 设置服务器超时
	server := &http.Server{
		Addr:         ":8080",
		ReadTimeout:  300 * time.Second,
		WriteTimeout: 300 * time.Second,
		IdleTimeout:  1200 * time.Second,
	}

	// 初始化 MinIO 客户端
	if err := storage.InitMinio(); err != nil {
		logger.Fatal("初始化 MinIO 失败", logger.ErrorField(err))
	}

	// Connect to the database
	if err := db.ConnectDB(cfg); err != nil {
		logger.Fatal("连接数据库失败", logger.ErrorField(err))
	}
	defer db.DB.Close()

	// Connect to Redis
	if err := cache.ConnectRedis(cfg); err != nil {
		logger.Fatal("连接 Redis 失败", logger.ErrorField(err))
	}
	defer cache.CloseRedis()
	logger.Info("成功连接到 Redis")

	// Initialize database schema
	if err := db.InitDB(); err != nil {
		logger.Fatal("初始化数据库失败", logger.ErrorField(err))
	}

	// Create necessary directories if they don't exist
	ensureDirExists(cfg.StaticDir)
	ensureDirExists(cfg.UploadDir)                           // Base upload directory
	ensureDirExists(cfg.AudioUploadDir)                      // For audio files
	ensureDirExists(cfg.CoverUploadDir)                      // For cover art
	ensureDirExists(filepath.Join(cfg.StaticDir, "streams")) // For HLS streams

	audioProcessor := audio.NewFFmpegProcessor(cfg.FFmpegPath)
	mp3Processor := audio.NewMP3Processor(cfg.FFmpegPath)
	trackRepo := repository.NewMySQLTrackRepository()
	userRepo := repository.NewMySQLUserRepository(db.DB)
	albumRepo := repository.NewMySQLAlbumRepository(db.DB)

	// 初始化处理器
	apiHandler := NewAPIHandler(trackRepo, userRepo, albumRepo, audioProcessor, cfg)
	neteaseHandler := netease.NewNeteaseHandler(cfg.NeteaseAPIURL, cfg)

	// 使用 gorilla/mux 创建路由器
	router := mux.NewRouter()

	// 添加 CORS 中间件
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Range")
			w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range")
			w.Header().Set("Access-Control-Max-Age", "86400") // 24 hours

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	})

	// 网易云音乐相关的API端点
	router.HandleFunc("/api/netease/search", neteaseHandler.HandleSearch).Methods(http.MethodGet)
	router.HandleFunc("/api/netease/song/detail", neteaseHandler.HandleSongDetail).Methods(http.MethodGet)
	router.HandleFunc("/api/netease/song/dynamic/cover", neteaseHandler.HandleDynamicCover).Methods(http.MethodGet)

	// API Endpoints
	router.HandleFunc("/api/tracks", apiHandler.AuthMiddleware(apiHandler.GetTracksHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/upload", apiHandler.AuthMiddleware(apiHandler.UploadTrackHandler)).Methods(http.MethodPost)
	router.HandleFunc("/api/upload/cover", apiHandler.AuthMiddleware(apiHandler.UploadCoverHandler)).Methods(http.MethodPost)
	// router.HandleFunc("/streams/{track_id}/playlist.m3u8", apiHandler.StreamHandler).Methods(http.MethodGet)

	router.HandleFunc("/ws/stream/{track_id}", apiHandler.WebSocketStreamHandler)

	// Legacy compatibility: redirect old /stream path to /streams
	router.PathPrefix("/stream/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		target := "/streams/" + strings.TrimPrefix(r.URL.Path, "/stream/")
		http.Redirect(w, r, target, http.StatusMovedPermanently)
	})

	// 播放列表相关的API端点
	router.HandleFunc("/api/playlist", apiHandler.AuthMiddleware(apiHandler.PlaylistHandler)).Methods(http.MethodGet, http.MethodPost, http.MethodDelete)
	router.HandleFunc("/api/playlist/all", apiHandler.AuthMiddleware(apiHandler.AddAllTracksToPlaylistHandler)).Methods(http.MethodPost)

	// 专辑相关的API端点
	router.HandleFunc("/api/albums", apiHandler.AuthMiddleware(apiHandler.GetUserAlbumsHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/albums", apiHandler.AuthMiddleware(apiHandler.CreateAlbumHandler)).Methods(http.MethodPost)
	router.HandleFunc("/api/albums/user", apiHandler.AuthMiddleware(apiHandler.GetUserAlbumsHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/albums/{id}", apiHandler.AuthMiddleware(apiHandler.GetAlbumHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/albums/{id}", apiHandler.AuthMiddleware(apiHandler.UpdateAlbumHandler)).Methods(http.MethodPut)
	router.HandleFunc("/api/albums/{id}", apiHandler.AuthMiddleware(apiHandler.DeleteAlbumHandler)).Methods(http.MethodDelete)
	router.HandleFunc("/api/albums/{id}/tracks", apiHandler.AuthMiddleware(apiHandler.GetAlbumTracksHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/albums/{id}/tracks", apiHandler.AuthMiddleware(apiHandler.AddTrackToAlbumHandler)).Methods(http.MethodPost)
	router.HandleFunc("/api/albums/{id}/tracks/{track_id}", apiHandler.AuthMiddleware(apiHandler.RemoveTrackFromAlbumHandler)).Methods(http.MethodDelete)
	router.HandleFunc("/api/albums/{id}/tracks/{track_id}/position", apiHandler.AuthMiddleware(apiHandler.UpdateTrackPositionHandler)).Methods(http.MethodPut)
	router.HandleFunc("/api/albums/upload-tracks", apiHandler.AuthMiddleware(apiHandler.UploadTracksToAlbumHandler)).Methods(http.MethodPost)

	// 用户认证相关的API端点
	router.HandleFunc("/api/auth/login", apiHandler.LoginHandler).Methods(http.MethodPost)
	router.HandleFunc("/api/auth/register", apiHandler.RegisterHandler).Methods(http.MethodPost)

	// 添加MinIO文件服务路由
	router.PathPrefix("/streams/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 解析路径：/streams/[netease/]streamID/filename
		path := strings.TrimPrefix(r.URL.Path, "/streams/")
		pathParts := strings.Split(path, "/")

		var streamID, fileName string
		var isNetease bool

		if len(pathParts) >= 3 && pathParts[0] == "netease" {
			// /streams/netease/streamID/filename
			isNetease = true
			streamID = pathParts[1]
			fileName = pathParts[2]
		} else if len(pathParts) >= 2 {
			// /streams/streamID/filename
			isNetease = false
			streamID = pathParts[0]
			fileName = pathParts[1]
		} else {
			http.Error(w, "Invalid stream path", http.StatusBadRequest)
			return
		}

		// 使用流处理器获取文件
		streamProcessor := audio.NewStreamProcessor(mp3Processor, cfg)
		data, contentType, err := streamProcessor.StreamGet(streamID, fileName, isNetease)
		if err != nil {
			// 重试一次
			time.Sleep(100 * time.Millisecond)
			data, contentType, err = streamProcessor.StreamGet(streamID, fileName, isNetease)
			if err != nil {
				logger.Warn("获取流分片失败",
					logger.String("streamId", streamID),
					logger.String("fileName", fileName),
					logger.ErrorField(err))
				http.Error(w, "File not found", http.StatusNotFound)
				return
			}
		}

		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Cache-Control", "public, max-age=31536000")

		if _, err := w.Write(data); err != nil {
			logger.Error("写入响应失败", logger.ErrorField(err))
		}
	})

	// 添加MinIO文件服务路由（用于其他静态文件）
	router.PathPrefix("/static/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		objectPath := strings.TrimPrefix(r.URL.Path, "/static/")
		client := storage.GetMinioClient()
		if client == nil {
			http.Error(w, "MinIO client not available", http.StatusInternalServerError)
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		object, err := client.GetObject(ctx, cfg.MinioBucket, objectPath, minio.GetObjectOptions{})
		if err != nil {
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
		defer object.Close()

		var contentType string
		if strings.HasPrefix(objectPath, "covers/") {
			contentType = "image/jpeg"
		} else if strings.HasPrefix(objectPath, "audio/") {
			contentType = "audio/mpeg"
		} else {
			contentType = "application/octet-stream"
		}

		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Cache-Control", "public, max-age=31536000") // 缓存一年

		_, err = io.Copy(w, object)
		if err != nil {
			logger.Error("Error serving file from MinIO: %v", logger.ErrorField(err))
		}
	})

	// Static file serving
	uploadsFileServer := http.FileServer(http.Dir(cfg.UploadDir))
	router.PathPrefix("/uploads/").Handler(http.StripPrefix("/uploads/", uploadsFileServer))

	// Frontend UI serving
	uiFileServer := http.FileServer(http.Dir(cfg.WebAppDir))
	router.PathPrefix("/").Handler(uiFileServer)

	server.Handler = router

	// 创建一个通道来接收操作系统信号
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	// 在goroutine中启动服务器
	go func() {
		logger.Info("服务器启动中...",
			logger.String("port", "8080"),
			logger.String("ui_url", "http://localhost:8080/"),
			logger.String("upload_url", "http://localhost:8080/api/upload"),
			logger.String("tracks_url", "http://localhost:8080/api/tracks"),
			logger.String("stream_url", "http://localhost:8080/streams/{track_id}/playlist.m3u8"),
		)

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("服务器启动失败", logger.ErrorField(err))
		}
	}()

	// 等待中断信号
	<-stop
	logger.Info("正在关闭服务器...")

	// 创建一个5秒超时的上下文
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 优雅关闭服务器
	if err := server.Shutdown(ctx); err != nil {
		logger.Fatal("服务器强制关闭", logger.ErrorField(err))
	}

	logger.Info("服务器已停止")
}

func ensureDirExists(path string) {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		logger.Info("创建目录", logger.String("path", path))
		if err := os.MkdirAll(path, 0755); err != nil {
			logger.Fatal("创建目录失败",
				logger.String("path", path),
				logger.ErrorField(err))
		}
	} else if err != nil {
		logger.Fatal("检查目录失败",
			logger.String("path", path),
			logger.ErrorField(err))
	}
}
