export interface User {
  id: number | string;
  username: string;
  email: string;
  phone?: string;
  createdAt?: string;
}

export interface Track {
  id: string | number; // Assuming backend might use string like "cd_track_12" or a numeric ID
  title: string;
  artist?: string;
  album?: string;
  coverArtPath?: string; 
  filePath?: string; // Path to the original audio file if needed by backend
  hlsPlaylistUrl?: string; // To construct `/stream/{id}/playlist.m3u8`
  userId?: number; // If tracks are user-specific
}

export interface ApiResponseError {
  error: string;
}

export interface UploadResponse {
  message: string;
  trackId: string | number;
} 