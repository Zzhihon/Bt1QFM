import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Repeat, Shuffle,
  Loader2, ListMusic, X, Trash2, Music2, ArrowRight
} from 'lucide-react';
import { PlayMode } from '../../types';
import { usePlayer } from '../../contexts/PlayerContext';
import Hls from 'hls.js';
import debounce from 'lodash/debounce';

// 添加netease歌曲详情接口
interface NeteaseSongDetail {
  id: number;
  name: string;
  ar: Array<{
    id: number;
    name: string;
  }>;
  al: {
    id: number;
    name: string;
    picUrl: string;
  };
}

// 添加歌曲详情缓存
const songDetailCache = new Map<string, NeteaseSongDetail>();

// 添加动态封面接口
interface DynamicCoverResponse {
  code: number;
  data: {
    videoPlayUrl: string;
  };
  message: string;
}

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
    setShowPlaylist,
    setPlayerState
  } = usePlayer();
  
  // 初始化HLS实例
  const hlsInstanceRef = useRef<Hls | null>(null);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 3;

  // 添加播放列表长度的ref，用于检测新增歌曲
  const prevPlaylistLengthRef = useRef(playerState.playlist.length);
  const processingDetailsRef = useRef<Set<string>>(new Set());

  // 获取歌曲详情的函数
  const fetchSongDetail = useCallback(async (neteaseId: string) => {
    // 检查是否正在处理中，避免重复请求
    if (processingDetailsRef.current.has(neteaseId)) {
      return;
    }

    // 检查缓存中是否已有数据
    const cachedDetail = songDetailCache.get(neteaseId);
    if (cachedDetail) {
      console.log('---------------使用缓存的歌曲详情--------------', cachedDetail);
      updateTrackInfo(cachedDetail);
      return;
    }

    try {
      // 添加到处理中集合
      processingDetailsRef.current.add(neteaseId);
      
      console.log(`Fetching song detail for Netease ID: ${neteaseId}`);
      const response = await fetch(`/api/netease/song/detail?ids=${neteaseId}`);
      const data = await response.json();
      
      console.log('Song detail API返回数据:', data);
      if (data.success && data.data) {
        const detail = data.data;
        // 存入缓存
        songDetailCache.set(neteaseId, detail);
        updateTrackInfo(detail);
      } else {
        console.log('未从 song detail API 获取到有效数据。');
      }
    } catch (error) {
      console.error('获取歌曲详情失败:', error);
    } finally {
      // 从处理中集合移除
      processingDetailsRef.current.delete(neteaseId);
    }
  }, []);

  // 更新歌曲信息的函数 - 支持同时更新当前播放和播放列表
  const updateTrackInfo = useCallback((detail: NeteaseSongDetail) => {
    if (detail.al && detail.al.picUrl) {
      const newCoverArtPath = detail.al.picUrl;
      const newArtist = detail.ar ? detail.ar.map(a => a.name).join(', ') : 'Unknown Artist';

      setPlayerState(prevState => ({
        ...prevState,
        currentTrack: prevState.currentTrack && 
          (prevState.currentTrack.neteaseId === detail.id || prevState.currentTrack.id === detail.id) ? {
          ...prevState.currentTrack,
          coverArtPath: newCoverArtPath,
          artist: newArtist,
          album: detail.al.name,
        } : prevState.currentTrack,
        playlist: prevState.playlist.map(track => 
          (track.neteaseId === detail.id || track.id === detail.id) ? {
            ...track,
            coverArtPath: newCoverArtPath,
            artist: newArtist,
            album: detail.al.name,
          } : track
        )
      }));
      console.log('更新后的 coverArtPath:', newCoverArtPath);
      console.log('更新后的 artist:', newArtist);
      console.log('更新后的 album:', detail.al.name);
    }
  }, [setPlayerState]);

  // 批量获取播放列表中缺失详情的歌曲
  const fetchMissingDetails = useCallback(async (tracks: any[]) => {
    const needDetailTracks = tracks.filter(track => 
      (track.neteaseId || (track.id && !track.trackId)) && 
      (!track.coverArtPath || !track.artist || track.artist === 'Unknown Artist' || track.artist === '未知艺术家')
    );

    if (needDetailTracks.length === 0) return;

    console.log('🔄 检测到需要更新详情的歌曲:', needDetailTracks.map(t => ({
      id: t.neteaseId || t.id,
      title: t.title,
      hasArtist: !!t.artist,
      hasCover: !!t.coverArtPath,
      artistValue: t.artist
    })));

    // 并发获取所有歌曲详情，但限制并发数
    const batchSize = 3; // 限制并发数量，避免请求过多
    for (let i = 0; i < needDetailTracks.length; i += batchSize) {
      const batch = needDetailTracks.slice(i, i + batchSize);
      const promises = batch.map(track => 
        fetchSongDetail((track.neteaseId || track.id).toString())
      );
      
      try {
        await Promise.all(promises);
        // 小延迟，避免请求过于频繁
        if (i + batchSize < needDetailTracks.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error('批量获取歌曲详情失败:', error);
      }
    }
  }, [fetchSongDetail]);

  // 监听播放列表变化，检测新增歌曲并自动获取详情
  useEffect(() => {
    const currentLength = playerState.playlist.length;
    const prevLength = prevPlaylistLengthRef.current;

    // 检测到新增歌曲
    if (currentLength > prevLength) {
      console.log('🎵 检测到播放列表新增歌曲:', {
        prevLength,
        currentLength,
        newSongs: currentLength - prevLength
      });

      // 获取新增的歌曲（最后几首）
      const newTracks = playerState.playlist.slice(prevLength);
      
      console.log('🎵 新增的歌曲详情:', newTracks.map(t => ({
        id: t.neteaseId || t.id,
        title: t.title,
        hasNeteaseId: !!t.neteaseId,
        hasTrackId: !!t.trackId,
        coverArtPath: t.coverArtPath,
        artist: t.artist
      })));
      
      // 立即获取新增歌曲的详情，不阻塞UI
      setTimeout(() => {
        fetchMissingDetails(newTracks);
      }, 100); // 稍微延长延迟，确保UI更新完成
    }

    // 更新ref
    prevPlaylistLengthRef.current = currentLength;
  }, [playerState.playlist.length, fetchMissingDetails]);

  // 也监听整个播放列表的变化，以防长度没变但内容有变化
  useEffect(() => {
    if (playerState.playlist.length > 0) {
      // 延迟执行，避免频繁触发
      const timeoutId = setTimeout(() => {
        fetchMissingDetails(playerState.playlist);
      }, 200);
      
      return () => clearTimeout(timeoutId);
    }
  }, [playerState.playlist, fetchMissingDetails]);

  // 定期检查播放列表中缺失详情的歌曲（低频率，作为兜底）
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (playerState.playlist.length > 0) {
        fetchMissingDetails(playerState.playlist);
      }
    }, 30000); // 30秒检查一次

    return () => clearInterval(intervalId);
  }, [playerState.playlist, fetchMissingDetails]);

  // 使用防抖处理获取歌曲详情
  const debouncedFetchSongDetail = useCallback(
    debounce((neteaseId: string) => {
      fetchSongDetail(neteaseId);
    }, 300),
    [fetchSongDetail]
  );

  // 当currentTrack改变时更新HLS源
  useEffect(() => {
    if (playerState.currentTrack && audioRef.current) {
      console.log('当前播放曲目:', playerState.currentTrack);

      // 如果是网易云歌曲，获取歌曲详情并更新封面和艺术家信息
      const currentTrack = playerState.currentTrack;
      if (currentTrack.neteaseId || (currentTrack.id && !currentTrack.trackId)) {
        // 检查是否需要更新信息
        const needsUpdate = !currentTrack.coverArtPath || !currentTrack.artist || !currentTrack.album;
        if (needsUpdate) {
          const id = (currentTrack.neteaseId || currentTrack.id).toString();
          debouncedFetchSongDetail(id);
        }
      }
    }
  }, [playerState.currentTrack, debouncedFetchSongDetail]);

  // 统一获取歌曲ID的辅助函数
  const getTrackId = (track: any) => {
    return track.neteaseId || track.trackId || track.id;
  };

  // 检查是否为当前播放的歌曲
  const isCurrentTrack = (track: any) => {
    if (!playerState.currentTrack) return false;
    const currentId = getTrackId(playerState.currentTrack);
    const trackId = getTrackId(track);
    return currentId === trackId;
  };
  
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
          icon: <div className="relative w-5 h-5">
            <Repeat className="h-5 w-5" />
            <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-cyber-primary rounded-full flex items-center justify-center z-10">
              <span className="text-[9px] font-bold text-cyber-bg-darker leading-none">1</span>
            </div>
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
          </div>, 
          text: '顺序播放' 
        };
    }
  };
  
  const playModeInfo = getPlayModeInfo();
  
  return (
    <>
      {/* 主播放器控件 - 底部固定 */}
      <div className="fixed bottom-0 left-0 right-0 bg-cyber-bg-darker border-t-2 border-cyber-primary p-2.5 z-50">
        <div className="max-w-7xl mx-auto px-3">
          {/* 进度条 */}
          <div 
            className="w-full h-1.5 bg-cyber-bg rounded-full mb-2.5 cursor-pointer relative overflow-hidden"
            onClick={handleProgressClick}
          >
            <div 
              className="h-full bg-gradient-to-r from-cyber-primary to-cyber-secondary rounded-full relative"
              style={{ width: `${playerState.duration ? (playerState.currentTime / playerState.duration) * 100 : 0}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.1 h-0.1 bg-cyber-primary shadow-lg shadow-cyber-primary/50"></div>
            </div>
          </div>
          
          <div className="flex items-center justify-between py-0.5">
            {/* 当前播放信息 */}
            <div className="flex items-center w-1/3">
              {playerState.currentTrack ? (
                <>
                  <div className="w-10 h-10 bg-cyber-bg rounded mr-2 flex-shrink-0 overflow-hidden">
                    {/* 直接使用 coverArtPath */}
                    {playerState.currentTrack.coverArtPath ? (
                      <img 
                        src={playerState.currentTrack.coverArtPath}
                        alt="Cover"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music2 className="text-cyber-primary h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="truncate">
                    <div className="text-cyber-primary font-medium truncate text-xs">{playerState.currentTrack.title}</div>
                    <div className="text-cyber-secondary text-xs truncate">
                      {playerState.currentTrack.artist || 'Unknown Artist'}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-cyber-secondary text-xs">未选择歌曲</div>
              )}
            </div>
            
            {/* 播放控制 */}
            <div className="flex items-center justify-center space-x-3">
              <button 
                onClick={handlePrevious} 
                className="text-cyber-secondary hover:text-cyber-primary transition-colors"
                disabled={playerState.playlist.length < 2}
              >
                <SkipBack className="h-5 w-5" />
              </button>
              
              <button 
                onClick={togglePlayPause}
                className="bg-cyber-primary rounded-full p-1.5 text-cyber-bg-darker hover:bg-cyber-hover-primary transition-colors"
              >
                {playerState.isPlaying ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
              </button>
              
              <button 
                onClick={handleNext} 
                className="text-cyber-secondary hover:text-cyber-primary transition-colors"
                disabled={playerState.playlist.length < 2}
              >
                <SkipForward className="h-5 w-5" />
              </button>
            </div>
            
            {/* 额外控制：音量、播放模式、播放列表按钮 */}
            <div className="flex items-center justify-end w-1/3 space-x-3">
              {/* 时间显示 */}
              <div className="text-xs text-cyber-secondary hidden sm:block">
                {formatTime(playerState.currentTime)} / {formatTime(playerState.duration)}
              </div>
              
              {/* 音量控制 */}
              <div className="flex items-center space-x-1.5">
                <button onClick={toggleMute} className="text-cyber-secondary hover:text-cyber-primary transition-colors">
                  {playerState.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.01" 
                  value={playerState.muted ? 0 : playerState.volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-27.8 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-cyber-primary/50 [&::-moz-range-track]:h-0.5 [&::-moz-range-track]:rounded-full [&::-moz	range-track]:bg-cyber-bg/50 [&::-moz	range-thumb]:appearance-none [&::-moz	range-thumb]:w-2 [&::-moz	range-thumb]:h-2 [&::-moz	range-thumb]:bg-cyber-primary [&::-moz	range-thumb]:cursor-pointer [&::-moz	range-thumb]:border-0 [&::-moz	range-thumb]:shadow-lg [&::-moz	range-thumb]:shadow-cyber-primary/50"
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
                <ListMusic className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* 播放列表抽屉 */}
      {showPlaylist && (
        <div className="fixed bottom-[84px] right-4 w-full md:w-80 bg-cyber-bg-darker border-2 border-cyber-primary rounded-lg shadow-lg p-3 z-40">
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
              {playerState.playlist.map((item, index) => {
                const trackId = getTrackId(item);
                const isCurrent = isCurrentTrack(item);
                
                // 对于网易云歌曲，确保使用从 song detail 获取的封面
                if (item.neteaseId) {
                    // 这里不需要再次获取详情，详情应该在播放或添加到播放列表时获取
                    // 确保使用 item 中已经更新的 coverArtPath
                }

                return (
                  <div 
                    key={`${trackId}-${index}`}
                    className={`flex items-center justify-between p-2 mb-1 rounded hover:bg-cyber-bg transition-colors ${isCurrent ? 'bg-cyber-bg border border-cyber-primary' : ''}`}
                  >
                    <div 
                      className="flex items-center flex-grow overflow-hidden cursor-pointer"
                      onClick={() => playTrack(item)}
                    >
                      <div className="w-8 h-8 bg-cyber-bg flex-shrink-0 rounded overflow-hidden mr-2">
                        {/* 直接使用 item.coverArtPath */}
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
                        <div className={`truncate text-sm ${isCurrent ? 'text-cyber-primary font-medium' : 'text-cyber-text'}`}>
                          {item.title}
                        </div>
                        <div className="text-xs text-cyber-secondary truncate">
                          {item.artist || 'Unknown Artist'}
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={() => removeFromPlaylist(trackId)}
                      className="text-cyber-secondary hover:text-cyber-red transition-colors ml-2"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <audio ref={audioRef} style={{ display: 'none' }} />
    </>
  );
};

export default Player;