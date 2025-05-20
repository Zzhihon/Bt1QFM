package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"Bt1QFM/internal/audio"
	"Bt1QFM/internal/config"
	"Bt1QFM/internal/db"
	"Bt1QFM/internal/model"
	"Bt1QFM/internal/repository"
)

// APIHandler holds dependencies for HTTP handlers.
type APIHandler struct {
	repo repository.TrackRepository
	ap   audio.Processor
	cfg  *config.Config
}

// NewAPIHandler creates a new APIHandler.
func NewAPIHandler(repo repository.TrackRepository, ap audio.Processor, cfg *config.Config) *APIHandler {
	return &APIHandler{repo: repo, ap: ap, cfg: cfg}
}

// UploadTrackHandler handles audio file uploads and metadata.
// Expected multipart form fields:
// - trackFile: the audio file (WAV, MP3, etc.)
// - title: track title
// - artist: track artist (optional)
// - album: track album (optional)
// - coverFile: cover art image (JPEG, PNG, optional)
func (h *APIHandler) UploadTrackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Only POST method is allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil { // 32MB max memory
		http.Error(w, fmt.Sprintf("Failed to parse multipart form: %v", err), http.StatusBadRequest)
		return
	}

	trackFile, trackHeader, err := r.FormFile("trackFile")
	if err != nil {
		http.Error(w, "Missing 'trackFile' in form", http.StatusBadRequest)
		return
	}
	defer trackFile.Close()

	title := r.FormValue("title")
	if title == "" {
		http.Error(w, "Missing 'title' in form", http.StatusBadRequest)
		return
	}
	artist := r.FormValue("artist")
	album := r.FormValue("album")

	// Sanitize filename and create a unique name for storage if desired
	// For now, use original filename in a structured path
	originalTrackFileName := filepath.Clean(trackHeader.Filename)

	// Check if track with this path already exists to prevent duplicates
	// This check is basic; a more robust system might hash the file content.
	// For now, we base uniqueness on the *intended* storage path.
	// We'll generate a unique ID from DB first, then form the path.

	// Create preliminary track entry to get an ID
	newTrack := &model.Track{
		Title:  title,
		Artist: artist,
		Album:  album,
		// FilePath will be set after saving and getting ID
	}

	trackID, err := h.repo.CreateTrack(newTrack) // This initial CreateTrack will have empty paths
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create initial track entry: %v", err), http.StatusInternalServerError)
		return
	}
	newTrack.ID = trackID // Assign the generated ID

	// Define storage paths using the track ID for uniqueness
	trackFileExt := filepath.Ext(originalTrackFileName)
	trackStoreFileName := fmt.Sprintf("%d%s", trackID, trackFileExt)
	trackFilePath := filepath.Join(h.cfg.AudioUploadDir, trackStoreFileName) // e.g., uploads/audio/1.wav

	// Save the track file
	if err := saveUploadedFile(trackFile, trackFilePath); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save track file: %v", err), http.StatusInternalServerError)
		// Consider deleting the preliminary DB entry if file saving fails significantly
		return
	}
	newTrack.FilePath = trackFilePath // Relative path from project root

	// Handle cover art (optional)
	var coverArtPath string   // Relative path from project root, stored in DB
	var coverServePath string // Path used by client, e.g. /static/covers/1.jpg
	coverFile, coverHeader, err := r.FormFile("coverFile")
	if err == nil {
		defer coverFile.Close()
		coverFileExt := filepath.Ext(coverHeader.Filename)
		coverStoreFileName := fmt.Sprintf("%d%s", trackID, coverFileExt)
		// Covers are stored in a subdirectory of StaticDir to be served directly
		coverDestDir := filepath.Join(h.cfg.StaticDir, "covers")
		if err := os.MkdirAll(coverDestDir, 0755); err != nil {
			http.Error(w, fmt.Sprintf("Failed to create cover art directory: %v", err), http.StatusInternalServerError)
			return
		}
		coverArtPathDisk := filepath.Join(coverDestDir, coverStoreFileName) // e.g., static/covers/1.jpg

		if err := saveUploadedFile(coverFile, coverArtPathDisk); err != nil {
			http.Error(w, fmt.Sprintf("Failed to save cover art: %v", err), http.StatusInternalServerError)
			return
		}
		coverArtPath = coverArtPathDisk                         // Store full static path for now
		coverServePath = "/static/covers/" + coverStoreFileName // Path for client
		newTrack.CoverArtPath = coverServePath
	} else if err != http.ErrMissingFile {
		http.Error(w, fmt.Sprintf("Error processing cover file: %v", err), http.StatusBadRequest)
		return
	}

	// Update track entry in DB with actual file paths
	// For now, we are not using a specific method for this, CreateTrack will be called again with all info
	// This requires CreateTrack in repository to handle potential duplicate key on file_path if called twice with same path
	// Or, better: add an UpdateTrackPaths method to repository.
	// Let's assume we modify the CreateTrack to update if ID is present or add an update method.
	// For simplicity, let's add specific update methods to repository as planned.

	// Update file_path in DB (it was initially empty or placeholder)
	// We need a method in repository: UpdateTrackFilePath(id, path)
	// For now, let's assume CreateTrack was minimal and we update specific fields.

	dbUpdateErr := false
	updateStmt := "UPDATE tracks SET file_path = ?" // Prepare to build this query
	args := []interface{}{trackFilePath}

	if newTrack.CoverArtPath != "" {
		updateStmt += ", cover_art_path = ?"
		args = append(args, newTrack.CoverArtPath)
	}
	updateStmt += " WHERE id = ?"
	args = append(args, trackID)

	stmt, err := db.DB.Prepare(updateStmt)
	if err != nil {
		dbUpdateErr = true
		log.Printf("Error preparing update statement for track %d: %v", trackID, err)
	} else {
		defer stmt.Close()
		_, err = stmt.Exec(args...)
		if err != nil {
			dbUpdateErr = true
			log.Printf("Error executing update for track %d: %v", trackID, err)
		}
	}

	if dbUpdateErr {
		// Attempt to clean up saved files if DB update fails
		if newTrack.FilePath != "" {
			os.Remove(newTrack.FilePath)
		}
		if coverArtPath != "" { // coverArtPath is the disk path here
			os.Remove(coverArtPath)
		}
		// We might also want to delete the initial DB entry if it was created partially.
		http.Error(w, "Failed to finalize track details in database after file save.", http.StatusInternalServerError)
		return
	}

	log.Printf("Successfully uploaded and saved track: ID %d, Title '%s', File '%s', Cover '%s'",
		trackID, newTrack.Title, newTrack.FilePath, newTrack.CoverArtPath)

	// Optionally, trigger HLS processing immediately or defer it.
	// For now, HLS is generated on-demand by StreamHandler.

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"message": "Track uploaded successfully", "trackId": trackID, "track": newTrack})
}

func saveUploadedFile(file multipart.File, destPath string) error {
	destFile, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("failed to create destination file %s: %w", destPath, err)
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, file)
	if err != nil {
		return fmt.Errorf("failed to copy uploaded file to %s: %w", destPath, err)
	}
	return nil
}

// GetTracksHandler retrieves and returns a list of all tracks.
func (h *APIHandler) GetTracksHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Only GET method is allowed", http.StatusMethodNotAllowed)
		return
	}

	tracks, err := h.repo.GetAllTracks()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to retrieve tracks: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tracks)
}

// StreamHandler serves the HLS playlist for a given track ID.
// It triggers transcoding if the HLS playlist doesn't exist.
// URL: /stream/{trackID}/playlist.m3u8
func (h *APIHandler) StreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Only GET method is allowed", http.StatusMethodNotAllowed)
		return
	}

	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/stream/"), "/")
	if len(pathParts) < 2 || pathParts[1] != "playlist.m3u8" {
		http.Error(w, "Invalid stream URL. Expected /stream/{trackID}/playlist.m3u8", http.StatusBadRequest)
		return
	}

	trackIDStr := pathParts[0]
	trackID, err := strconv.ParseInt(trackIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid track ID format", http.StatusBadRequest)
		return
	}

	track, err := h.repo.GetTrackByID(trackID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get track details for ID %d: %v", trackID, err), http.StatusInternalServerError)
		return
	}
	if track == nil {
		http.Error(w, fmt.Sprintf("Track with ID %d not found", trackID), http.StatusNotFound)
		return
	}

	// Define HLS paths
	// hlsStreamDir is relative to StaticDir, e.g., "streams/123"
	hlsStreamDir := filepath.Join("streams", trackIDStr)
	// m3u8DiskPath is the full disk path, e.g., "static/streams/123/playlist.m3u8"
	m3u8DiskPath := filepath.Join(h.cfg.StaticDir, hlsStreamDir, "playlist.m3u8")
	// segmentDiskPattern is the full disk path pattern, e.g., "static/streams/123/segment_%03d.ts"
	segmentDiskPattern := filepath.Join(h.cfg.StaticDir, hlsStreamDir, "segment_%03d.ts")
	// hlsBaseURL is the URL base for segments in M3U8, e.g., "/static/streams/123/"
	hlsBaseURL := "/static/" + strings.ReplaceAll(hlsStreamDir, "\\", "/") + "/"
	// m3u8ServePath is the relative path for client requests, e.g. /static/streams/123/playlist.m3u8
	m3u8ServePath := "/static/" + strings.ReplaceAll(hlsStreamDir, "\\", "/") + "/playlist.m3u8"

	// Check if M3U8 already exists
	if _, err := os.Stat(m3u8DiskPath); os.IsNotExist(err) {
		log.Printf("HLS playlist %s not found for track ID %d. Generating...", m3u8DiskPath, trackID)

		// Ensure the specific stream directory exists within static/streams/
		if err := os.MkdirAll(filepath.Dir(m3u8DiskPath), 0755); err != nil {
			http.Error(w, fmt.Sprintf("Failed to create HLS stream directory for track %d: %v", trackID, err), http.StatusInternalServerError)
			return
		}

		duration, procErr := h.ap.ProcessToHLS(track.FilePath, m3u8DiskPath, segmentDiskPattern, hlsBaseURL, h.cfg.AudioBitrate, h.cfg.HLSSegmentTime)
		if procErr != nil {
			http.Error(w, fmt.Sprintf("Failed to process audio to HLS for track %d: %v", trackID, procErr), http.StatusInternalServerError)
			return
		}

		// Update database with HLS playlist path and duration
		if err := h.repo.UpdateTrackHLSPath(trackID, m3u8ServePath, duration); err != nil {
			log.Printf("Error updating HLS path for track ID %d in DB: %v. Continuing anyway.", trackID, err)
			// Not returning http error here, as playlist might be generated but DB update failed.
		}
		track.HLSPlaylistPath = m3u8ServePath // Update in-memory track object for current request
		track.Duration = duration
	} else if err != nil {
		http.Error(w, fmt.Sprintf("Error checking HLS playlist for track %d: %v", trackID, err), http.StatusInternalServerError)
		return
	}

	// If HLS path was not in DB but file existed, or if it was just generated, ensure track model has it.
	if track.HLSPlaylistPath == "" {
		// This situation might occur if the file exists on disk but not in DB record.
		// We should ideally re-sync DB or rely on the generated path.
		log.Printf("Track %d HLS path was empty in DB, but m3u8 may exist or was just generated. Using: %s", trackID, m3u8ServePath)
		track.HLSPlaylistPath = m3u8ServePath
		// Optionally update DB here if it was missing and file found
		if track.Duration == 0 {
			// If duration also missing, try to get it and update db
			duration, durErr := h.ap.GetAudioDuration(track.FilePath)
			if durErr == nil && duration > 0 {
				h.repo.UpdateTrackHLSPath(trackID, m3u8ServePath, duration) // Update with duration too
				track.Duration = duration
			}
		}
	}

	w.Header().Set("Access-Control-Allow-Origin", "*") // For HLS.js/cross-origin playback
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	http.ServeFile(w, r, m3u8DiskPath)
	log.Printf("Served HLS playlist %s for track ID %d", m3u8DiskPath, trackID)
}
