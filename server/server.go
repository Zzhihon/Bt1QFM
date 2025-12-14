package server

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"Bt1QFM/cache"
	"Bt1QFM/config"
	"Bt1QFM/core/agent"
	"Bt1QFM/core/audio"
	"Bt1QFM/core/netease"
	"Bt1QFM/core/room"
	"Bt1QFM/db"
	"Bt1QFM/logger"
	"Bt1QFM/model"
	"Bt1QFM/repository"
	"Bt1QFM/storage"

	"github.com/gorilla/mux"
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

	// Connect to GORM database (for new room module)
	if err := db.ConnectGormDB(cfg); err != nil {
		logger.Fatal("连接 GORM 数据库失败", logger.ErrorField(err))
	}
	defer db.CloseGormDB()
	logger.Info("成功连接到 GORM 数据库")

	// Auto migrate room models
	if err := db.AutoMigrateModels(&model.Room{}, &model.RoomMember{}, &model.RoomMessage{}); err != nil {
		logger.Fatal("房间模型迁移失败", logger.ErrorField(err))
	}

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
	streamProcessor := audio.NewStreamProcessor(mp3Processor, cfg) // 创建单例 StreamProcessor
	trackRepo := repository.NewMySQLTrackRepository()
	userRepo := repository.NewMySQLUserRepository(db.DB)
	albumRepo := repository.NewMySQLAlbumRepository(db.DB)
	announcementRepo := repository.NewAnnouncementRepository()
	chatRepo := repository.NewMySQLChatRepository(db.DB)

	// 初始化处理器
	apiHandler := NewAPIHandler(trackRepo, userRepo, albumRepo, audioProcessor, streamProcessor, cfg)
	neteaseHandler := netease.NewNeteaseHandler(cfg.NeteaseAPIURL, cfg)
	userHandler := NewUserHandler(userRepo)
	announcementHandler := NewAnnouncementHandler(announcementRepo, userRepo)

	// 初始化聊天处理器
	agentConfig := &agent.MusicAgentConfig{
		APIBaseURL:  cfg.AgentAPIBaseURL,
		APIKey:      cfg.AgentAPIKey,
		Model:       cfg.AgentModel,
		MaxTokens:   cfg.AgentMaxTokens,
		Temperature: cfg.AgentTemperature,
	}

	logger.Info("Agent config initialized",
		logger.String("model", agentConfig.Model),
		logger.Int("maxTokens", agentConfig.MaxTokens),
		logger.Float64("temperature", agentConfig.Temperature),
		logger.String("apiBaseURL", agentConfig.APIBaseURL))

	chatHandler := NewChatHandler(chatRepo, agentConfig)

	// 🏠 初始化房间系统
	logger.Info("初始化房间系统...")
	roomRepo := repository.NewGormRoomRepository(db.GormDB)
	roomCache := cache.NewRoomCache()
	roomHub := room.NewRoomHub()
	go roomHub.Run() // 启动 Hub 主循环
	roomManager := room.NewRoomManager(roomRepo, roomCache, roomHub)
	roomHandler := NewRoomHandler(roomManager)
	logger.Info("房间系统初始化完成")

	// 🔥 初始化预热服务
	logger.Info("初始化预热服务...")
	// 创建网易云歌曲 URL 获取函数
	neteaseClient := netease.NewClient()
	getSongURLFunc := func(songID string) (string, error) {
		return neteaseClient.GetSongURL(songID)
	}
	preheatService := audio.NewPreheatService(streamProcessor, mp3Processor, roomCache, cfg, getSongURLFunc)
	preheatService.Start()
	logger.Info("预热服务初始化完成")

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
	router.HandleFunc("/api/netease/lyric/new", neteaseHandler.HandleLyricNew).Methods(http.MethodGet)
	// 新增网易云收藏相关接口
	router.HandleFunc("/api/netease/user/playlist", neteaseHandler.HandleUserPlaylists).Methods(http.MethodGet)
	router.HandleFunc("/api/netease/get/userids", neteaseHandler.HandleGetUserIDs).Methods(http.MethodGet)
	router.HandleFunc("/api/netease/playlist/detail", neteaseHandler.HandlePlaylistDetail).Methods(http.MethodGet)
	router.HandleFunc("/api/netease/update/info", apiHandler.AuthMiddleware(neteaseHandler.HandleUpdateNeteaseInfo(userRepo))).Methods(http.MethodPost)

	// API Endpoints
	router.HandleFunc("/api/tracks", apiHandler.AuthMiddleware(apiHandler.GetTracksHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/upload", apiHandler.AuthMiddleware(apiHandler.UploadTrackHandler)).Methods(http.MethodPost)
	router.HandleFunc("/api/upload/cover", apiHandler.AuthMiddleware(apiHandler.UploadCoverHandler)).Methods(http.MethodPost)
	// router.HandleFunc("/streams/{track_id}/playlist.m3u8", apiHandler.StreamHandler).Methods(http.MethodGet)

	router.HandleFunc("/ws/stream/{track_id}", apiHandler.WebSocketStreamHandler)

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
	router.HandleFunc("/api/user/profile", apiHandler.AuthMiddleware(userHandler.GetUserProfileHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/user/profile", apiHandler.AuthMiddleware(userHandler.UpdateUserProfileHandler)).Methods(http.MethodPut)
	router.HandleFunc("/api/user/netease/update", apiHandler.AuthMiddleware(userHandler.UpdateNeteaseInfoHandler)).Methods(http.MethodPost)

	// 🎉 公告相关的API端点 - 正式上线
	logger.Info("注册公告系统API端点...")
	RegisterAnnouncementRoutes(router, announcementHandler, apiHandler.AuthMiddleware)
	logger.Info("公告系统API端点注册完成",
		logger.String("endpoints", "GET /api/announcements, GET /api/announcements/unread, PUT /api/announcements/{id}/read, POST /api/announcements, DELETE /api/announcements/{id}, GET /api/announcements/stats"))

	// 🤖 AI聊天助手相关的API端点
	logger.Info("注册AI聊天助手API端点...")
	router.HandleFunc("/api/chat/history", apiHandler.AuthMiddleware(chatHandler.GetChatHistoryHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/chat/clear", apiHandler.AuthMiddleware(chatHandler.ClearChatHistoryHandler)).Methods(http.MethodDelete)
	router.HandleFunc("/ws/chat", chatHandler.WebSocketChatHandler)
	logger.Info("AI聊天助手API端点注册完成",
		logger.String("endpoints", "GET /api/chat/history, DELETE /api/chat/clear, WS /ws/chat"))

	// 🏠 房间系统相关的API端点
	logger.Info("注册房间系统API端点...")
	RegisterRoomRoutes(router, roomHandler, apiHandler.AuthMiddleware)

	// 🎵 流媒体服务路由
	streamHandler := NewStreamHandler(streamProcessor, mp3Processor, cfg)
	router.PathPrefix("/streams/").Handler(streamHandler)

	// 📦 MinIO 静态文件服务路由
	staticHandler := NewStaticHandler(cfg)
	router.PathPrefix("/static/").Handler(staticHandler)

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
		logger.Info("🚀 Bt1QFM 服务器启动中...",
			logger.String("port", "8080"),
			logger.String("ui_url", "http://localhost:8080/"),
			logger.String("api_base", "http://localhost:8080/api/"),
			logger.String("announcements_api", "http://localhost:8080/api/announcements"),
			logger.String("upload_url", "http://localhost:8080/api/upload"),
			logger.String("tracks_url", "http://localhost:8080/api/tracks"),
			logger.String("stream_url", "http://localhost:8080/streams/{track_id}/playlist.m3u8"),
		)

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("服务器启动失败", logger.ErrorField(err))
		}
	}()

	// 启动定期清理过期处理状态的协程
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				mp3Processor.CleanupExpiredProcessing(15 * time.Minute)
			case <-stop:
				return
			}
		}
	}()

	// 等待中断信号
	<-stop
	logger.Info("正在关闭服务器...")

	// 停止预热服务
	preheatService.Stop()
	logger.Info("预热服务已停止")

	// 停止房间 Hub
	roomHub.Stop()
	logger.Info("房间系统已停止")

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
