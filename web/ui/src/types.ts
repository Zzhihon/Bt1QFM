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