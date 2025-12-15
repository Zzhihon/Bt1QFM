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

// 播放列表来源
export type PlaylistSource = 'personal' | 'room';

// 房间播放列表权限
export interface RoomPlaylistPermissions {
  isOwner: boolean;
  canControl: boolean;
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
  // HLS 转码状态
  isTranscoding?: boolean; // 是否正在转码
  estimatedDuration?: number; // 预估总时长（转码中使用）
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

// ========== 房间系统类型 ==========

// 房间信息
export interface Room {
  id: string;
  name: string;
  ownerId: number;
  maxMembers: number;
  status: 'active' | 'closed';
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

// 房间成员
export interface RoomMember {
  id: number;
  roomId: string;
  userId: number;
  role: 'owner' | 'admin' | 'member';
  mode: 'chat' | 'listen';
  canControl: boolean;
  joinedAt: string;
  leftAt?: string;
}

// 在线成员（Redis 缓存）
export interface RoomMemberOnline {
  userId: number;
  username: string;
  avatar?: string;
  role: 'owner' | 'admin' | 'member';
  mode: 'chat' | 'listen';
  canControl: boolean;
  joinedAt: number;
}

// 房间完整信息
export interface RoomInfo extends Room {
  ownerName: string;
  memberCount: number;
  members: RoomMemberOnline[];
}

// 房间播放状态
export interface RoomPlaybackState {
  currentIndex: number;
  currentSong?: RoomPlaylistItem;
  position: number;
  isPlaying: boolean;
  updatedAt: number;
  updatedBy: number;
}

// 房间歌单项
export interface RoomPlaylistItem {
  songId: string;
  name: string;
  artist: string;
  cover?: string;
  duration?: number;
  source?: string;
  hlsUrl?: string;  // HLS 播放地址
  position: number;
  addedBy: number;
  addedAt: number;
}

// 房间消息
export interface RoomMessage {
  id: number;
  roomId: string;
  userId: number;
  content: string;
  messageType: 'text' | 'system' | 'song_add';
  createdAt: string;
}

// WebSocket 消息类型
export type RoomWSMessageType =
  | 'join'
  | 'leave'
  | 'error'
  | 'ping'
  | 'pong'
  | 'sync'
  | 'member_list'
  | 'chat'
  | 'play'
  | 'pause'
  | 'seek'
  | 'next'
  | 'prev'
  | 'playback'
  | 'song_add'
  | 'song_del'
  | 'song_search'
  | 'song_play'       // 播放歌曲（添加到歌单并播放）
  | 'playlist'
  | 'mode_sync'
  | 'transfer_owner'
  | 'grant_control'
  | 'role_update'
  | 'master_sync'     // 房主播放状态同步（服务端 -> 听歌用户）
  | 'master_report'   // 房主上报播放状态（房主 -> 服务端）
  | 'master_request'  // 请求房主播放状态（用户 -> 服务端 -> 房主）
  | 'master_mode'     // 房主模式变更通知
  | 'room_disband'    // 房间解散通知
  | 'song_change'     // 切歌同步（有权限用户切歌后广播给所有 listen 用户）
  | 'playlist_reorder'; // 歌单重排序

// 房主播放同步数据
export interface MasterSyncData {
  songId: string;
  songName: string;
  artist: string;
  cover?: string;
  duration: number;      // 毫秒
  position: number;      // 秒
  isPlaying: boolean;
  hlsUrl?: string;
  serverTime: number;    // 毫秒
  masterId: number;
  masterName: string;
}

// 房主模式变更数据
export interface MasterModeData {
  mode: 'chat' | 'listen';
}

// 切歌同步数据（有权限用户切歌后广播给所有 listen 用户）
export interface SongChangeData {
  songId: string;
  songName: string;
  artist: string;
  cover: string;
  duration: number;      // 毫秒
  hlsUrl: string;
  position: number;      // 秒（从哪个位置开始播放）
  isPlaying: boolean;
  changedBy: number;     // 切歌用户ID
  changedByName: string; // 切歌用户名
  timestamp: number;     // 时间戳
}

// WebSocket 消息
export interface RoomWSMessage {
  type: RoomWSMessageType;
  roomId?: string;
  userId?: number;
  username?: string;
  data?: unknown;
  timestamp: number;
}