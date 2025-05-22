package server

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"Bt1QFM/config"
	"Bt1QFM/core/audio"
	"Bt1QFM/db"
	"Bt1QFM/repository"

	"github.com/gorilla/mux"
)

// Start initializes and starts the HTTP server.
func Start() {
	cfg := config.Load()

	// 设置服务器超时
	server := &http.Server{
		Addr:         ":8080",
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// 初始化 MinIO 客户端
	// if err := storage.InitMinio(); err != nil {
	// 	log.Fatalf("Failed to initialize MinIO: %v", err)
	// }

	// Connect to the database
	if err := db.ConnectDB(cfg); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.DB.Close()

	// Connect to Redis
	if err := db.ConnectRedis(cfg); err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}
	defer db.CloseRedis()
	log.Println("Successfully connected to Redis")

	// Initialize database schema
	if err := db.InitDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Create necessary directories if they don't exist
	ensureDirExists(cfg.StaticDir)
	ensureDirExists(cfg.UploadDir)                           // Base upload directory
	ensureDirExists(cfg.AudioUploadDir)                      // For audio files
	ensureDirExists(cfg.CoverUploadDir)                      // For cover art
	ensureDirExists(filepath.Join(cfg.StaticDir, "streams")) // For HLS streams

	audioProcessor := audio.NewFFmpegProcessor(cfg.FFmpegPath)
	trackRepo := repository.NewMySQLTrackRepository()
	userRepo := repository.NewMySQLUserRepository(db.DB)
	albumRepo := repository.NewMySQLAlbumRepository(db.DB)

	// Pass cfg, trackRepo, and userRepo to handlers
	apiHandler := NewAPIHandler(trackRepo, userRepo, albumRepo, audioProcessor, cfg)

	// 使用 gorilla/mux 创建路由器
	router := mux.NewRouter()

	// 添加 CORS 中间件
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	})

	// API Endpoints
	router.HandleFunc("/api/tracks", apiHandler.AuthMiddleware(apiHandler.GetTracksHandler)).Methods(http.MethodGet)
	router.HandleFunc("/api/upload", apiHandler.AuthMiddleware(apiHandler.UploadTrackHandler)).Methods(http.MethodPost)
	router.HandleFunc("/api/upload/cover", apiHandler.AuthMiddleware(apiHandler.UploadCoverHandler)).Methods(http.MethodPost)
	router.HandleFunc("/stream/{track_id}/playlist.m3u8", apiHandler.StreamHandler).Methods(http.MethodGet)

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

	// 用户认证相关的API端点
	router.HandleFunc("/api/auth/login", apiHandler.LoginHandler).Methods(http.MethodPost)
	router.HandleFunc("/api/auth/register", apiHandler.RegisterHandler).Methods(http.MethodPost)

	// Static file serving for HLS segments and cover art
	// This will serve files from ./static (e.g., /static/streams/... and /static/covers/...)
	staticFileServer := http.FileServer(http.Dir(cfg.StaticDir))
	router.PathPrefix("/static/").Handler(http.StripPrefix("/static/", staticFileServer))

	// Static file serving for uploaded original audio and covers (if needed for direct access, usually not for audio)
	uploadsFileServer := http.FileServer(http.Dir(cfg.UploadDir))
	router.PathPrefix("/uploads/").Handler(http.StripPrefix("/uploads/", uploadsFileServer))

	// Frontend UI serving
	uiFileServer := http.FileServer(http.Dir(cfg.WebAppDir))
	router.PathPrefix("/").Handler(uiFileServer)

	server.Handler = router

	log.Println("Server starting on :8080...")
	log.Println("Access the UI at http://localhost:8080/")
	log.Println("Upload tracks via POST to http://localhost:8080/api/upload")
	log.Println("List tracks via GET from http://localhost:8080/api/tracks")
	log.Println("Stream tracks via GET from http://localhost:8080/stream/{track_id}/playlist.m3u8")
	log.Println("Manage playlist via /api/playlist endpoints")
	log.Println("Manage albums via /api/albums endpoints")

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func ensureDirExists(path string) {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		log.Printf("Creating directory: %s", path)
		if err := os.MkdirAll(path, 0755); err != nil {
			log.Fatalf("Failed to create directory %s: %v", path, err)
		}
	} else if err != nil {
		log.Fatalf("Failed to check directory %s: %v", path, err)
	}
}
