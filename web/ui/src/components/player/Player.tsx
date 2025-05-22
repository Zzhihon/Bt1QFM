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
    if (!playerState.currentTrack?.hlsPlaylistUrl || !audioRef.current) return;
    
    // 每次切换曲目时，先销毁旧的HLS实例
    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.destroy();
      hlsInstanceRef.current = null;
    }
    
    // 重置重试计数
    retryCountRef.current = 0;
    
    try {
      if (Hls.isSupported()) {
        const hls = new Hls({
          debug: false,
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90,
          maxBufferLength: 30,
          maxMaxBufferLength: 600,
          maxBufferSize: 60 * 1000 * 1000, // 60MB
          maxBufferHole: 0.5,
          highBufferWatchdogPeriod: 2,
          nudgeMaxRetry: 5,
          nudgeOffset: 0.2,
          manifestLoadingTimeOut: 20000,
          manifestLoadingMaxRetry: 3,
          manifestLoadingRetryDelay: 1000,
          levelLoadingTimeOut: 20000,
          levelLoadingMaxRetry: 3,
          levelLoadingRetryDelay: 1000,
          fragLoadingTimeOut: 20000,
          fragLoadingMaxRetry: 3,
          fragLoadingRetryDelay: 1000,
          startFragPrefetch: true,
          testBandwidth: true,
          progressive: true
        });
        
        hlsInstanceRef.current = hls;
        hls.attachMedia(audioRef.current);
        
        // 错误处理
        hls.on(Hls.Events.ERROR, (event, data) => {
          console.error('HLS error:', event, data);
          
          if (data.fatal) {
            if (retryCountRef.current < MAX_RETRIES) {
              retryCountRef.current++;
              console.log(`Retrying... (${retryCountRef.current}/${MAX_RETRIES})`);
              
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.log('Fatal network error, trying to recover...');
                  hls.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.log('Fatal media error, trying to recover...');
                  hls.recoverMediaError();
                  break;
                default:
                  console.log('Fatal error, destroying HLS instance...');
                  hls.destroy();
                  hlsInstanceRef.current = null;
                  break;
              }
            } else {
              console.log('Max retries reached, giving up...');
              alert('该曲目暂时无法播放，请稍后重试');
              hls.destroy();
              hlsInstanceRef.current = null;
            }
          }
        });
        
        // 监听其他重要事件
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log('HLS manifest parsed');
          retryCountRef.current = 0;
          if (audioRef.current) {
            audioRef.current.play().catch(err => {
              console.error('Error playing audio after manifest parsed:', err);
            });
          }
        });
        
        hls.on(Hls.Events.LEVEL_LOADED, () => {
          console.log('HLS level loaded');
        });
        
        hls.on(Hls.Events.FRAG_LOADED, () => {
          console.log('HLS fragment loaded');
        });
        
        // 加载新的源
        hls.loadSource(playerState.currentTrack.hlsPlaylistUrl);
      } else if (audioRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari等浏览器原生支持HLS
        audioRef.current.src = playerState.currentTrack.hlsPlaylistUrl;
        audioRef.current.play().catch(err => {
          console.error('Error playing audio natively:', err);
        });
      }
    } catch (error) {
      console.error("Error loading HLS stream:", error);
    }
    
    return () => {
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }
    };
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
        <div className="container mx-auto flex flex-col">
          {/* 进度条 */}
          <div 
            className="w-full h-3 bg-cyber-bg rounded-full mb-3 cursor-pointer"
            onClick={handleProgressClick}
          >
            <div 
              className="h-full bg-cyber-primary rounded-full"
              style={{ width: `${playerState.duration ? (playerState.currentTime / playerState.duration) * 100 : 0}%` }}
            ></div>
          </div>
          
          <div className="flex items-center justify-between py-2">
            {/* 当前播放信息 */}
            <div className="flex items-center w-1/4">
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
            <div className="flex items-center justify-center space-x-5">
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
            <div className="flex items-center justify-end w-1/4 space-x-4">
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
                  className="w-20 accent-cyber-primary"
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
        <div className="fixed bottom-24 right-0 w-full md:w-96 bg-cyber-bg-darker border-2 border-cyber-primary rounded-t-lg shadow-lg p-4 z-40">
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