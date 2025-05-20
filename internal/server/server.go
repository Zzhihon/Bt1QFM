package server

import (
	"Bt1QFM/internal/audio"
	"Bt1QFM/internal/config"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
)

// Start initializes and starts the HTTP server.
func Start(port string) error {
	cfg := config.LoadConfig()
	ap := audio.NewFFmpegProcessor(cfg.FFmpegPath)

	InitHandlers(cfg, ap) // Initialize handlers with config and audio processor

	// Ensure static directories exist
	streamStaticDir := filepath.Join(cfg.StaticDir, "streams")
	if err := os.MkdirAll(streamStaticDir, os.ModePerm); err != nil {
		return fmt.Errorf("failed to create stream static directory %s: %w", streamStaticDir, err)
	}
	if err := os.MkdirAll(cfg.WebAppDir, os.ModePerm); err != nil {
		return fmt.Errorf("failed to create web app directory %s: %w", cfg.WebAppDir, err)
	}

	// --- Routing ---
	mux := http.NewServeMux()

	// API endpoint to get the M3U8 playlist (triggers transcoding if needed)
	mux.HandleFunc("/stream/", streamHandler) // Note the trailing slash for path prefixes

	// Static file server for HLS segments (.ts files)
	// These are served from /static/streams/{track_id}/segment_xxx.ts
	// The request path will be /static/streams/cd_track_12/segment_000.ts
	segmentFileServer := http.FileServer(http.Dir(cfg.StaticDir))
	mux.Handle("/static/", http.StripPrefix("/static/", segmentFileServer))

	// Static file server for the web UI
	uiFileServer := http.FileServer(http.Dir(cfg.WebAppDir))
	mux.Handle("/", uiFileServer)

	fmt.Printf("Bt1QFM Server listening on http://localhost%s\n", port)
	fmt.Printf("Serving HLS segments from: ./%s/streams\n", cfg.StaticDir)
	fmt.Printf("Serving Web UI from: ./%s\n", cfg.WebAppDir)
	fmt.Printf("Try playing: http://localhost%s/stream/cd_track_12/playlist.m3u8 (in VLC or a HLS player)\n", port)
	fmt.Printf("Access UI at: http://localhost%s/\n", port)

	if err := http.ListenAndServe(port, mux); err != nil {
		return fmt.Errorf("ListenAndServe error: %w", err)
	}
	return nil
}
