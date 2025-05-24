package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"Bt1QFM/logger"

	"github.com/gorilla/mux"

	"Bt1QFM/model"
)

// UploadTracksToAlbumHandler 处理批量上传歌曲到专辑的请求
func (h *APIHandler) UploadTracksToAlbumHandler(w http.ResponseWriter, r *http.Request) {
	// 获取当前用户ID
	userID := r.Context().Value("userID").(int64)

	// 解析multipart表单
	err := r.ParseMultipartForm(32 << 20) // 32MB
	if err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	// 获取专辑ID
	albumIDStr := r.FormValue("albumId")
	albumID, err := strconv.ParseInt(albumIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid album ID", http.StatusBadRequest)
		return
	}

	// 验证专辑所有权
	album, err := h.albumRepo.GetAlbumByID(r.Context(), albumID)
	if err != nil {
		http.Error(w, "Failed to get album", http.StatusInternalServerError)
		return
	}
	if album == nil || album.UserID != userID {
		http.Error(w, "Album not found or unauthorized", http.StatusForbidden)
		return
	}

	// 获取上传的文件
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		http.Error(w, "No files uploaded", http.StatusBadRequest)
		return
	}

	var trackIDs []int64
	for _, fileHeader := range files {
		// 打开文件
		file, err := fileHeader.Open()
		if err != nil {
			http.Error(w, "Failed to open file", http.StatusInternalServerError)
			return
		}
		defer file.Close()

		// 提取原始文件名（去掉扩展名）作为title
		originalName := strings.TrimSuffix(fileHeader.Filename, filepath.Ext(fileHeader.Filename))

		// 创建新的track记录
		track := &model.Track{
			UserID: userID,
			Title:  originalName, // 使用原始文件名作为标题
			Artist: album.Artist,
			Album:  album.Name,
		}

		// 生成安全的文件名（与UploadTrackHandler保持完全一致）
		safeBaseFilename := generateSafeFilenamePrefix(track.Title, track.Artist, track.Album)
		fileExt := filepath.Ext(fileHeader.Filename)
		if fileExt == "" {
			fileExt = ".mp3" // 默认扩展名
		}
		trackStoreFileName := safeBaseFilename + fileExt

		// MinIO路径：audio/文件名
		minioTrackPath := "audio/" + trackStoreFileName
		// 数据库存储路径（保持原格式）
		track.FilePath = "/static/audio/" + trackStoreFileName

		// 保存track到数据库
		trackID, err := h.trackRepo.CreateTrack(track)
		if err != nil {
			http.Error(w, "Failed to save track", http.StatusInternalServerError)
			return
		}

		// 上传文件到MinIO
		if err := h.uploadFileToMinio(file, minioTrackPath, "audio/mpeg"); err != nil {
			http.Error(w, "Failed to upload file to MinIO", http.StatusInternalServerError)
			return
		}

		trackIDs = append(trackIDs, trackID)
	}

	// 将tracks添加到专辑
	err = h.albumRepo.AddTracksToAlbum(r.Context(), albumID, trackIDs)
	if err != nil {
		http.Error(w, "Failed to add tracks to album", http.StatusInternalServerError)
		return
	}

	// 返回成功响应
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Tracks uploaded successfully",
		"count":   len(trackIDs),
	})
}

// saveUploadedFile 保存上传的文件并返回文件路径
func (h *APIHandler) saveUploadedFile(file multipart.File, filename string, uploadDir string) (string, error) {
	// 生成安全的文件名
	safeFilename := generateSafeFilename(filename)
	filePath := filepath.Join(uploadDir, safeFilename)

	// 创建目标文件
	dst, err := os.Create(filePath)
	if err != nil {
		return "", err
	}
	defer dst.Close()

	// 复制文件内容
	_, err = io.Copy(dst, file)
	if err != nil {
		return "", err
	}

	return filePath, nil
}

// generateSafeFilename 生成安全的文件名
func generateSafeFilename(originalName string) string {
	// 生成随机字符串
	randomBytes := make([]byte, 8)
	rand.Read(randomBytes)
	randomStr := hex.EncodeToString(randomBytes)

	// 获取文件扩展名
	ext := filepath.Ext(originalName)
	if ext == "" {
		ext = ".mp3" // 默认扩展名
	}

	// 清理文件名
	baseName := strings.TrimSuffix(originalName, ext)
	baseName = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, baseName)

	// 组合新的文件名
	return baseName + "-" + randomStr + ext
}

// GetUserAlbumsHandler 获取用户的所有专辑
func (h *APIHandler) GetUserAlbumsHandler(w http.ResponseWriter, r *http.Request) {
	logger.Debug("Handling get user albums request",
		logger.String("method", r.Method),
		logger.String("path", r.URL.Path),
	)

	if r.Method != http.MethodGet {
		logger.Warn("Invalid method for get user albums",
			logger.String("method", r.Method),
		)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, err := GetUserIDFromContext(r.Context())
	if err != nil {
		logger.Error("Failed to get user ID from context",
			logger.ErrorField(err),
		)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	logger.Debug("Getting albums for user", logger.Int64("userId", userID))

	albums, err := h.albumRepo.GetAlbumsByUserID(r.Context(), userID)
	if err != nil {
		logger.Error("Failed to get user albums",
			logger.Int64("userId", userID),
			logger.ErrorField(err),
		)
		http.Error(w, "Failed to get albums", http.StatusInternalServerError)
		return
	}

	logger.Info("Successfully retrieved user albums",
		logger.Int64("userId", userID),
		logger.Int("count", len(albums)),
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(albums)
}

// CreateAlbumHandler 创建新专辑
func (h *APIHandler) CreateAlbumHandler(w http.ResponseWriter, r *http.Request) {
	logger.Debug("Handling create album request",
		logger.String("method", r.Method),
		logger.String("path", r.URL.Path),
	)

	if r.Method != http.MethodPost {
		logger.Warn("Invalid method for create album",
			logger.String("method", r.Method),
		)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 读取原始请求体内容
	bodyBytes, _ := io.ReadAll(r.Body)
	logger.Debug("Raw request body", logger.String("body", string(bodyBytes)))
	// 需要重置 r.Body 以便后续解码
	r.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))

	var album model.Album
	if err := json.NewDecoder(r.Body).Decode(&album); err != nil {
		logger.Error("Failed to decode album data (model.Album)",
			logger.ErrorField(err),
		)
		// 再次尝试用自定义结构体解码
		r.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))
		type albumInput struct {
			Artist      string `json:"artist"`
			Name        string `json:"name"`
			CoverPath   string `json:"coverPath"`
			ReleaseTime string `json:"releaseTime"`
			Genre       string `json:"genre"`
			Description string `json:"description"`
		}
		var input albumInput
		if err2 := json.NewDecoder(r.Body).Decode(&input); err2 == nil {
			logger.Debug("Decoded albumInput struct", logger.String("artist", input.Artist), logger.String("name", input.Name), logger.String("releaseTime", input.ReleaseTime))
			parsedTime, timeErr := time.Parse(time.RFC3339, input.ReleaseTime)
			if timeErr != nil {
				logger.Error("Failed to parse releaseTime",
					logger.String("releaseTime", input.ReleaseTime),
					logger.ErrorField(timeErr),
				)
				http.Error(w, "Invalid releaseTime format", http.StatusBadRequest)
				return
			}
			album.Artist = input.Artist
			album.Name = input.Name
			album.CoverPath = input.CoverPath
			album.ReleaseTime = parsedTime
			album.Genre = input.Genre
			album.Description = sql.NullString{String: input.Description, Valid: input.Description != ""}
		} else {
			logger.Error("Failed to decode albumInput struct",
				logger.ErrorField(err2),
			)
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
	} else {
		logger.Debug("Decoded model.Album struct", logger.String("artist", album.Artist), logger.String("name", album.Name))
	}

	userID, err := GetUserIDFromContext(r.Context())
	if err != nil {
		logger.Error("Failed to get user ID from context",
			logger.ErrorField(err),
		)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	album.UserID = userID

	logger.Debug("Creating new album",
		logger.Int64("userId", userID),
		logger.String("artist", album.Artist),
		logger.String("name", album.Name),
	)

	id, err := h.albumRepo.CreateAlbum(r.Context(), &album)
	if err != nil {
		logger.Error("Failed to create album",
			logger.Int64("userId", userID),
			logger.String("artist", album.Artist),
			logger.String("name", album.Name),
			logger.ErrorField(err),
		)
		http.Error(w, "Failed to create album", http.StatusInternalServerError)
		return
	}

	album.ID = id
	logger.Info("Album created successfully",
		logger.Int64("albumId", id),
		logger.String("artist", album.Artist),
		logger.String("name", album.Name),
	)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(album)
}

// GetAlbumHandler 获取专辑信息
func (h *APIHandler) GetAlbumHandler(w http.ResponseWriter, r *http.Request) {
	logger.Debug("Handling get album request",
		logger.String("method", r.Method),
		logger.String("path", r.URL.Path),
	)

	if r.Method != http.MethodGet {
		logger.Warn("Invalid method for get album",
			logger.String("method", r.Method),
		)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	vars := mux.Vars(r)
	albumID, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		logger.Error("Invalid album ID",
			logger.String("id", vars["id"]),
			logger.ErrorField(err),
		)
		http.Error(w, "Invalid album ID", http.StatusBadRequest)
		return
	}

	logger.Debug("Getting album", logger.Int64("albumId", albumID))

	album, err := h.albumRepo.GetAlbumByID(r.Context(), albumID)
	if err != nil {
		logger.Error("Failed to get album",
			logger.Int64("albumId", albumID),
			logger.ErrorField(err),
		)
		http.Error(w, "Failed to get album", http.StatusInternalServerError)
		return
	}

	if album == nil {
		logger.Warn("Album not found", logger.Int64("albumId", albumID))
		http.Error(w, "Album not found", http.StatusNotFound)
		return
	}

	logger.Info("Successfully retrieved album",
		logger.Int64("albumId", albumID),
		logger.String("artist", album.Artist),
		logger.String("name", album.Name),
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(album)
}

// UpdateAlbumHandler 更新专辑信息
func (h *APIHandler) UpdateAlbumHandler(w http.ResponseWriter, r *http.Request) {
	logger.Debug("Handling update album request",
		logger.String("method", r.Method),
		logger.String("path", r.URL.Path),
	)

	if r.Method != http.MethodPut {
		logger.Warn("Invalid method for update album",
			logger.String("method", r.Method),
		)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	vars := mux.Vars(r)
	albumID, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		logger.Error("Invalid album ID",
			logger.String("id", vars["id"]),
			logger.ErrorField(err),
		)
		http.Error(w, "Invalid album ID", http.StatusBadRequest)
		return
	}

	var album model.Album
	if err := json.NewDecoder(r.Body).Decode(&album); err != nil {
		logger.Error("Failed to decode album data",
			logger.ErrorField(err),
		)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	userID, err := GetUserIDFromContext(r.Context())
	if err != nil {
		logger.Error("Failed to get user ID from context",
			logger.ErrorField(err),
		)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	album.ID = albumID
	album.UserID = userID

	logger.Debug("Updating album",
		logger.Int64("albumId", albumID),
		logger.String("artist", album.Artist),
		logger.String("name", album.Name),
	)

	if err := h.albumRepo.UpdateAlbum(r.Context(), &album); err != nil {
		logger.Error("Failed to update album",
			logger.Int64("albumId", albumID),
			logger.String("artist", album.Artist),
			logger.String("name", album.Name),
			logger.ErrorField(err),
		)
		http.Error(w, "Failed to update album", http.StatusInternalServerError)
		return
	}

	logger.Info("Album updated successfully",
		logger.Int64("albumId", albumID),
		logger.String("artist", album.Artist),
		logger.String("name", album.Name),
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(album)
}

// DeleteAlbumHandler 删除专辑
func (h *APIHandler) DeleteAlbumHandler(w http.ResponseWriter, r *http.Request) {
	logger.Debug("Handling delete album request",
		logger.String("method", r.Method),
		logger.String("path", r.URL.Path),
	)

	if r.Method != http.MethodDelete {
		logger.Warn("Invalid method for delete album",
			logger.String("method", r.Method),
		)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	vars := mux.Vars(r)
	albumID, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		logger.Error("Invalid album ID",
			logger.String("id", vars["id"]),
			logger.ErrorField(err),
		)
		http.Error(w, "Invalid album ID", http.StatusBadRequest)
		return
	}

	logger.Debug("Deleting album", logger.Int64("albumId", albumID))

	if err := h.albumRepo.DeleteAlbum(r.Context(), albumID); err != nil {
		logger.Error("Failed to delete album",
			logger.Int64("albumId", albumID),
			logger.ErrorField(err),
		)
		http.Error(w, "Failed to delete album", http.StatusInternalServerError)
		return
	}

	logger.Info("Album deleted successfully", logger.Int64("albumId", albumID))
	w.WriteHeader(http.StatusNoContent)
}

// AddTrackToAlbumHandler 添加歌曲到专辑
func (h *APIHandler) AddTrackToAlbumHandler(w http.ResponseWriter, r *http.Request) {
	logger.Debug("Handling add track to album request",
		logger.String("method", r.Method),
		logger.String("path", r.URL.Path),
	)

	if r.Method != http.MethodPost {
		logger.Warn("Invalid method for add track to album",
			logger.String("method", r.Method),
		)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	vars := mux.Vars(r)
	albumID, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		logger.Error("Invalid album ID",
			logger.String("id", vars["id"]),
			logger.ErrorField(err),
		)
		http.Error(w, "Invalid album ID", http.StatusBadRequest)
		return
	}

	var req struct {
		TrackID  int64 `json:"track_id"`
		Position int   `json:"position"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		logger.Error("Failed to decode request body",
			logger.ErrorField(err),
		)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	logger.Debug("Adding track to album",
		logger.Int64("albumId", albumID),
		logger.Int64("trackId", req.TrackID),
		logger.Int("position", req.Position),
	)

	if err := h.albumRepo.AddTrackToAlbum(r.Context(), albumID, req.TrackID, req.Position); err != nil {
		logger.Error("Failed to add track to album",
			logger.Int64("albumId", albumID),
			logger.Int64("trackId", req.TrackID),
			logger.ErrorField(err),
		)
		http.Error(w, "Failed to add track to album", http.StatusInternalServerError)
		return
	}

	logger.Info("Track added to album successfully",
		logger.Int64("albumId", albumID),
		logger.Int64("trackId", req.TrackID),
		logger.Int("position", req.Position),
	)
	w.WriteHeader(http.StatusCreated)
}

// RemoveTrackFromAlbumHandler 从专辑中移除歌曲
func (h *APIHandler) RemoveTrackFromAlbumHandler(w http.ResponseWriter, r *http.Request) {
	logger.Debug("Handling remove track from album request",
		logger.String("method", r.Method),
		logger.String("path", r.URL.Path),
	)

	if r.Method != http.MethodDelete {
		logger.Warn("Invalid method for remove track from album",
			logger.String("method", r.Method),
		)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	vars := mux.Vars(r)
	albumID, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		logger.Error("Invalid album ID",
			logger.String("id", vars["id"]),
			logger.ErrorField(err),
		)
		http.Error(w, "Invalid album ID", http.StatusBadRequest)
		return
	}

	trackID, err := strconv.ParseInt(vars["track_id"], 10, 64)
	if err != nil {
		logger.Error("Invalid track ID",
			logger.String("id", vars["track_id"]),
			logger.ErrorField(err),
		)
		http.Error(w, "Invalid track ID", http.StatusBadRequest)
		return
	}

	logger.Debug("Removing track from album",
		logger.Int64("albumId", albumID),
		logger.Int64("trackId", trackID),
	)

	if err := h.albumRepo.RemoveTrackFromAlbum(r.Context(), albumID, trackID); err != nil {
		logger.Error("Failed to remove track from album",
			logger.Int64("albumId", albumID),
			logger.Int64("trackId", trackID),
			logger.ErrorField(err),
		)
		http.Error(w, "Failed to remove track from album", http.StatusInternalServerError)
		return
	}

	logger.Info("Track removed from album successfully",
		logger.Int64("albumId", albumID),
		logger.Int64("trackId", trackID),
	)
	w.WriteHeader(http.StatusNoContent)
}

// GetAlbumTracksHandler 获取专辑中的所有歌曲
func (h *APIHandler) GetAlbumTracksHandler(w http.ResponseWriter, r *http.Request) {
	logger.Debug("Handling get album tracks request",
		logger.String("method", r.Method),
		logger.String("path", r.URL.Path),
	)

	if r.Method != http.MethodGet {
		logger.Warn("Invalid method for get album tracks",
			logger.String("method", r.Method),
		)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	vars := mux.Vars(r)
	albumID, err := strconv.ParseInt(vars["id"], 10, 64)
	if err != nil {
		logger.Error("Invalid album ID",
			logger.String("id", vars["id"]),
			logger.ErrorField(err),
		)
		http.Error(w, "Invalid album ID", http.StatusBadRequest)
		return
	}

	logger.Debug("Getting album tracks",
		logger.Int64("albumId", albumID),
	)

	// 新增：获取专辑信息
	album, err := h.albumRepo.GetAlbumByID(r.Context(), albumID)
	if err != nil {
		logger.Error("Failed to get album",
			logger.Int64("albumId", albumID),
			logger.ErrorField(err),
		)
		http.Error(w, "Failed to get album", http.StatusInternalServerError)
		return
	}
	if album == nil {
		logger.Warn("Album not found", logger.Int64("albumId", albumID))
		http.Error(w, "Album not found", http.StatusNotFound)
		return
	}

	tracks, err := h.albumRepo.GetAlbumTracks(r.Context(), albumID)
	if err != nil {
		logger.Error("Failed to get album tracks",
			logger.Int64("albumId", albumID),
			logger.ErrorField(err),
		)
		http.Error(w, "Failed to get album tracks", http.StatusInternalServerError)
		return
	}

	// 新增：自动补全 coverArtPath
	for _, track := range tracks {
		if (track.CoverArtPath == "" || track.CoverArtPath == "null") && album.CoverPath != "" {
			err := h.trackRepo.UpdateTrackCoverArtPath(track.ID, album.CoverPath)
			if err == nil {
				track.CoverArtPath = album.CoverPath
			}
		}
	}

	logger.Info("Successfully retrieved album tracks",
		logger.Int64("albumId", albumID),
		logger.Int("count", len(tracks)),
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tracks)
}
