import React from 'react';
import { Music2, PlayCircle, Plus, Clock } from 'lucide-react';
import { usePlayer } from '../../contexts/PlayerContext';
import { Track } from '../../types';

// SongCard 的数据类型（来自后端 WebSocket）
export interface SongCardData {
  id: string;
  name: string;
  artists: string[];
  album: string;
  duration: number; // 毫秒
  coverUrl: string;
  hlsUrl: string;
  source: string;
}

interface SongCardProps {
  song: SongCardData;
  compact?: boolean; // 紧凑模式，用于聊天消息中
  onPlay?: () => void;
  onAdd?: () => void;
}

// 格式化时长（毫秒 -> mm:ss）
const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const SongCard: React.FC<SongCardProps> = ({ song, compact = false, onPlay, onAdd }) => {
  const { playerState, playTrack, addToPlaylist } = usePlayer();

  // 判断是否在播放列表中
  const inPlaylist = playerState.playlist.some(
    t => t.id === song.id || t.trackId === song.id
  );

  // 判断是否当前播放
  const isCurrentTrack = playerState.currentTrack && (
    playerState.currentTrack.id === song.id ||
    playerState.currentTrack.trackId === song.id
  );

  // 转换为 Track 类型
  const toTrack = (): Track => ({
    id: song.id,
    trackId: song.id,
    position: 0,
    title: song.name,
    artist: song.artists.join(' / '),
    album: song.album,
    coverArtPath: song.coverUrl,
    hlsPlaylistUrl: song.hlsUrl,
    duration: Math.floor(song.duration / 1000),
    source: song.source as 'netease' | 'local',
  });

  const handlePlay = async () => {
    const track = toTrack();
    playTrack(track);
    onPlay?.();

    // 后台请求初始化流
    try {
      const res = await fetch(song.hlsUrl, { method: 'GET' });
      if (!res.ok) throw new Error('音频流初始化失败');
    } catch (err) {
      console.error('播放失败', err);
    }
  };

  const handleAdd = () => {
    if (!inPlaylist) {
      addToPlaylist(toTrack());
      onAdd?.();
    }
  };

  if (compact) {
    // 紧凑模式：单行显示，用于聊天消息
    return (
      <div
        className={`flex items-center gap-3 p-2 rounded-lg bg-cyber-bg-darker/40 border border-cyber-secondary/20 hover:border-cyber-primary/40 transition-colors cursor-pointer ${
          isCurrentTrack ? 'ring-2 ring-cyber-primary' : ''
        }`}
        onClick={handlePlay}
      >
        {/* 封面 */}
        <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0">
          {song.coverUrl ? (
            <img
              src={song.coverUrl}
              alt={song.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-cyber-bg-darker flex items-center justify-center">
              <Music2 className="w-5 h-5 text-cyber-primary/50" />
            </div>
          )}
        </div>

        {/* 信息 */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-cyber-text truncate">{song.name}</p>
          <p className="text-xs text-cyber-secondary/70 truncate">{song.artists.join(' / ')}</p>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePlay();
            }}
            className="p-1.5 rounded-full hover:bg-cyber-primary/20 text-cyber-primary transition-colors"
            title="播放"
          >
            <PlayCircle className="w-5 h-5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleAdd();
            }}
            disabled={inPlaylist}
            className={`p-1.5 rounded-full transition-colors ${
              inPlaylist
                ? 'text-cyber-muted cursor-not-allowed'
                : 'hover:bg-cyber-secondary/20 text-cyber-secondary hover:text-cyber-primary'
            }`}
            title={inPlaylist ? '已在播放列表' : '添加到播放列表'}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // 标准模式：卡片显示
  return (
    <div
      className={`group relative overflow-hidden rounded-xl bg-cyber-bg-darker/50 border border-cyber-secondary/20 hover:border-cyber-primary/40 transition-all duration-300 cursor-pointer ${
        isCurrentTrack ? 'ring-2 ring-cyber-primary' : ''
      }`}
      onClick={handlePlay}
    >
      {/* 封面 */}
      <div className="relative aspect-square overflow-hidden">
        {song.coverUrl ? (
          <img
            src={song.coverUrl}
            alt={song.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full bg-cyber-bg-darker flex items-center justify-center">
            <Music2 className="w-12 h-12 text-cyber-primary/30" />
          </div>
        )}

        {/* 悬浮播放按钮 */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePlay();
            }}
            className="p-3 rounded-full bg-cyber-primary text-cyber-bg hover:scale-110 transition-transform"
          >
            <PlayCircle className="w-8 h-8" />
          </button>
        </div>

        {/* 时长标签 */}
        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/60 text-xs text-white flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDuration(song.duration)}
        </div>
      </div>

      {/* 信息 */}
      <div className="p-3">
        <p className="font-medium text-cyber-text truncate mb-1">{song.name}</p>
        <p className="text-sm text-cyber-secondary/70 truncate">{song.artists.join(' / ')}</p>
        {song.album && (
          <p className="text-xs text-cyber-secondary/50 truncate mt-1">{song.album}</p>
        )}
      </div>

      {/* 添加按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleAdd();
        }}
        disabled={inPlaylist}
        className={`absolute top-2 right-2 p-1.5 rounded-full backdrop-blur-sm transition-all ${
          inPlaylist
            ? 'bg-cyber-muted/20 text-cyber-muted cursor-not-allowed'
            : 'bg-black/40 text-white hover:bg-cyber-primary hover:text-cyber-bg'
        }`}
        title={inPlaylist ? '已在播放列表' : '添加到播放列表'}
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
};

export default SongCard;
