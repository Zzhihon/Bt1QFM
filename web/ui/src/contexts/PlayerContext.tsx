import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Track, PlaylistItem, PlayMode, PlayerState } from '../types';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

interface PlayerContextType {
  playerState: PlayerState;
  setPlayerState: React.Dispatch<React.SetStateAction<PlayerState>>;
  playTrack: (track: Track) => void;
  togglePlayPause: () => void;
  handleNext: () => void;
  handlePrevious: () => void;
  toggleMute: () => void;
  setVolume: (volume: number) => void;
  togglePlayMode: () => void;
  seekTo: (time: number) => void;
  addToPlaylist: (track: Track) => Promise<void>;
  removeFromPlaylist: (trackId: string | number) => Promise<void>;
  clearPlaylist: () => Promise<void>;
  shufflePlaylist: () => Promise<void>;
  fetchPlaylist: () => Promise<void>;
  addAllTracksToPlaylist: () => Promise<void>;
  audioRef: React.RefObject<HTMLAudioElement>;
  isLoadingPlaylist: boolean;
  showPlaylist: boolean;
  setShowPlaylist: React.Dispatch<React.SetStateAction<boolean>>;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { currentUser, authToken } = useAuth();
  const { addToast } = useToast();
  const audioRef = React.useRef<HTMLAudioElement>(new Audio());
  const hlsInstanceRef = React.useRef<any>(null);
  
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  
  const [playerState, setPlayerState] = useState<PlayerState>(() => {
    // 从localStorage中恢复播放器状态
    const savedState = localStorage.getItem('playerState');
    if (savedState) {
      try {
        const parsedState = JSON.parse(savedState);
        return {
          ...parsedState,
          // 不再重置播放状态和当前时间
        };
      } catch (error) {
        console.error('Error parsing saved player state:', error);
      }
    }
    return {
      currentTrack: null,
      isPlaying: false,
      volume: 0.7,
      muted: false,
      currentTime: 0,
      duration: 0,
      playMode: PlayMode.SEQUENTIAL,
      playlist: []
    };
  });
  
  // 监听playerState变化，保存到localStorage
  useEffect(() => {
    localStorage.setItem('playerState', JSON.stringify(playerState));
  }, [playerState]);
  
  // 添加音频恢复逻辑
  useEffect(() => {
    if (playerState.currentTrack && playerState.isPlaying) {
      // 设置音频源
      if (playerState.currentTrack.hlsPlaylistUrl) {
        audioRef.current.src = playerState.currentTrack.hlsPlaylistUrl;
      }
      // 设置音量
      audioRef.current.volume = playerState.volume;
      // 设置静音状态
      audioRef.current.muted = playerState.muted;
      // 设置播放位置
      audioRef.current.currentTime = playerState.currentTime;
      // 开始播放
      audioRef.current.play().catch(error => {
        console.error('Error resuming playback:', error);
        // 如果自动播放失败，更新状态
        setPlayerState(prev => ({ ...prev, isPlaying: false }));
      });
    }
  }, []); // 仅在组件挂载时执行一次
  
  // 获取播放列表
  const fetchPlaylist = async () => {
    if (!currentUser) return;
    
    setIsLoadingPlaylist(true);
    try {
      const response = await fetch('/api/playlist', {
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      const data = await response.json();
      setPlayerState(prev => ({ ...prev, playlist: data.playlist || [] }));
    } catch (error) {
      console.error('Failed to fetch playlist:', error);
    } finally {
      setIsLoadingPlaylist(false);
    }
  };
  
  // 播放特定音乐
  const playTrack = (track: Track) => {
    // 播放逻辑
    console.log('Playing track:', track);
    setPlayerState(prev => ({ ...prev, currentTrack: track }));
    
    // 播放实际操作在Player组件中的useEffect hook中处理
  };
  
  // 播放/暂停切换
  const togglePlayPause = () => {
    if (!audioRef.current) return;
    
    if (playerState.isPlaying) {
      audioRef.current.pause();
    } else {
      if (playerState.currentTrack) {
        audioRef.current.play()
          .catch(error => console.error('Error playing audio:', error));
      }
    }
  };
  
  // 随机选择一首歌
  const getRandomTrack = () => {
    if (playerState.playlist.length === 0) return null;
    
    // 获取当前播放歌曲的position
    const currentPosition = playerState.currentTrack?.position ?? -1;
    let randomPosition;
    
    // 如果播放列表只有一首歌，直接返回
    if (playerState.playlist.length === 1) {
      return playerState.playlist[0];
    }
    
    // 随机选择一个不同于当前播放歌曲的位置
    do {
      randomPosition = Math.floor(Math.random() * playerState.playlist.length);
    } while (randomPosition === currentPosition);
    
    // 根据position找到对应的歌曲
    return playerState.playlist.find(track => track.position === randomPosition) || null;
  };
  
  // 下一首
  const handleNext = () => {
    if (playerState.playlist.length === 0) return;
    
    // 如果是随机播放模式，随机选择一首歌
    if (playerState.playMode === PlayMode.SHUFFLE) {
      const randomTrack = getRandomTrack();
      if (randomTrack) {
        console.log('Playing random track:', randomTrack);
        playTrack(randomTrack);
      }
      return;
    }
    
    // 其他播放模式使用原有的逻辑
    const currentPosition = playerState.currentTrack?.position ?? -1;
    let nextPosition = 0;
    
    if (currentPosition !== -1) {
      // 如果是顺序播放模式，且当前是最后一首
      if (playerState.playMode === PlayMode.SEQUENTIAL && currentPosition === playerState.playlist.length - 1) {
        // 如果当前正在播放，则停止播放
        if (playerState.isPlaying) {
          console.log('Reached end of playlist in sequential mode, stopping playback');
          if (audioRef.current) {
            audioRef.current.pause();
            setPlayerState(prev => ({ ...prev, isPlaying: false }));
          }
          return;
        }
        // 如果当前已停止，且用户点击了下一首，则从头开始播放
        console.log('Restarting from beginning of playlist in sequential mode');
        nextPosition = 0;
      } else {
        nextPosition = (currentPosition + 1) % playerState.playlist.length;
      }
    }
    
    console.log('Current position:', currentPosition, 'Next position:', nextPosition);
    
    const nextTrack = playerState.playlist.find(track => track.position === nextPosition);
    if (nextTrack) {
      console.log('Playing next track:', nextTrack);
      playTrack(nextTrack);
    } else {
      console.warn('No track found at position:', nextPosition);
    }
  };
  
  // 上一首
  const handlePrevious = () => {
    if (playerState.playlist.length === 0) return;
    
    // 如果是随机播放模式，随机选择一首歌
    if (playerState.playMode === PlayMode.SHUFFLE) {
      const randomTrack = getRandomTrack();
      if (randomTrack) {
        console.log('Playing random track:', randomTrack);
        playTrack(randomTrack);
      }
      return;
    }
    
    // 其他播放模式使用原有的逻辑
    const currentPosition = playerState.currentTrack?.position ?? -1;
    let prevPosition = playerState.playlist.length - 1;
    
    if (currentPosition !== -1) {
      prevPosition = (currentPosition - 1 + playerState.playlist.length) % playerState.playlist.length;
    }
    
    console.log('Current position:', currentPosition, 'Previous position:', prevPosition);
    
    const prevTrack = playerState.playlist.find(track => track.position === prevPosition);
    if (prevTrack) {
      console.log('Playing previous track:', prevTrack);
      playTrack(prevTrack);
    } else {
      console.warn('No track found at position:', prevPosition);
    }
  };
  
  // 静音切换
  const toggleMute = () => {
    if (!audioRef.current) return;
    
    const newMuted = !audioRef.current.muted;
    audioRef.current.muted = newMuted;
    setPlayerState(prev => ({ ...prev, muted: newMuted }));
  };
  
  // 设置音量
  const setVolume = (volume: number) => {
    if (!audioRef.current) return;
    
    audioRef.current.volume = volume;
    setPlayerState(prev => ({ ...prev, volume }));
    
    if (volume > 0 && audioRef.current.muted) {
      audioRef.current.muted = false;
      setPlayerState(prev => ({ ...prev, muted: false }));
    }
  };
  
  // 切换播放模式
  const togglePlayMode = () => {
    setPlayerState(prev => {
      let nextMode: PlayMode;
      switch (prev.playMode) {
        case PlayMode.SEQUENTIAL:
          nextMode = PlayMode.REPEAT_ALL;
          break;
        case PlayMode.REPEAT_ALL:
          nextMode = PlayMode.REPEAT_ONE;
          break;
        case PlayMode.REPEAT_ONE:
          nextMode = PlayMode.SHUFFLE;
          break;
        case PlayMode.SHUFFLE:
        default:
          nextMode = PlayMode.SEQUENTIAL;
          break;
      }
      return { ...prev, playMode: nextMode };
    });
  };
  
  // 调整进度
  const seekTo = (time: number) => {
    if (!audioRef.current) return;
    
    audioRef.current.currentTime = time;
    setPlayerState(prev => ({ ...prev, currentTime: time }));
  };
  
  // 添加到播放列表
  const addToPlaylist = async (track: Track) => {
    if (!currentUser) return;
    
    // 检查播放列表中是否已经存在相同的歌曲
    // 注意：后端返回的是trackId字段，我们需要正确检查
    const trackExists = playerState.playlist.some(item => {
      // @ts-ignore - trackId可能不在类型定义中，但实际存在于API返回数据
      const itemTrackId = item.trackId !== undefined ? item.trackId : item.id;
      return itemTrackId === track.id;
    });
    
    if (trackExists) {
      console.log('Track already exists in playlist:', track.title);
      addToast(`《${track.title}》已在播放列表中`, 'info');
      return; // 如果歌曲已存在，直接返回，不再添加
    }
    
    try {
      const response = await fetch('/api/playlist', {
        method: 'POST',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ trackId: track.id })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      await fetchPlaylist();
      addToast(`《${track.title}》已添加到播放列表`, 'success');
    } catch (error) {
      console.error('Failed to add track to playlist:', error);
      addToast('添加歌曲失败，请重试', 'error');
    }
  };
  
  // 从播放列表移除
  const removeFromPlaylist = async (trackId: string | number) => {
    if (!currentUser) return;
    
    try {
      const response = await fetch(`/api/playlist?trackId=${trackId}`, {
        method: 'DELETE',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      await fetchPlaylist();
      
      // 如果删除的是当前播放的歌曲，切换到下一首
      if (playerState.currentTrack?.id === trackId) {
        handleNext();
      }
    } catch (error) {
      console.error('Failed to remove track from playlist:', error);
    }
  };
  
  // 清空播放列表
  const clearPlaylist = async () => {
    if (!currentUser) return;
    
    try {
      const response = await fetch('/api/playlist?clear=true', {
        method: 'DELETE',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      setPlayerState(prev => ({ ...prev, playlist: [] }));
      
      // 停止当前播放
      if (playerState.isPlaying && audioRef.current) {
        audioRef.current.pause();
        setPlayerState(prev => ({ ...prev, isPlaying: false }));
      }
    } catch (error) {
      console.error('Failed to clear playlist:', error);
    }
  };
  
  // 随机播放下一首
  const handleShuffleNext = async () => {
    if (!currentUser) return;
    
    try {
      // 调用后端API打乱播放列表
      const response = await fetch('/api/playlist?shuffle=true', {
        method: 'PUT',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      // 重新获取打乱后的播放列表
      await fetchPlaylist();
      
      // 获取当前播放歌曲的position
      const currentPosition = playerState.currentTrack?.position ?? -1;
      let nextPosition = 0;
      
      if (currentPosition !== -1) {
        // 计算下一个position
        nextPosition = (currentPosition + 1) % playerState.playlist.length;
      }
      
      // 根据position找到下一首歌
      const nextTrack = playerState.playlist.find(track => track.position === nextPosition);
      if (nextTrack) {
        console.log('Playing next track after shuffle:', nextTrack);
        playTrack(nextTrack);
      }
    } catch (error) {
      console.error('Failed to shuffle playlist:', error);
    }
  };
  
  // 添加所有歌曲到播放列表
  const addAllTracksToPlaylist = async () => {
    if (!currentUser) return;
    
    try {
      const response = await fetch('/api/playlist/all', {
        method: 'POST',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      await fetchPlaylist();
    } catch (error) {
      console.error('Failed to add all tracks to playlist:', error);
    }
  };
  
  // 加载播放列表
  useEffect(() => {
    if (currentUser) {
      fetchPlaylist();
    }
  }, [currentUser]);
  
  // 监听音频事件
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    const handlePlay = () => {
      setPlayerState(prev => ({ ...prev, isPlaying: true }));
    };
    
    const handlePause = () => {
      setPlayerState(prev => ({ ...prev, isPlaying: false }));
    };
    
    const handleTimeUpdate = () => {
      setPlayerState(prev => ({ 
        ...prev, 
        currentTime: audio.currentTime,
        duration: audio.duration || 0
      }));
    };
    
    const handleEnded = () => {
      // 根据播放模式处理歌曲结束后的行为
      switch (playerState.playMode) {
        case PlayMode.SEQUENTIAL:
          handleNext();
          break;
        case PlayMode.REPEAT_ALL:
          const currentPosition = playerState.currentTrack?.position ?? -1;
          if (currentPosition === playerState.playlist.length - 1) {
            // 如果是最后一首，从头开始播放
            const firstTrack = playerState.playlist.find(track => track.position === 0);
            if (firstTrack) {
              playTrack(firstTrack);
            }
          } else {
            handleNext();
          }
          break;
        case PlayMode.REPEAT_ONE:
          audio.currentTime = 0;
          audio.play().catch(error => console.error('Error replaying track:', error));
          break;
        case PlayMode.SHUFFLE:
          // 随机播放下一首
          const randomTrack = getRandomTrack();
          if (randomTrack) {
            console.log('Playing random track after ended:', randomTrack);
            playTrack(randomTrack);
          }
          break;
      }
    };
    
    const handleVolumeChange = () => {
      setPlayerState(prev => ({ 
        ...prev, 
        volume: audio.volume,
        muted: audio.muted
      }));
    };
    
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('volumechange', handleVolumeChange);
    
    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('volumechange', handleVolumeChange);
    };
  }, [playerState.playMode, playerState.playlist, playerState.currentTrack]);
  
  return (
    <PlayerContext.Provider 
      value={{
        playerState,
        setPlayerState,
        playTrack,
        togglePlayPause,
        handleNext,
        handlePrevious,
        toggleMute,
        setVolume,
        togglePlayMode,
        seekTo,
        addToPlaylist,
        removeFromPlaylist,
        clearPlaylist,
        shufflePlaylist: handleShuffleNext,
        fetchPlaylist,
        addAllTracksToPlaylist,
        audioRef,
        isLoadingPlaylist,
        showPlaylist,
        setShowPlaylist
      }}
    >
      {children}
      <audio ref={audioRef} style={{ display: 'none' }} />
    </PlayerContext.Provider>
  );
};

export const usePlayer = (): PlayerContextType => {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
}; 