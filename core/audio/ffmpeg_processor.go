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

// getAudioFormat 获取音频文件的格式
func (p *FFmpegProcessor) getAudioFormat(inputFile string) (string, error) {
	ffprobePath := strings.Replace(p.ffmpegPath, "ffmpeg", "ffprobe", 1)

	args := []string{
		"-v", "error",
		"-select_streams", "a:0",
		"-show_entries", "stream=codec_name",
		"-of", "json",
		inputFile,
	}

	cmd := exec.Command(ffprobePath, args...)
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("ffprobe execution failed for %s: %w\nFFprobe Error: %s", inputFile, err, stderr.String())
	}

	var probeData struct {
		Streams []struct {
			CodecName string `json:"codec_name"`
		} `json:"streams"`
	}

	if err := json.Unmarshal(out.Bytes(), &probeData); err != nil {
		return "", fmt.Errorf("failed to unmarshal ffprobe output: %w", err)
	}

	if len(probeData.Streams) == 0 {
		return "", fmt.Errorf("no audio streams found in file")
	}

	return probeData.Streams[0].CodecName, nil
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
	}

	// 获取音频格式
	format, err := p.getAudioFormat(inputFile)
	if err != nil {
		log.Printf("Warning: could not detect audio format for %s: %v. Using default settings.", inputFile, err)
	}

	// 构建FFmpeg参数
	args := []string{
		"-i", inputFile,
		"-c:a", "aac",
	}

	// 根据输入格式调整编码参数
	if format == "flac" {
		// 对于FLAC文件，使用更高的比特率以保持音质
		args = append(args, "-b:a", "320k")
		// 添加音频过滤器以优化FLAC转码
		args = append(args, "-af", "aformat=sample_fmts=fltp")
	} else {
		// 其他格式使用配置的比特率
		args = append(args, "-b:a", audioBitrate)
	}

	// 添加HLS相关参数
	args = append(args,
		"-hls_time", hlsSegmentTime,
		"-hls_playlist_type", "vod",
		"-hls_list_size", "0",
		"-hls_segment_filename", segmentPattern,
		"-hls_base_url", hlsBaseURL,
		"-f", "hls",
		outputM3U8,
	)

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
