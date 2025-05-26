import React, { useEffect, useRef } from 'react';
import { 
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Repeat, Shuffle,
  Loader2, ListMusic, X, Trash2, Music2, ArrowRight
} from 'lucide-react';
import { PlayMode } from '../../types';
import { usePlayer } from '../../contexts/PlayerContext';
import Hls from 'hls.js';

const Player: React.FC = () => {
  const {
    playerState,
    audioRef,
    togglePlayPause,
    handlePrevious,
    handleNext,
    toggleMute,
    setVolume,
    togglePlayMode,
    seekTo,
    removeFromPlaylist,
    clearPlaylist,
    shufflePlaylist,
    addAllTracksToPlaylist,
    playTrack,
    isLoadingPlaylist,
    showPlaylist,
    setShowPlaylist
  } = usePlayer();
  
  // 初始化HLS实例
  const hlsInstanceRef = useRef<Hls | null>(null);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 3;

  // 当currentTrack改变时更新HLS源
  useEffect(() => {
    if (playerState.currentTrack && audioRef.current) {
      console.log('当前播放曲目:', playerState.currentTrack);
      
      // 添加音频加载事件监听
      audioRef.current.onloadeddata = () => {
        console.log('音频数据已加载');
      };

      audioRef.current.onerror = (e) => {
        console.error('音频加载错误:', e);
      };
    }
  }, [playerState.currentTrack]);
  
  // 处理时间轨道点击
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.min(Math.max(0, e.clientX - rect.left), rect.width) / rect.width;
    const time = percent * playerState.duration;
    seekTo(time);
  };
  
  // 格式化时间
  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' + sec : sec}`;
  };
  
  // 获取播放模式的图标和文字
  const getPlayModeInfo = () => {
    switch (playerState.playMode) {
      case PlayMode.REPEAT_ALL:
        return { icon: <Repeat className="h-5 w-5" />, text: '列表循环' };
      case PlayMode.REPEAT_ONE:
        return { 
          icon: <div className="relative">
            <Repeat className="h-5 w-5" />
            <span className="absolute text-[10px] font-bold top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">1</span>
          </div>, 
          text: '单曲循环' 
        };
      case PlayMode.SHUFFLE:
        return { icon: <Shuffle className="h-5 w-5" />, text: '随机播放' };
      case PlayMode.SEQUENTIAL:
      default:
        return { 
          icon: <div className="flex items-center">
            <ArrowRight className="h-5 w-5" />
            <ArrowRight className="h-5 w-5 -ml-2" />
          </div>, 
          text: '顺序播放' 
        };
    }
  };
  
  const playModeInfo = getPlayModeInfo();
  
  return (
    <>
      {/* 主播放器控件 - 底部固定 */}
      <div className="fixed bottom-0 left-0 right-0 bg-cyber-bg-darker border-t-2 border-cyber-primary p-3 z-50">
        <div className="max-w-7xl mx-auto px-4">
          {/* 进度条 */}
          <div 
            className="w-full h-3 bg-cyber-bg rounded-full mb-3 cursor-pointer relative overflow-hidden"
            onClick={handleProgressClick}
          >
            <div 
              className="h-full bg-gradient-to-r from-cyber-primary to-cyber-secondary rounded-full relative"
              style={{ width: `${playerState.duration ? (playerState.currentTime / playerState.duration) * 100 : 0}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-cyber-primary rounded-full shadow-lg shadow-cyber-primary/50"></div>
            </div>
          </div>
          
          <div className="flex items-center justify-between py-2">
            {/* 当前播放信息 */}
            <div className="flex items-center w-1/3">
              {playerState.currentTrack ? (
                <>
                  <div className="w-14 h-14 bg-cyber-bg rounded mr-3 flex-shrink-0 overflow-hidden">
                    {playerState.currentTrack.coverArtPath ? (
                      <img 
                        src={playerState.currentTrack.coverArtPath} 
                        alt="Cover" 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music2 className="text-cyber-primary h-7 w-7" />
                      </div>
                    )}
                  </div>
                  <div className="truncate">
                    <div className="text-cyber-primary font-medium truncate text-base">{playerState.currentTrack.title}</div>
                    <div className="text-cyber-secondary text-sm truncate">
                      {playerState.currentTrack.artist || 'Unknown Artist'}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-cyber-secondary">未选择歌曲</div>
              )}
            </div>
            
            {/* 播放控制 */}
            <div className="flex items-center justify-center space-x-6">
              <button 
                onClick={handlePrevious} 
                className="text-cyber-secondary hover:text-cyber-primary transition-colors"
                disabled={playerState.playlist.length < 2}
              >
                <SkipBack className="h-7 w-7" />
              </button>
              
              <button 
                onClick={togglePlayPause}
                className="bg-cyber-primary rounded-full p-3 text-cyber-bg-darker hover:bg-cyber-hover-primary transition-colors"
              >
                {playerState.isPlaying ? (
                  <Pause className="h-7 w-7" />
                ) : (
                  <Play className="h-7 w-7" />
                )}
              </button>
              
              <button 
                onClick={handleNext} 
                className="text-cyber-secondary hover:text-cyber-primary transition-colors"
                disabled={playerState.playlist.length < 2}
              >
                <SkipForward className="h-7 w-7" />
              </button>
            </div>
            
            {/* 额外控制：音量、播放模式、播放列表按钮 */}
            <div className="flex items-center justify-end w-1/3 space-x-6">
              {/* 时间显示 */}
              <div className="text-sm text-cyber-secondary hidden sm:block">
                {formatTime(playerState.currentTime)} / {formatTime(playerState.duration)}
              </div>
              
              {/* 音量控制 */}
              <div className="flex items-center space-x-2">
                <button onClick={toggleMute} className="text-cyber-secondary hover:text-cyber-primary transition-colors">
                  {playerState.muted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
                </button>
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.01" 
                  value={playerState.muted ? 0 : playerState.volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-20 [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-cyber-bg [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyber-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-cyber-primary/50 [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-cyber-bg [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-cyber-primary [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-lg [&::-moz-range-thumb]:shadow-cyber-primary/50"
                />
              </div>
              
              {/* 播放模式 */}
              <button 
                onClick={togglePlayMode} 
                className="text-cyber-secondary hover:text-cyber-primary transition-colors"
                title={playModeInfo.text}
              >
                {playModeInfo.icon}
              </button>
              
              {/* 播放列表按钮 */}
              <button 
                onClick={() => setShowPlaylist(!showPlaylist)} 
                className={`text-cyber-secondary hover:text-cyber-primary transition-colors ${showPlaylist ? 'text-cyber-primary' : ''}`}
              >
                <ListMusic className="h-6 w-6" />
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* 播放列表抽屉 */}
      {showPlaylist && (
        <div className="fixed bottom-24 right-4 w-full md:w-96 bg-cyber-bg-darker border-2 border-cyber-primary rounded-lg shadow-lg p-4 z-40">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-cyber-primary">播放列表 ({playerState.playlist.length})</h3>
            <div className="flex space-x-2">
              <button 
                onClick={addAllTracksToPlaylist}
                disabled={isLoadingPlaylist}
                className="text-xs border border-cyber-secondary text-cyber-secondary px-2 py-1 rounded hover:bg-cyber-secondary hover:text-cyber-bg-darker transition-colors"
              >
                {isLoadingPlaylist ? <Loader2 className="h-3 w-3 animate-spin" /> : '添加全部'}
              </button>
              <button 
                onClick={clearPlaylist}
                disabled={playerState.playlist.length === 0}
                className="text-xs border border-cyber-red text-cyber-red px-2 py-1 rounded hover:bg-cyber-red hover:text-cyber-bg-darker transition-colors"
              >
                清空
              </button>
              <button 
                onClick={shufflePlaylist}
                disabled={playerState.playlist.length < 2}
                className="text-xs border border-cyber-secondary text-cyber-secondary px-2 py-1 rounded hover:bg-cyber-secondary hover:text-cyber-bg-darker transition-colors"
              >
                打乱
              </button>
              <button 
                onClick={() => setShowPlaylist(false)} 
                className="text-cyber-secondary hover:text-cyber-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          
          {isLoadingPlaylist ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-cyber-primary" />
            </div>
          ) : playerState.playlist.length === 0 ? (
            <div className="text-center py-8 text-cyber-secondary">
              播放列表为空，请添加歌曲
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto pr-2">
              {playerState.playlist.map((item, index) => (
                <div 
                  key={`${item.id || item.trackId}-${index}`}
                  className={`flex items-center justify-between p-2 mb-1 rounded hover:bg-cyber-bg transition-colors ${(playerState.currentTrack?.id === item.id || playerState.currentTrack?.id === item.trackId) ? 'bg-cyber-bg border border-cyber-primary' : ''}`}
                >
                  <div 
                    className="flex items-center flex-grow overflow-hidden cursor-pointer"
                    onClick={() => playTrack(item)}
                  >
                    <div className="w-8 h-8 bg-cyber-bg flex-shrink-0 rounded overflow-hidden mr-2">
                      {item.coverArtPath ? (
                        <img 
                          src={item.coverArtPath} 
                          alt="Cover" 
                          className="w-full h-full object-cover" 
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Music2 className="text-cyber-primary h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div className="truncate">
                      <div className={`truncate text-sm ${(playerState.currentTrack?.id === item.id || playerState.currentTrack?.id === item.trackId) ? 'text-cyber-primary font-medium' : 'text-cyber-text'}`}>
                        {item.title}
                      </div>
                      <div className="text-xs text-cyber-secondary truncate">
                        {item.artist || 'Unknown Artist'}
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => removeFromPlaylist(item.trackId || item.id)}
                    className="text-cyber-secondary hover:text-cyber-red transition-colors ml-2"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default Player;