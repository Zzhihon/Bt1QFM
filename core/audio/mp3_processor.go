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

// MP3Processor 处理网易云音乐的音频文件
type MP3Processor struct {
	ffmpegPath string
}

// NewMP3Processor 创建一个新的 MP3 处理器
func NewMP3Processor(ffmpegPath string) *MP3Processor {
	return &MP3Processor{ffmpegPath: ffmpegPath}
}

// ProcessToHLS 将 MP3 文件转换为 HLS 格式
func (p *MP3Processor) ProcessToHLS(inputFile, outputM3U8, segmentPattern, hlsBaseURL, audioBitrate, hlsSegmentTime string) (float32, error) {
	log.Printf("Processing Netease MP3 %s to HLS. Output M3U8: %s, Segments: %s, Base URL: %s",
		inputFile, outputM3U8, segmentPattern, hlsBaseURL)

	// 确保输出目录存在
	outputDir := filepath.Dir(outputM3U8)
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return 0, fmt.Errorf("failed to create output directory %s: %w", outputDir, err)
	}

	// 获取音频时长
	duration, err := p.GetAudioDuration(inputFile)
	if err != nil {
		log.Printf("Warning: could not get audio duration for %s: %v. Proceeding without duration.", inputFile, err)
	}

	// 构建 FFmpeg 参数
	args := []string{
		"-i", inputFile,
		"-c:a", "aac", // 使用 AAC 编码
		"-b:a", "192k", // 设置比特率为 192k
		"-ar", "44100", // 设置采样率为 44.1kHz
		"-ac", "2", // 设置为双声道
		"-vn",                 // 不处理视频
		"-map_metadata", "-1", // 移除元数据
		"-hls_time", "4", // 每个分片 4 秒
		"-hls_playlist_type", "vod",
		"-hls_list_size", "0", // 保留所有分片
		"-hls_segment_filename", segmentPattern,
		"-hls_base_url", hlsBaseURL,
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

	log.Printf("Successfully transcoded Netease MP3 %s to HLS: %s", inputFile, outputM3U8)
	return duration, nil
}

// GetAudioDuration 获取音频文件时长
func (p *MP3Processor) GetAudioDuration(inputFile string) (float32, error) {
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

	if err := cmd.Run(); err != nil {
		return 0, fmt.Errorf("ffprobe execution failed for %s: %w\nFFprobe Error: %s", inputFile, err, stderr.String())
	}

	var probeData struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}

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

// OptimizeMP3 优化 MP3 文件大小和质量
func (p *MP3Processor) OptimizeMP3(inputFile, outputFile string) error {
	args := []string{
		"-i", inputFile,
		"-c:a", "libmp3lame", // 使用 LAME 编码器
		"-q:a", "2", // 设置质量（0-9，2 是很好的平衡）
		"-ar", "44100", // 设置采样率
		"-ac", "2", // 双声道
		"-map_metadata", "-1", // 移除元数据
		outputFile,
	}

	cmd := exec.Command(p.ffmpegPath, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg execution failed for optimizing %s: %w\nFFmpeg Error: %s", inputFile, err, stderr.String())
	}

	return nil
}
