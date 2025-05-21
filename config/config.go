package config

import (
	"log"
	"os"
	"path/filepath"
	"strconv"

	"github.com/joho/godotenv"
)

// Config stores the application configuration.
// For V1, these are mostly hardcoded or have simple defaults.
type Config struct {
	FFmpegPath     string
	AudioBitrate   string // e.g., "192k"
	HLSSegmentTime string
	SourceAudioDir string // Base directory for storing original uploaded audio files
	StaticDir      string // Root directory for serving static files (HLS streams, covers)
	WebAppDir      string // Path to the web application's UI files
	DBHost         string
	DBPort         string
	DBUser         string
	DBPassword     string
	DBName         string
	UploadDir      string // Base directory for all uploads
	AudioUploadDir string // Subdirectory for audio files: UploadDir/audio
	CoverUploadDir string // Subdirectory for cover art: UploadDir/covers
	// Redis配置
	RedisHost     string
	RedisPort     string
	RedisPassword string
	RedisDB       int
}

// getEnv gets an environment variable or returns a default value.
func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

// getEnvInt gets an environment variable as int or returns a default value.
func getEnvInt(key string, fallback int) int {
	if value, exists := os.LookupEnv(key); exists {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return fallback
}

// Load loads configuration from environment variables (via .env file) or defaults.
func Load() *Config {
	// Attempt to load .env file. godotenv.Load() will not override existing env vars.
	err := godotenv.Load() // Loads .env file from the current directory
	if err != nil {
		log.Println("No .env file found or error loading .env, relying on existing environment variables and defaults.")
	}

	ffmpegPath := getEnv("FFMPEG_PATH", "ffmpeg")
	uploadBase := "uploads"
	staticBase := "static"

	return &Config{
		FFmpegPath:     ffmpegPath,
		AudioBitrate:   getEnv("AUDIO_BITRATE", "192k"),
		HLSSegmentTime: getEnv("HLS_SEGMENT_TIME", "10"),
		SourceAudioDir: filepath.Join(uploadBase, "audio"), // Will be created if not exists
		StaticDir:      staticBase,
		WebAppDir:      filepath.Join("web", "ui"),
		DBHost:         getEnv("DB_HOST", "127.0.0.1"), // Default to localhost if not set
		DBPort:         getEnv("DB_PORT", "3306"),      // Default to standard MySQL port
		DBUser:         getEnv("DB_USER", "root"),
		DBPassword:     os.Getenv("DB_PASSWORD"), // For password, better not to have a hardcoded default
		DBName:         getEnv("DB_NAME", "fm"),
		UploadDir:      uploadBase,
		AudioUploadDir: filepath.Join(uploadBase, "audio"),
		CoverUploadDir: filepath.Join(uploadBase, "covers"),
		// Redis配置，使用默认值
		RedisHost:     getEnv("REDIS_HOST", "127.0.0.1"),
		RedisPort:     getEnv("REDIS_PORT", "6379"),
		RedisPassword: getEnv("REDIS_PASSWORD", ""), // 默认无密码
		RedisDB:       getEnvInt("REDIS_DB", 0),     // 默认使用0号数据库
	}
}
