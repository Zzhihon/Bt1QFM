package audio

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// FFmpegProcessor implements the Processor interface using FFmpeg.
type FFmpegProcessor struct {
	ffmpegPath string
}

// NewFFmpegProcessor creates a new FFmpegProcessor.
func NewFFmpegProcessor(ffmpegPath string) *FFmpegProcessor {
	return &FFmpegProcessor{ffmpegPath: ffmpegPath}
}

// ProcessToHLS transcodes an input audio file to HLS format (AAC).
func (p *FFmpegProcessor) ProcessToHLS(inputFile, outputPlaylistPath, outputSegmentPatternPath, bitrate string, segmentTime int) error {
	outputDir := filepath.Dir(outputPlaylistPath) // e.g., "static/streams/cd_track_12"
	if err := os.MkdirAll(outputDir, os.ModePerm); err != nil {
		return fmt.Errorf("failed to create output directory %s: %w", outputDir, err)
	}

	// hlsBaseUrl is the URL prefix for segments in the M3U8 file.
	// It must be an absolute path from the client's perspective, matching the static server route.
	trackID := filepath.Base(outputDir) // outputDir is 'static/streams/trackID'
	hlsBaseUrl := fmt.Sprintf("/static/streams/%s/", trackID)

	// outputSegmentPatternPath is already the full disk path for segments,
	// e.g., "static/streams/cd_track_12/segment_%03d.ts" (relative to project root)
	// or an absolute disk path if constructed that way.
	// FFmpeg should use the basename of this for M3U8 when -hls_base_url is also used.

	args := []string{
		"-i", inputFile,
		"-y", // Overwrite output files without asking
		"-c:a", "aac",
		"-b:a", bitrate,
		"-hls_time", fmt.Sprintf("%d", segmentTime),
		"-hls_playlist_type", "vod",
		"-hls_list_size", "0",
		"-hls_base_url", hlsBaseUrl, // URL prefix: /static/streams/cd_track_12/
		"-hls_segment_filename", outputSegmentPatternPath, // Full disk path pattern for writing .ts files
		outputPlaylistPath, // Full path to M3U8
	}

	cmd := exec.Command(p.ffmpegPath, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	fmt.Printf("Executing FFmpeg: %s %v\n", p.ffmpegPath, args)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg execution failed: %w", err)
	}

	fmt.Printf("FFmpeg HLS processing complete for %s\n", inputFile)
	return nil
}
