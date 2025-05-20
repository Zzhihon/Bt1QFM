package config

// Config stores application configuration.
// For V1, these are mostly hardcoded or have simple defaults.
type Config struct {
	FFmpegPath     string
	AudioBitrate   string // e.g., "192k"
	HLSSegmentTime int    // in seconds
	SourceAudioDir string // Directory where WAV files are stored
	StaticDir      string // Directory to store HLS streams
	WebAppDir      string // Directory for web app files
}

// LoadConfig loads configuration. For V1, returns default values.
func LoadConfig() *Config {
	return &Config{
		// !!! IMPORTANT: Replace "ffmpeg" with the FULL path to your ffmpeg.exe if it's not in PATH
		// Example for Windows: FFmpegPath: "C:/Program Files/ffmpeg/bin/ffmpeg.exe",
		// Or using escaped backslashes: FFmpegPath: "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
		FFmpegPath:     "ffmpeg", // <- MODIFY THIS LINE if needed
		AudioBitrate:   "192k",
		HLSSegmentTime: 10,
		SourceAudioDir: ".",      // Assuming WAVs are in the Bt1QFM project root for now
		StaticDir:      "static", // For HLS segments and other static content
		WebAppDir:      "web/ui",
	}
}
