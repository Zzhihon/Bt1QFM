export interface User {
  id: number | string;
  username: string;
  email: string;
  phone?: string;
  createdAt?: string;
}

export interface Track {
  id: string | number; // Assuming backend might use string like "cd_track_12" or a numeric ID
  trackId?: string | number; // Additional ID field that might be used by the backend
  position: number; // Position in the playlist (0-based index)
  title: string;
  artist?: string;
  album?: string;
  coverArtPath?: string; 
  filePath?: string; // Path to the original audio file if needed by backend
  hlsPlaylistUrl?: string; // To construct `/stream/{id}/playlist.m3u8`
  userId?: number; // If tracks are user-specific
  duration?: number; // Track duration in seconds
}

export interface ApiResponseError {
  error: string;
}

export interface UploadResponse {
  message: string;
  trackId: string | number;
} 

// 播放列表项类型
export interface PlaylistItem extends Track {
  position: number; // 在播放列表中的位置
  trackId?: string | number; // API返回的歌曲ID字段
}

// 播放模式
export enum PlayMode {
  SEQUENTIAL = 'sequential', // 顺序播放
  REPEAT_ALL = 'repeat_all', // 循环播放所有
  REPEAT_ONE = 'repeat_one', // 单曲循环
  SHUFFLE = 'shuffle',       // 随机播放
}

// 播放列表响应类型
export interface PlaylistResponse {
  playlist: PlaylistItem[];
}

// 播放器状态
export interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  currentTime: number;
  duration: number;
  playMode: PlayMode;
  playlist: PlaylistItem[];
}

// 专辑类型
export interface Album {
  id: number;
  userId: number;
  artist: string;
  name: string;
  coverPath?: string;
  releaseTime: string;
  genre?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  tracks?: Track[]; // 专辑中的歌曲
}

// 专辑创建请求
export interface CreateAlbumRequest {
  artist: string;
  name: string;
  coverPath?: string;
  releaseTime: string;
  genre?: string;
  description?: string;
}

// 专辑更新请求
export interface UpdateAlbumRequest extends Partial<CreateAlbumRequest> {
  id: number;
}

// 专辑响应
export interface AlbumResponse {
  album: Album;
}

// 专辑列表响应
export interface AlbumsResponse {
  albums: Album[];
} 