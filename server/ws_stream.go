package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"Bt1QFM/config"
	"Bt1QFM/db"
	"Bt1QFM/logger"
	"Bt1QFM/storage"

	"github.com/fsnotify/fsnotify"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/minio/minio-go/v7"
)

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (h *APIHandler) WebSocketStreamHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Error("websocket upgrade failed", logger.ErrorField(err))
		return
	}
	defer conn.Close()

	vars := mux.Vars(r)
	idStr := vars["track_id"]
	trackID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		logger.Warn("invalid track id", logger.String("id", idStr))
		return
	}

	track, err := h.trackRepo.GetTrackByID(trackID)
	if err != nil || track == nil {
		logger.Warn("track not found", logger.ErrorField(err))
		return
	}

	minioPath := strings.TrimPrefix(track.FilePath, "/static/")

	tempDir, err := os.MkdirTemp("", fmt.Sprintf("stream-%d-", trackID))
	if err != nil {
		logger.Error("temp dir failed", logger.ErrorField(err))
		return
	}

	tempAudio := filepath.Join(tempDir, filepath.Base(minioPath))
	if err := h.downloadFileFromMinio(minioPath, tempAudio); err != nil {
		logger.Error("download audio failed", logger.ErrorField(err))
		return
	}

	segmentPattern := filepath.Join(tempDir, "segment_%03d.ts")
	playlistPath := filepath.Join(tempDir, "playlist.m3u8")

	args := []string{
		"-i", tempAudio,
		"-c:a", "aac",
		"-b:a", h.cfg.AudioBitrate,
		"-hls_time", h.cfg.HLSSegmentTime,
		"-hls_list_size", "0",
		"-hls_segment_filename", segmentPattern,
		"-f", "hls",
		playlistPath,
	}

	cmd := exec.Command(h.audioProcessor.FFmpegPath(), args...)
	if err := cmd.Start(); err != nil {
		logger.Error("ffmpeg start failed", logger.ErrorField(err))
		return
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		logger.Error("watcher failed", logger.ErrorField(err))
		return
	}
	defer watcher.Close()

	if err := watcher.Add(tempDir); err != nil {
		logger.Error("watcher add failed", logger.ErrorField(err))
		return
	}

	processed := make(map[string]bool)
	cfg := config.Load()
	minioClient := storage.GetMinioClient()
	minioDir := fmt.Sprintf("streams/%d_ws", trackID)

	done := make(chan struct{})
	go func() {
		for {
			select {
			case event := <-watcher.Events:
				if event.Op&fsnotify.Create == fsnotify.Create && strings.HasSuffix(event.Name, ".ts") {
					if processed[event.Name] {
						continue
					}
					processed[event.Name] = true
					sendSegment(event.Name, conn, trackID, minioClient, cfg, minioDir)
				}
			case err := <-watcher.Errors:
				logger.Warn("watcher error", logger.ErrorField(err))
			case <-done:
				return
			}
		}
	}()

	_ = cmd.Wait()
	done <- struct{}{}

	go func(dir string) {
		time.Sleep(60 * time.Second)
		os.RemoveAll(dir)
	}(tempDir)
}

func sendSegment(path string, conn *websocket.Conn, trackID int64, client *minio.Client, cfg *config.Config, minioDir string) {
	data, err := os.ReadFile(path)
	if err != nil {
		logger.Warn("read segment", logger.ErrorField(err))
		return
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, data); err != nil {
		logger.Warn("websocket write", logger.ErrorField(err))
	}

	if client != nil {
		f, err := os.Open(path)
		if err == nil {
			defer f.Close()
			objectName := filepath.Join(minioDir, filepath.Base(path))
			opts := minio.PutObjectOptions{ContentType: "video/MP2T", DisableMultipart: true}
			if _, err := client.PutObject(context.Background(), cfg.MinioBucket, objectName, f, int64(len(data)), opts); err != nil {
				logger.Warn("upload segment", logger.ErrorField(err))
			}
		}
	}

	if db.RedisClient != nil {
		key := fmt.Sprintf("segment:%d:%s", trackID, filepath.Base(path))
		if err := db.RedisClient.Set(context.Background(), key, data, 5*time.Minute).Err(); err != nil {
			logger.Warn("redis set", logger.ErrorField(err))
		}
	}
}
