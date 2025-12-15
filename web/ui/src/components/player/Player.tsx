import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Repeat, Shuffle,
  Loader2, ListMusic, X, Trash2, Music2, ArrowRight, GripVertical
} from 'lucide-react';
import { PlayMode } from '../../types';
import { usePlayer } from '../../contexts/PlayerContext';
import Hls from 'hls.js';
import debounce from 'lodash/debounce';

// 获取后端 URL，提供默认值
const getBackendUrl = () => {
  // 从全局变量读取
  if (typeof window !== 'undefined' && (window as any).__ENV__?.BACKEND_URL) {
    return (window as any).__ENV__.BACKEND_URL;
  }
  return import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';
};

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
  const navigate = useNavigate();
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
    setPlayerState,
    updatePlaylist
  } = usePlayer();
  
  // 初始化HLS实例
  const hlsInstanceRef = useRef<Hls | null>(null);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 3;

  // 添加播放列表长度的ref，用于检测新增歌曲
  const prevPlaylistLengthRef = useRef(playerState.playlist.length);
  const processingDetailsRef = useRef<Set<string>>(new Set());

  // 添加进度条拖拽相关状态
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const progressBarRef = useRef<HTMLDivElement>(null);

  // 拖拽排序相关状态
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [touchDragIndex, setTouchDragIndex] = useState<number | null>(null);
  const touchStartY = useRef<number>(0);
  const playlistContainerRef = useRef<HTMLDivElement>(null);

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
      const response = await fetch(`${getBackendUrl()}/api/netease/song/detail?ids=${neteaseId}`);
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
  
  // 处理进度条拖拽开始
  const handleProgressMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);

    if (progressBarRef.current) {
      const rect = progressBarRef.current.getBoundingClientRect();
      const percent = Math.min(Math.max(0, e.clientX - rect.left), rect.width) / rect.width;
      setDragProgress(percent);

      // 立即更新播放位置预览 - 使用有效时长
      const effectiveDuration = playerState.isTranscoding
        ? (playerState.estimatedDuration || playerState.duration || 0)
        : playerState.duration;
      const time = percent * effectiveDuration;
      if (audioRef.current && !isNaN(time)) {
        audioRef.current.currentTime = time;
      }
    }
  }, [playerState.duration, playerState.isTranscoding, playerState.estimatedDuration]);

  // 处理进度条拖拽移动
  const handleProgressMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !progressBarRef.current) return;

    const rect = progressBarRef.current.getBoundingClientRect();
    const percent = Math.min(Math.max(0, e.clientX - rect.left), rect.width) / rect.width;
    setDragProgress(percent);

    // 实时更新播放位置 - 使用有效时长
    const effectiveDuration = playerState.isTranscoding
      ? (playerState.estimatedDuration || playerState.duration || 0)
      : playerState.duration;
    const time = percent * effectiveDuration;
    if (audioRef.current && !isNaN(time)) {
      seekTo(time);
    }
  }, [isDragging, playerState.duration, playerState.isTranscoding, playerState.estimatedDuration, seekTo]);

  // 处理进度条拖拽结束
  const handleProgressMouseUp = useCallback(() => {
    if (!isDragging) return;
    
    setIsDragging(false);
    // dragProgress 在拖拽过程中已经实时更新了播放位置，这里不需要额外操作
  }, [isDragging]);

  // 处理触摸事件
  const handleProgressTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);

    if (progressBarRef.current) {
      const rect = progressBarRef.current.getBoundingClientRect();
      const touch = e.touches[0];
      const percent = Math.min(Math.max(0, touch.clientX - rect.left), rect.width) / rect.width;
      setDragProgress(percent);

      // 使用有效时长
      const effectiveDuration = playerState.isTranscoding
        ? (playerState.estimatedDuration || playerState.duration || 0)
        : playerState.duration;
      const time = percent * effectiveDuration;
      if (audioRef.current && !isNaN(time)) {
        audioRef.current.currentTime = time;
      }
    }
  }, [playerState.duration, playerState.isTranscoding, playerState.estimatedDuration]);

  const handleProgressTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging || !progressBarRef.current) return;

    e.preventDefault();
    const rect = progressBarRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    const percent = Math.min(Math.max(0, touch.clientX - rect.left), rect.width) / rect.width;
    setDragProgress(percent);

    // 使用有效时长
    const effectiveDuration = playerState.isTranscoding
      ? (playerState.estimatedDuration || playerState.duration || 0)
      : playerState.duration;
    const time = percent * effectiveDuration;
    if (audioRef.current && !isNaN(time)) {
      seekTo(time);
    }
  }, [isDragging, playerState.duration, playerState.isTranscoding, playerState.estimatedDuration, seekTo]);

  const handleProgressTouchEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
  }, [isDragging]);

  // 添加全局鼠标和触摸事件监听
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleProgressMouseMove);
      document.addEventListener('mouseup', handleProgressMouseUp);
      document.addEventListener('touchmove', handleProgressTouchMove, { passive: false });
      document.addEventListener('touchend', handleProgressTouchEnd);
      
      return () => {
        document.removeEventListener('mousemove', handleProgressMouseMove);
        document.removeEventListener('mouseup', handleProgressMouseUp);
        document.removeEventListener('touchmove', handleProgressTouchMove);
        document.removeEventListener('touchend', handleProgressTouchEnd);
      };
    }
  }, [isDragging, handleProgressMouseMove, handleProgressMouseUp, handleProgressTouchMove, handleProgressTouchEnd]);

  // 处理时间轨道点击（保持向下兼容）
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) return; // 拖拽时不处理点击

    if (!progressBarRef.current) return;

    const rect = progressBarRef.current.getBoundingClientRect();
    const percent = Math.min(Math.max(0, e.clientX - rect.left), rect.width) / rect.width;
    // 使用有效时长计算跳转时间
    const effectiveDuration = playerState.isTranscoding
      ? (playerState.estimatedDuration || playerState.duration || 0)
      : playerState.duration;
    const time = percent * effectiveDuration;
    seekTo(time);
  };

  // 获取当前进度百分比
  const getCurrentProgress = () => {
    if (isDragging) {
      return dragProgress * 100;
    }
    // 转码中时，使用预估时长计算进度
    const effectiveDuration = playerState.isTranscoding
      ? (playerState.estimatedDuration || playerState.duration || 0)
      : playerState.duration;
    return effectiveDuration ? (playerState.currentTime / effectiveDuration) * 100 : 0;
  };

  // 获取有效时长（转码中用预估，完成用实际）
  const getEffectiveDuration = () => {
    if (playerState.isTranscoding) {
      return playerState.estimatedDuration || playerState.duration || 0;
    }
    return playerState.duration || 0;
  };

  // ============ 拖拽排序处理函数 ============

  // 桌面端拖拽开始
  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    // 设置拖拽时的视觉效果
    if (e.currentTarget) {
      e.currentTarget.style.opacity = '0.5';
    }
  }, []);

  // 桌面端拖拽结束
  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    setDraggedIndex(null);
    setDragOverIndex(null);
    if (e.currentTarget) {
      e.currentTarget.style.opacity = '1';
    }
  }, []);

  // 桌面端拖拽经过
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  }, [draggedIndex]);

  // 桌面端放置
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newPlaylist = [...playerState.playlist];
    const [draggedItem] = newPlaylist.splice(draggedIndex, 1);
    newPlaylist.splice(dropIndex, 0, draggedItem);

    // 更新播放列表
    updatePlaylist(newPlaylist);

    setDraggedIndex(null);
    setDragOverIndex(null);
  }, [draggedIndex, playerState.playlist, updatePlaylist]);

  // 移动端触摸开始
  const handleTouchDragStart = useCallback((e: React.TouchEvent<HTMLDivElement>, index: number) => {
    const touch = e.touches[0];
    touchStartY.current = touch.clientY;
    setTouchDragIndex(index);
  }, []);

  // 移动端触摸移动
  const handleTouchDragMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (touchDragIndex === null || !playlistContainerRef.current) return;

    const touch = e.touches[0];
    const container = playlistContainerRef.current;
    const items = container.querySelectorAll('[data-playlist-item]');

    // 找到当前触摸位置对应的目标索引
    let targetIndex = touchDragIndex;
    items.forEach((item, index) => {
      const rect = item.getBoundingClientRect();
      const itemCenter = rect.top + rect.height / 2;
      if (touch.clientY < itemCenter && index < targetIndex) {
        targetIndex = index;
      } else if (touch.clientY > itemCenter && index > targetIndex) {
        targetIndex = index;
      }
    });

    if (targetIndex !== dragOverIndex) {
      setDragOverIndex(targetIndex);
    }
  }, [touchDragIndex, dragOverIndex]);

  // 移动端触摸结束
  const handleTouchDragEnd = useCallback(() => {
    if (touchDragIndex === null || dragOverIndex === null || touchDragIndex === dragOverIndex) {
      setTouchDragIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newPlaylist = [...playerState.playlist];
    const [draggedItem] = newPlaylist.splice(touchDragIndex, 1);
    newPlaylist.splice(dragOverIndex, 0, draggedItem);

    // 更新播放列表
    updatePlaylist(newPlaylist);

    setTouchDragIndex(null);
    setDragOverIndex(null);
  }, [touchDragIndex, dragOverIndex, playerState.playlist, updatePlaylist]);

  // ============ 拖拽排序处理函数结束 ============

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
  
  // 点击封面跳转到歌词页面
  const handleCoverClick = useCallback(() => {
    if (playerState.currentTrack) {
      // 获取歌曲ID，优先使用neteaseId
      const songId = playerState.currentTrack.neteaseId || playerState.currentTrack.id;
      if (songId) {
        navigate(`/lyric/${songId}`);
      }
    }
  }, [playerState.currentTrack, navigate]);

  // 增加一个更频繁的播放时间同步机制
  useEffect(() => {
    if (!playerState.isPlaying || !playerState.currentTrack) return;
    
    const syncInterval = setInterval(() => {
      if (audioRef.current && !isNaN(audioRef.current.currentTime)) {
        const currentTime = audioRef.current.currentTime;
        const duration = audioRef.current.duration || 0;
        
        // 更新播放器状态
        setPlayerState(prev => ({
          ...prev,
          currentTime: currentTime,
          duration: duration
        }));
      }
    }, 100); // 每100ms同步一次播放时间
    
    return () => clearInterval(syncInterval);
  }, [playerState.isPlaying, playerState.currentTrack, setPlayerState]);

  return (
    <>
      {/* 主播放器控件 - 底部固定 */}
      <div className="fixed bottom-0 left-0 right-0 bg-cyber-bg-darker border-t-2 border-cyber-primary z-50">
        {/* 移动端进度条 - 独立行 */}
        <div className="block md:hidden px-4 pt-3">
          <div
            ref={progressBarRef}
            className="w-full h-3 bg-cyber-bg rounded-full cursor-pointer relative overflow-hidden group"
            onMouseDown={handleProgressMouseDown}
            onTouchStart={handleProgressTouchStart}
            onClick={handleProgressClick}
          >
            {/* 背景轨道 */}
            <div className="absolute inset-0 bg-cyber-bg rounded-full"></div>

            {/* 转码缓冲指示器 - 显示已转码部分（浅色） */}
            {playerState.isTranscoding && (
              <div
                className="absolute top-0 left-0 h-full bg-cyber-primary/25 rounded-full pointer-events-none transition-all duration-300"
                style={{ width: `${Math.min(100, getCurrentProgress() + 15)}%` }}
              ></div>
            )}

            {/* 播放进度填充 */}
            <div
              className="h-full bg-cyber-primary rounded-full relative transition-all duration-150 ease-out"
              style={{ width: `${getCurrentProgress()}%` }}
            >
              {/* 拖拽手柄 */}
              <div
                className={`absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-cyber-primary rounded-full shadow-lg shadow-cyber-primary/50 transition-all duration-200 ${
                  isDragging ? 'scale-125' : 'scale-100 group-hover:scale-110'
                }`}
              ></div>
            </div>
          </div>

          {/* 移动端时间显示 */}
          <div className="flex justify-between text-xs text-cyber-secondary mt-1">
            <span>{formatTime(isDragging ? dragProgress * getEffectiveDuration() : playerState.currentTime)}</span>
            <span>{formatTime(getEffectiveDuration())}</span>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-3 md:px-4">
          {/* 桌面端进度条 */}
          <div className="hidden md:block">
            <div
              ref={progressBarRef}
              className="w-full h-2 bg-cyber-bg rounded-full mb-2.5 cursor-pointer relative overflow-hidden group"
              onMouseDown={handleProgressMouseDown}
              onTouchStart={handleProgressTouchStart}
              onClick={handleProgressClick}
            >
              {/* 背景轨道 */}
              <div className="absolute inset-0 bg-cyber-bg rounded-full"></div>

              {/* 转码缓冲指示器 - 显示已转码部分（浅色） */}
              {playerState.isTranscoding && (
                <div
                  className="absolute top-0 left-0 h-full bg-cyber-primary/25 rounded-full pointer-events-none transition-all duration-300"
                  style={{ width: `${Math.min(100, getCurrentProgress() + 15)}%` }}
                ></div>
              )}

              {/* 播放进度填充 */}
              <div
                className="h-full bg-cyber-primary rounded-full relative transition-all duration-150 ease-out"
                style={{ width: `${getCurrentProgress()}%` }}
              >
                {/* 拖拽手柄 */}
                <div
                  className={`absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-cyber-primary rounded-full shadow-lg shadow-cyber-primary/50 transition-all duration-200 ${
                    isDragging ? 'scale-125' : 'scale-100 group-hover:scale-110'
                  }`}
                ></div>
              </div>

              {/* 时间提示框（拖拽时显示） */}
              {isDragging && (
                <div
                  className="absolute -top-10 bg-cyber-bg-darker border border-cyber-primary rounded px-2 py-1 text-xs text-cyber-text pointer-events-none transform -translate-x-1/2 z-10"
                  style={{ left: `${getCurrentProgress()}%` }}
                >
                  {formatTime(dragProgress * getEffectiveDuration())}
                </div>
              )}
            </div>
          </div>
          
          {/* 主控制区域 */}
          <div className="flex items-center justify-between py-3 md:py-2">
            {/* 当前播放信息 - 移动端优化 */}
            <div className="flex items-center flex-1 min-w-0 pr-3">
              {playerState.currentTrack ? (
                <>
                  <div 
                    className="w-12 h-12 md:w-10 md:h-10 bg-cyber-bg rounded mr-3 md:mr-2 flex-shrink-0 overflow-hidden cursor-pointer hover:scale-105 transition-transform duration-200"
                    onClick={handleCoverClick}
                    title="点击查看歌词"
                  >
                    {playerState.currentTrack.coverArtPath ? (
                      <img 
                        src={playerState.currentTrack.coverArtPath}
                        alt="Cover"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music2 className="text-cyber-primary h-6 w-6 md:h-5 md:w-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-cyber-primary font-medium truncate text-sm md:text-xs">{playerState.currentTrack.title}</div>
                    <div className="text-cyber-secondary text-sm md:text-xs truncate">
                      {playerState.currentTrack.artist || 'Unknown Artist'}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-cyber-secondary text-sm md:text-xs">未选择歌曲</div>
              )}
            </div>
            
            {/* 播放控制 - 移动端增大按钮 */}
            <div className="flex items-center justify-center space-x-4 md:space-x-3 px-2">
              <button 
                onClick={handlePrevious} 
                className="text-cyber-secondary hover:text-cyber-primary transition-colors p-2 md:p-0"
                disabled={playerState.playlist.length < 2}
              >
                <SkipBack className="h-6 w-6 md:h-5 md:w-5" />
              </button>
              
              <button 
                onClick={togglePlayPause}
                className="bg-cyber-primary rounded-full p-3 md:p-1.5 text-cyber-bg-darker hover:bg-cyber-hover-primary transition-colors"
              >
                {playerState.isPlaying ? (
                  <Pause className="h-6 w-6 md:h-5 md:w-5" />
                ) : (
                  <Play className="h-6 w-6 md:h-5 md:w-5" />
                )}
              </button>
              
              <button 
                onClick={handleNext} 
                className="text-cyber-secondary hover:text-cyber-primary transition-colors p-2 md:p-0"
                disabled={playerState.playlist.length < 2}
              >
                <SkipForward className="h-6 w-6 md:h-5 md:w-5" />
              </button>
            </div>
            
            {/* 额外控制 - 移动端简化 */}
            <div className="flex items-center justify-end space-x-2 md:space-x-3 flex-1 min-w-0">
              {/* 桌面端时间显示 */}
              <div className="text-xs text-cyber-secondary hidden lg:block">
                {formatTime(isDragging ? dragProgress * getEffectiveDuration() : playerState.currentTime)} / {formatTime(getEffectiveDuration())}
              </div>
              
              {/* 音量控制 - 移动端隐藏滑块 */}
              <div className="hidden md:flex items-center space-x-1.5">
                <button onClick={toggleMute} className="text-cyber-secondary hover:text-cyber-primary transition-colors p-1">
                  {playerState.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.01" 
                  value={playerState.muted ? 0 : playerState.volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-20 h-1 bg-cyber-bg rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-cyber-primary [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-cyber-primary/50"
                />
              </div>

              {/* 移动端音量按钮 */}
              <button 
                onClick={toggleMute} 
                className="md:hidden text-cyber-secondary hover:text-cyber-primary transition-colors p-2"
              >
                {playerState.muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              
              {/* 播放模式 */}
              <button 
                onClick={togglePlayMode} 
                className="text-cyber-secondary hover:text-cyber-primary transition-colors p-2 md:p-1" 
                title={playModeInfo.text}
              >
                <div className="w-5 h-5 md:w-4 md:h-4">
                  {playModeInfo.icon}
                </div>
              </button>
              
              {/* 播放列表按钮 */}
              <button 
                onClick={() => setShowPlaylist(!showPlaylist)} 
                className={`text-cyber-secondary hover:text-cyber-primary transition-colors p-2 md:p-1 ${showPlaylist ? 'text-cyber-primary' : ''}`}
              >
                <ListMusic className="h-5 w-5 md:h-4 md:w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* 播放列表抽屉 - 移动端全屏优化 */}
      {showPlaylist && (
        <>
          {/* 移动端遮罩层 */}
          <div 
            className="fixed inset-0 bg-black/50 z-30 md:hidden"
            onClick={() => setShowPlaylist(false)}
          />
          
          <div className="fixed bottom-[100px] md:bottom-[84px] left-0 right-0 md:left-auto md:right-4 md:w-80 bg-cyber-bg-darker border-2 border-cyber-primary rounded-t-lg md:rounded-lg shadow-lg p-4 md:p-3 z-40 max-h-[70vh] md:max-h-none">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-cyber-primary">播放列表 ({playerState.playlist.length})</h3>
              <div className="flex space-x-2">
                <button 
                  onClick={addAllTracksToPlaylist}
                  disabled={isLoadingPlaylist}
                  className="text-xs border border-cyber-secondary text-cyber-secondary px-3 py-2 md:px-2 md:py-1 rounded hover:bg-cyber-secondary hover:text-cyber-bg-darker transition-colors"
                >
                  {isLoadingPlaylist ? <Loader2 className="h-3 w-3 animate-spin" /> : '添加全部'}
                </button>
                <button 
                  onClick={clearPlaylist}
                  disabled={playerState.playlist.length === 0}
                  className="text-xs border border-cyber-red text-cyber-red px-3 py-2 md:px-2 md:py-1 rounded hover:bg-cyber-red hover:text-cyber-bg-darker transition-colors"
                >
                  清空
                </button>
                <button 
                  onClick={shufflePlaylist}
                  disabled={playerState.playlist.length < 2}
                  className="text-xs border border-cyber-secondary text-cyber-secondary px-3 py-2 md:px-2 md:py-1 rounded hover:bg-cyber-secondary hover:text-cyber-bg-darker transition-colors"
                >
                  打乱
                </button>
                <button 
                  onClick={() => setShowPlaylist(false)} 
                  className="text-cyber-secondary hover:text-cyber-primary p-1"
                >
                  <X className="h-6 w-6 md:h-5 md:w-5" />
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
              <div
                ref={playlistContainerRef}
                className="max-h-[50vh] md:max-h-96 overflow-y-auto pr-2"
              >
                {playerState.playlist.map((item, index) => {
                  const trackId = getTrackId(item);
                  const isCurrent = isCurrentTrack(item);
                  const isDraggedItem = draggedIndex === index || touchDragIndex === index;
                  const isDragOverItem = dragOverIndex === index;

                  return (
                    <div
                      key={`${trackId}-${index}`}
                      data-playlist-item
                      draggable
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDrop={(e) => handleDrop(e, index)}
                      className={`flex items-center justify-between p-3 md:p-2 mb-2 md:mb-1 rounded transition-all duration-200
                        ${isCurrent ? 'bg-cyber-bg border border-cyber-primary' : 'hover:bg-cyber-bg'}
                        ${isDraggedItem ? 'opacity-50 scale-95' : ''}
                        ${isDragOverItem ? 'border-t-2 border-cyber-secondary' : ''}
                        ${touchDragIndex !== null ? 'select-none' : ''}
                      `}
                    >
                      {/* 拖拽手柄 */}
                      <div
                        className="cursor-grab active:cursor-grabbing text-cyber-secondary hover:text-cyber-primary mr-2 touch-none"
                        onTouchStart={(e) => handleTouchDragStart(e, index)}
                        onTouchMove={handleTouchDragMove}
                        onTouchEnd={handleTouchDragEnd}
                      >
                        <GripVertical className="h-5 w-5 md:h-4 md:w-4" />
                      </div>

                      <div
                        className="flex items-center flex-grow overflow-hidden cursor-pointer"
                        onClick={() => playTrack(item)}
                      >
                        <div className="w-10 h-10 md:w-8 md:h-8 bg-cyber-bg flex-shrink-0 rounded overflow-hidden mr-3 md:mr-2">
                          {item.coverArtPath ? (
                            <img
                              src={item.coverArtPath}
                              alt="Cover"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Music2 className="text-cyber-primary h-5 w-5 md:h-4 md:w-4" />
                            </div>
                          )}
                        </div>
                        <div className="truncate">
                          <div className={`truncate ${isCurrent ? 'text-cyber-primary font-medium' : 'text-cyber-text'}`}>
                            {item.title}
                          </div>
                          <div className="text-sm md:text-xs text-cyber-secondary truncate">
                            {item.artist || 'Unknown Artist'}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeFromPlaylist(trackId)}
                        className="text-cyber-secondary hover:text-cyber-red transition-colors ml-2 p-2 md:p-1"
                      >
                        <Trash2 className="h-4 w-4 md:h-3.5 md:w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
      <audio ref={audioRef} style={{ display: 'none' }} />
    </>
  );
};

export default Player;