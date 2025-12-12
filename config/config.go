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
	// MinIO配置
	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	MinioBucket    string
	MinioRegion    string
	MinioUseSSL    bool
	MinioAPI       string // S3 API 版本
	MinioPath      string // 路径样式
	// 网易云音乐API配置
	NeteaseAPIURL string `env:"NETEASE_API_URL" default:"http://localhost:3000"`
	// AI Agent 配置
	AgentAPIBaseURL  string
	AgentAPIKey      string
	AgentModel       string
	AgentMaxTokens   int
	AgentTemperature float64
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

// getEnvFloat gets an environment variable as float64 or returns a default value.
func getEnvFloat(key string, fallback float64) float64 {
	if value, exists := os.LookupEnv(key); exists {
		if floatVal, err := strconv.ParseFloat(value, 64); err == nil {
			return floatVal
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
		// MinIO配置
		MinioEndpoint:  getEnv("MINIO_ENDPOINT", ""),
		MinioAccessKey: getEnv("MINIO_ACCESS_KEY", ""),
		MinioSecretKey: getEnv("MINIO_SECRET_KEY", ""),
		MinioBucket:    getEnv("MINIO_BUCKET", ""),
		MinioRegion:    getEnv("MINIO_REGION", ""),
		MinioUseSSL:    getEnv("MINIO_USE_SSL", "true") == "true",
		MinioAPI:       getEnv("MINIO_API", "s3v4"),
		MinioPath:      getEnv("MINIO_PATH", "auto"),
		// 网易云音乐API配置
		NeteaseAPIURL: getEnv("NETEASE_API_URL", "http://localhost:3000"), // 默认使用本地代理
		// AI Agent 配置
		AgentAPIBaseURL:  getEnv("AGENT_API_BASE_URL", "https://one-api.ygxz.in/v1"),
		AgentAPIKey:      getEnv("AGENT_API_KEY", ""),
		AgentModel:       getEnv("AGENT_MODEL", "gpt5"),
		AgentMaxTokens:   getEnvInt("AGENT_MAX_TOKENS", 2000),
		AgentTemperature: getEnvFloat("AGENT_TEMPERATURE", 0.7),
	}
}
