package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

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

		// 创建新的track记录
		track := &model.Track{
			UserID: userID,
			Title:  filepath.Base(fileHeader.Filename),
			Artist: album.Artist,
			Album:  album.Name,
		}

		// 生成安全的文件名
		safeFilename := generateSafeFilename(fileHeader.Filename)

		// 保存文件并获取路径
		filePath := filepath.Join(h.cfg.AudioUploadDir, safeFilename)
		dst, err := os.Create(filePath)
		if err != nil {
			http.Error(w, "Failed to save file", http.StatusInternalServerError)
			return
		}
		defer dst.Close()

		// 复制文件内容
		_, err = io.Copy(dst, file)
		if err != nil {
			http.Error(w, "Failed to save file", http.StatusInternalServerError)
			return
		}
		track.FilePath = filePath

		// 保存track到数据库
		trackID, err := h.trackRepo.CreateTrack(track)
		if err != nil {
			http.Error(w, "Failed to save track", http.StatusInternalServerError)
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
