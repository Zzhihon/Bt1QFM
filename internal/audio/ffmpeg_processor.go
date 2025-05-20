package audio

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// FFmpegProcessor implements the Processor interface using ffmpeg.
type FFmpegProcessor struct {
	ffmpegPath string
}

// NewFFmpegProcessor creates a new FFmpegProcessor.
func NewFFmpegProcessor(ffmpegPath string) *FFmpegProcessor {
	return &FFmpegProcessor{ffmpegPath: ffmpegPath}
}

// ProcessToHLS transcodes an audio file to HLS format (M3U8 playlist and TS segments).
// It returns the duration of the audio file in seconds.
func (p *FFmpegProcessor) ProcessToHLS(inputFile, outputM3U8, segmentPattern, hlsBaseURL, audioBitrate, hlsSegmentTime string) (float32, error) {
	log.Printf("Processing %s to HLS. Output M3U8: %s, Segments: %s, Base URL: %s", inputFile, outputM3U8, segmentPattern, hlsBaseURL)

	// Ensure output directory for M3U8 exists
	outputDir := filepath.Dir(outputM3U8)
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return 0, fmt.Errorf("failed to create output directory %s: %w", outputDir, err)
	}

	// Get audio duration first
	duration, err := p.GetAudioDuration(inputFile)
	if err != nil {
		log.Printf("Warning: could not get audio duration for %s: %v. Proceeding without duration.", inputFile, err)
		// You might choose to return an error here if duration is critical for your HLS settings
		// or use a default/placeholder if HLS generation can proceed without it.
	}

	args := []string{
		"-i", inputFile,
		"-c:a", "aac",
		"-b:a", audioBitrate,
		"-hls_time", hlsSegmentTime,
		"-hls_playlist_type", "vod", // Video on Demand type, segments won't be removed
		"-hls_list_size", "0", // Keep all segments in the playlist
		"-hls_segment_filename", segmentPattern, // e.g., static/streams/track123/segment_%03d.ts
		"-hls_base_url", hlsBaseURL, // e.g., /static/streams/track123/
		"-f", "hls",
		outputM3U8,
	}

	cmd := exec.Command(p.ffmpegPath, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	log.Printf("Executing FFmpeg command: %s %s", p.ffmpegPath, strings.Join(args, " "))

	if err := cmd.Run(); err != nil {
		return 0, fmt.Errorf("ffmpeg execution failed for %s: %w\nFFmpeg Error: %s", inputFile, err, stderr.String())
	}

	log.Printf("Successfully transcoded %s to HLS: %s", inputFile, outputM3U8)
	return duration, nil
}

// ffprobeOutput defines the structure for ffprobe JSON output.
type ffprobeOutput struct {
	Format struct {
		Duration string `json:"duration"`
	} `json:"format"`
}

// GetAudioDuration uses ffprobe to get the duration of an audio file in seconds.
func (p *FFmpegProcessor) GetAudioDuration(inputFile string) (float32, error) {
	ffprobePath := strings.Replace(p.ffmpegPath, "ffmpeg", "ffprobe", 1)

	args := []string{
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "json",
		inputFile,
	}

	cmd := exec.Command(ffprobePath, args...)
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	// log.Printf("Executing FFprobe command: %s %s", ffprobePath, strings.Join(args, " "))

	if err := cmd.Run(); err != nil {
		return 0, fmt.Errorf("ffprobe execution failed for %s: %w\nFFprobe Error: %s", inputFile, err, stderr.String())
	}

	var probeData ffprobeOutput
	if err := json.Unmarshal(out.Bytes(), &probeData); err != nil {
		return 0, fmt.Errorf("failed to unmarshal ffprobe output for %s: %w\nFFprobe Output: %s", inputFile, err, out.String())
	}

	if probeData.Format.Duration == "" {
		return 0, fmt.Errorf("duration not found in ffprobe output for %s\nFFprobe Output: %s", inputFile, out.String())
	}

	duration, err := strconv.ParseFloat(probeData.Format.Duration, 32)
	if err != nil {
		return 0, fmt.Errorf("failed to parse duration string \"%s\" for %s: %w", probeData.Format.Duration, inputFile, err)
	}

	return float32(duration), nil
}
