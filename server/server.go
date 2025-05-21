package server

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"Bt1QFM/config"
	"Bt1QFM/core/audio"
	"Bt1QFM/db"
	"Bt1QFM/repository"
	// "Bt1QFM/storage"
)

// Start initializes and starts the HTTP server.
func Start() {
	cfg := config.Load()

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

	// Pass cfg, trackRepo, and userRepo to handlers
	apiHandler := NewAPIHandler(trackRepo, userRepo, audioProcessor, cfg)

	mux := http.NewServeMux()

	// API Endpoints
	mux.HandleFunc("/api/tracks", apiHandler.GetTracksHandler)   // GET /api/tracks
	mux.HandleFunc("/api/upload", apiHandler.UploadTrackHandler) // POST /api/upload
	mux.HandleFunc("/stream/", apiHandler.StreamHandler)         // GET /stream/{trackID}/playlist.m3u8

	// 新增播放列表相关的API端点
	mux.HandleFunc("/api/playlist", apiHandler.PlaylistHandler)                   // 处理基本的播放列表操作
	mux.HandleFunc("/api/playlist/all", apiHandler.AddAllTracksToPlaylistHandler) // 添加所有歌曲到播放列表

	// Static file serving for HLS segments and cover art
	// This will serve files from ./static (e.g., /static/streams/... and /static/covers/...)
	staticFileServer := http.FileServer(http.Dir(cfg.StaticDir))
	mux.Handle("/static/", http.StripPrefix("/static/", staticFileServer))

	// Static file serving for uploaded original audio and covers (if needed for direct access, usually not for audio)
	uploadsFileServer := http.FileServer(http.Dir(cfg.UploadDir))
	mux.Handle("/uploads/", http.StripPrefix("/uploads/", uploadsFileServer))

	// Frontend UI serving
	uiFileServer := http.FileServer(http.Dir(cfg.WebAppDir))
	mux.Handle("/", uiFileServer)

	log.Println("Server starting on :8080...")
	log.Println("Access the UI at http://localhost:8080/")
	log.Println("Upload tracks via POST to http://localhost:8080/api/upload")
	log.Println("List tracks via GET from http://localhost:8080/api/tracks")
	log.Println("Stream tracks via GET from http://localhost:8080/stream/{track_id}/playlist.m3u8")
	log.Println("Manage playlist via /api/playlist endpoints")

	if err := http.ListenAndServe(":8080", mux); err != nil {
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
