export interface User {
  id: number | string;
  username: string;
  email: string;
  phone?: string;
  neteaseUsername?: string;  // 网易云用户名
  neteaseUID?: string;       // 网易云用户UID
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
  hlsPlaylistUrl?: string; // To construct `/streams/{id}/playlist.m3u8`
  url?: string; // Direct URL for external audio sources (e.g., Netease Music)
  userId?: number; // If tracks are user-specific
  neteaseId?: number; // Netease Music song ID
  duration?: number; // Track duration in seconds
  source?: 'netease' | 'local'; // Track source type
  createdAt?: string;
  updatedAt?: string;
  hlsPlaylistPath?: string;
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

// 歌词相关类型
export interface LyricUser {
  id: number;
  status: number;
  demand: number;
  userid: number;
  nickname: string;
  uptime: number;
}

export interface LyricData {
  version: number;
  lyric: string;
}

export interface LyricResponse {
  sgc: boolean;
  sfy: boolean;
  qfy: boolean;
  code: number;
  transUser?: LyricUser;
  lyricUser?: LyricUser;
  lrc: LyricData;
  tlyric?: LyricData;
  romalrc?: LyricData;
  yrc?: LyricData;        // 逐字歌词
  ytlrc?: LyricData;      // 逐字翻译歌词
  yromalrc?: LyricData;   // 逐字罗马音歌词
  klyric?: LyricData;     // 卡拉OK歌词
}

// 解析后的歌词行
export interface ParsedLyricLine {
  time: number;           // 开始时间（毫秒）
  duration: number;       // 持续时间（毫秒）
  text: string;          // 歌词文本
  words?: ParsedWord[];   // 逐字信息（仅yrc格式）
  translation?: string;   // 翻译文本
  roma?: string;         // 罗马音文本
}

// 逐字信息
export interface ParsedWord {
  time: number;          // 开始时间（毫秒）
  duration: number;      // 持续时间（毫秒/厘秒）
  text: string;         // 文字
}

// 歌词元数据
export interface LyricMetadata {
  title?: string;
  artist?: string;
  album?: string;
  composer?: string;
  lyricist?: string;
  contributors?: {
    lyricUser?: LyricUser;
    transUser?: LyricUser;
  };
}