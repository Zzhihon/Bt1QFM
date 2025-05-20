package audio

// Processor defines the interface for audio processing operations.
type Processor interface {
	// ProcessToHLS transcodes an input audio file to HLS format (AAC).
	// inputFile: path to the source audio file.
	// outputPlaylistPath: full path where the .m3u8 playlist should be saved.
	// outputSegmentPatternPath: full path pattern for .ts segments (e.g., "path/to/segments/segment_%03d.ts").
	// bitrate: target audio bitrate (e.g., "192k").
	// segmentTime: duration of each HLS segment in seconds.
	ProcessToHLS(inputFile, outputPlaylistPath, outputSegmentPatternPath, bitrate string, segmentTime int) error
}
