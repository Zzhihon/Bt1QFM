package audio

// Processor defines an interface for audio processing operations.
type Processor interface {
	ProcessToHLS(inputFile, outputM3U8, segmentPattern, hlsBaseURL, audioBitrate, hlsSegmentTime string) (float32, error)
	GetAudioDuration(inputFile string) (float32, error)
}
