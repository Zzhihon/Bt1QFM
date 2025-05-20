package server

import (
	"Bt1QFM/internal/audio"
	"Bt1QFM/internal/config"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

var appConfig *config.Config
var audioProcessor audio.Processor

// InitHandlers initializes handlers with dependencies.
func InitHandlers(cfg *config.Config, ap audio.Processor) {
	appConfig = cfg
	audioProcessor = ap
}

// streamHandler handles requests for HLS playlists.
// It triggers transcoding if the playlist doesn't exist.
func streamHandler(w http.ResponseWriter, r *http.Request) {
	// Path: /stream/{track_id}/playlist.m3u8
	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/"), "/")
	if len(pathParts) != 3 || pathParts[0] != "stream" || pathParts[2] != "playlist.m3u8" {
		http.Error(w, "Invalid stream path format", http.StatusBadRequest)
		return
	}
	trackID := pathParts[1]

	// For V1, we hardcode the source WAV file for a specific trackID
	var sourceWavFile string
	if trackID == "cd_track_12" {
		sourceWavFile = filepath.Join(appConfig.SourceAudioDir, "CD Track 12.wav") // Assuming WAV is in SourceAudioDir
	} else {
		http.Error(w, fmt.Sprintf("Track not found: %s", trackID), http.StatusNotFound)
		return
	}

	// Check if source WAV exists
	if _, err := os.Stat(sourceWavFile); os.IsNotExist(err) {
		http.Error(w, fmt.Sprintf("Source WAV file not found: %s", sourceWavFile), http.StatusInternalServerError)
		return
	}

	hlsOutputDir := filepath.Join(appConfig.StaticDir, "streams", trackID)
	m3u8FilePath := filepath.Join(hlsOutputDir, "playlist.m3u8")
	segmentPatternPath := filepath.Join(hlsOutputDir, "segment_%03d.ts")

	// Check if M3U8 already exists
	if _, err := os.Stat(m3u8FilePath); os.IsNotExist(err) {
		fmt.Printf("M3U8 file %s not found. Generating HLS stream for %s...\n", m3u8FilePath, sourceWavFile)
		err := audioProcessor.ProcessToHLS(sourceWavFile, m3u8FilePath, segmentPatternPath, appConfig.AudioBitrate, appConfig.HLSSegmentTime)
		if err != nil {
			msg := fmt.Sprintf("Failed to process audio to HLS: %v", err)
			fmt.Println(msg)
			http.Error(w, msg, http.StatusInternalServerError)
			return
		}
	} else if err != nil {
		msg := fmt.Sprintf("Error checking M3U8 file %s: %v", m3u8FilePath, err)
		fmt.Println(msg)
		http.Error(w, msg, http.StatusInternalServerError)
		return
	}

	// Serve the M3U8 file
	// Setting appropriate CORS headers for HLS playback from different origins (e.g. file:// during dev)
	w.Header().Set("Access-Control-Allow-Origin", "*")
	// http.ServeFile will set Content-Type based on extension
	http.ServeFile(w, r, m3u8FilePath)
}
