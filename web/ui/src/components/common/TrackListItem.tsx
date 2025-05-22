import React from 'react';
import { Track } from '../../types';
import { Music2, PlayCircle, PauseCircle, Plus } from 'lucide-react';
import { usePlayer } from '../../contexts/PlayerContext';

interface TrackListItemProps {
  track: Track;
  isActive?: boolean;
}

const TrackListItem: React.FC<TrackListItemProps> = ({ track, isActive }) => {
  const { playerState, playTrack, addToPlaylist } = usePlayer();

  // 判断是否在播放列表中
  const inPlaylist = playerState.playlist.some(
    t => t.id === track.id || t.trackId === track.id
  );
  // 判断是否当前选中（不管是否正在播放）
  const isSelected = isActive || (playerState.currentTrack && (playerState.currentTrack.id === track.id || playerState.currentTrack.trackId === track.id));
  // 判断是否当前播放
  const isPlaying = isSelected && playerState.isPlaying;

  // 优化：点击时立即高亮，再异步 fetch m3u8
  const handlePlay = async () => {
    const hlsUrl = track.hlsPlaylistUrl || `/stream/${track.id}/playlist.m3u8`;
    // 1. 立即高亮
    playTrack({ ...track, hlsPlaylistUrl: hlsUrl });
    // 2. 后台请求
    try {
      const res = await fetch(hlsUrl, { method: 'GET' });
      if (!res.ok) throw new Error('音频流初始化失败');
      // 成功无需处理
    } catch (err) {
      // 可选：失败时回退或提示
      // playTrack(null);
      // addToast('无法播放该歌曲', 'error');
      console.error('播放失败', err);
    }
  };

  return (
    <div
      className={`flex items-center justify-between p-3 bg-cyber-bg rounded hover:bg-cyber-hover-secondary transition-colors cursor-pointer ${isSelected ? 'ring-2 ring-cyber-primary' : ''}`}
      onClick={handlePlay}
    >
      <div className="flex items-center space-x-4">
        {track.coverArtPath ? (
          <img
            src={track.coverArtPath}
            alt={track.title}
            className="h-10 w-10 object-cover rounded"
          />
        ) : (
          <Music2 className="h-5 w-5 text-cyber-primary" />
        )}
        <div>
          <p className="text-cyber-secondary font-medium">{track.title}</p>
          <p className="text-sm text-cyber-muted">{track.artist || ''}</p>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        {isPlaying ? (
          <PauseCircle className="h-6 w-6 text-cyber-primary" />
        ) : (
          <PlayCircle className="h-6 w-6 text-cyber-primary" />
        )}
        <button
          className={`p-2 rounded-full ${inPlaylist ? 'text-cyber-muted cursor-not-allowed' : 'text-cyber-secondary hover:text-cyber-primary'}`}
          disabled={inPlaylist}
          onClick={e => {
            e.stopPropagation();
            if (!inPlaylist) addToPlaylist(track);
          }}
          title={inPlaylist ? '已在播放列表' : '加入播放列表'}
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default TrackListItem; 