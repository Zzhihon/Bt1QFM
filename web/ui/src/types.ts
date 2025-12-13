export interface Track {
  id: string | number;
  title: string;
  artist: string;
  album?: string;
  coverArtPath?: string;
  hlsPlaylistUrl?: string;
  url?: string;
  filePath?: string;
  position?: number;
  source: 'netease' | 'local'; // 修改为必需字段
}

export interface PlaylistItem {
  id: string;
  trackId?: string;
  neteaseId?: string;
  title: string;
  artist: string;
  album?: string;
  coverArtPath?: string;
  position: number;
  source: 'netease' | 'local'; // 修改为必需字段
}

export enum PlayMode {
  SEQUENTIAL = 'sequential',
  REPEAT_ALL = 'repeat_all',
  REPEAT_ONE = 'repeat_one',
  SHUFFLE = 'shuffle'
}

export interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  currentTime: number;
  duration: number;
  playMode: PlayMode;
  playlist: Track[];
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
  | 'playlist'
  | 'mode_sync'
  | 'transfer_owner'
  | 'grant_control'
  | 'role_update';

// WebSocket 消息
export interface RoomWSMessage {
  type: RoomWSMessageType;
  roomId?: string;
  userId?: number;
  username?: string;
  data?: unknown;
  timestamp: number;
} 