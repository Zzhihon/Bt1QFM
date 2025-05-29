import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Track, PlaylistItem, PlayMode, PlayerState } from '../types';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import Hls from 'hls.js';

// 添加网易云音乐详情的接口定义
interface NeteaseArtist {
  name: string;
}

interface NeteaseAlbum {
  name: string;
  picUrl: string;
}

interface NeteaseSongDetail {
  id: number;
  name: string;
  ar: NeteaseArtist[];
  al: NeteaseAlbum;
}

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
  updatePlaylist: (newPlaylist: Track[]) => void;
  audioRef: React.RefObject<HTMLAudioElement>;
  isLoadingPlaylist: boolean;
  showPlaylist: boolean;
  setShowPlaylist: React.Dispatch<React.SetStateAction<boolean>>;
  currentTrack: Track | null;
  isPlaying: boolean;
  pauseTrack: () => void;
  resumeTrack: () => void;
  stopTrack: () => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { currentUser, authToken } = useAuth();
  const { addToast } = useToast();
  const audioRef = React.useRef<HTMLAudioElement>(new Audio());
  const hlsInstanceRef = React.useRef<Hls | null>(null);
  
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
      console.log('开始获取播放列表...');
      const response = await fetch('/api/playlist', {
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      const data = await response.json();
      let playlist = data.playlist || [];
      console.log('获取到原始播放列表:', playlist);

      // 处理网易云音乐的歌曲
      const neteaseTracks = playlist.filter((track: any) => track.neteaseId);
      console.log('找到网易云音乐歌曲:', neteaseTracks);
      
      if (neteaseTracks.length > 0) {
        // 创建ID到详情的映射
        const detailsMap = new Map();
        
        // 逐个获取每首歌曲的详情
        for (const track of neteaseTracks) {
          try {
            console.log(`获取歌曲 ${track.neteaseId} 的详情...`);
            const detailResponse = await fetch(`/api/netease/song/detail?ids=${track.neteaseId}`);
            const detailData = await detailResponse.json();
            
            if (detailData.success && detailData.data) {
              const detail = detailData.data;
              if (detail && detail.id) {
                detailsMap.set(detail.id, detail);
                console.log(`成功获取歌曲 ${track.neteaseId} 的详情:`, detail);
              }
            } else {
              console.warn(`获取歌曲 ${track.neteaseId} 的详情失败:`, detailData);
            }
          } catch (error) {
            console.error(`获取歌曲 ${track.neteaseId} 的详情时出错:`, error);
          }
        }
        
        console.log('创建详情映射:', Object.fromEntries(detailsMap));

        // 更新播放列表中的网易云音乐歌曲信息
        playlist = playlist.map((track: any) => {
          if (track.neteaseId) {
            const detail = detailsMap.get(track.neteaseId);
            console.log(`处理歌曲 ${track.neteaseId}:`, { original: track, detail });
            
            if (detail) {
              const updatedTrack = {
                ...track,
                title: detail.name || track.title,
                artist: detail.ar ? detail.ar.map((a: { name: string }) => a.name).join(', ') : '',
                album: detail.al ? detail.al.name : '',
                coverArtPath: detail.al?.picUrl || detail.coverUrl || '',
                source: 'netease'
              };
              console.log(`更新后的歌曲信息:`, updatedTrack);
              return updatedTrack;
            } else {
              console.warn(`未找到歌曲 ${track.neteaseId} 的详情信息`);
            }
          }
          return track;
        });
      }

      console.log('最终更新后的播放列表:', playlist);
      setPlayerState(prev => ({ ...prev, playlist }));
    } catch (error) {
      console.error('获取播放列表失败:', error);
    } finally {
      setIsLoadingPlaylist(false);
    }
  };
  
  // 播放特定音乐
  const playTrack = async (track: Track) => {
    console.log('Playing track:', track);
    
    try {
      // 如果当前正在播放，先暂停并等待一小段时间
      if (playerState.isPlaying && audioRef.current) {
        audioRef.current.pause();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // 清理之前的HLS实例
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }
      
      // 更新状态，但不立即设置isPlaying
      setPlayerState(prev => ({ 
        ...prev, 
        currentTrack: track,
        isPlaying: false // 先设置为false，等加载完成后再设置为true
      }));
      
      // --- 新增逻辑：如果播放的是网易云歌曲且信息不完整，尝试获取详情并更新播放列表 ---
      if ((track as any).neteaseId) {
        const neteaseId = (track as any).neteaseId.toString();
        // 检查信息是否完整
        const needsDetailFetch = !track.coverArtPath || !track.artist || !track.album;
        if (needsDetailFetch) {
          console.log(`播放网易云歌曲，信息不完整，尝试获取详情 (ID: ${neteaseId})`);
          try {
            const detailResponse = await fetch(`/api/netease/song/detail?ids=${neteaseId}`);
            const detailData = await detailResponse.json();

            if(detailData.success && detailData.data) {
                const detail = detailData.data;
                const updatedInfo = {
                    title: detail.name || track.title, // 优先使用详情的数据，否则使用原始数据
                    artist: detail.ar ? detail.ar.map((a: { name: string }) => a.name).join(', ') : track.artist, // 优先使用详情的数据，否则使用原始数据
                    album: detail.al ? detail.al.name : track.album, // 优先使用详情的数据，否则使用原始数据
                    coverArtPath: detail.al && detail.al.picUrl ? detail.al.picUrl : track.coverArtPath, // 优先使用详情的数据，否则使用原始数据
                };
                // 调用updatePlaylistTrackInfo更新播放列表和currentTrack (如果需要)
                updatePlaylistTrackInfo(String(neteaseId), updatedInfo); // 使用track.id或neteaseId，取决于updatePlaylistTrackInfo如何匹配
                // 由于上面updatePlaylistTrackInfo会更新playlist，如果currentTrack是playlist的引用，currentTrack也会更新。
                // 如果currentTrack不是引用，我们这里手动更新一次currentTrack的状态。
                 setPlayerState(prev => {
                    if (prev.currentTrack && ((prev.currentTrack as any).neteaseId === (track as any).neteaseId)) {
                         return {
                            ...prev,
                            currentTrack: { ...prev.currentTrack, ...updatedInfo }
                        };
                    }
                    return prev; // 如果当前播放的不是这首歌，则不更新currentTrack
                 });

                console.log(`成功获取并更新歌曲详情 (ID: ${neteaseId})`);
            } else {
                console.warn(`Failed to fetch detail during playTrack for ID ${neteaseId}`, detailData.error);
            }
         } catch (detailError) {
            console.error(`Error fetching detail during playTrack for ID ${neteaseId}:`, detailError);
         }
        }
      }
      // -------------------------------------------------------------
      
      // 等待DOM更新
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (!audioRef.current) return;
      
      // 设置音频源
      let audioUrl = '';
      
      // 统一处理不同来源的歌曲
      if (track.hlsPlaylistUrl) {
        // 本地存储的歌曲（track来源）
        const backendUrl = 'http://localhost:8080';
        audioUrl = track.hlsPlaylistUrl.startsWith('http') 
          ? track.hlsPlaylistUrl 
          : `${backendUrl}${track.hlsPlaylistUrl}`;
          
        // 使用HLS.js加载流
        if (Hls.isSupported()) {
          console.log('使用HLS.js加载本地流:', audioUrl);
          await loadHLSStream(audioUrl);
        } else if (audioRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          console.log('使用原生HLS支持');
          audioRef.current.src = audioUrl;
        } else {
          throw new Error('您的浏览器不支持HLS播放');
        }
      } else if (track.url) {
        // 直接URL（如网易云音乐的音源）
        audioUrl = track.url;
        console.log('使用直接URL播放:', audioUrl);
        audioRef.current.src = audioUrl;
      } else if ((track as any).neteaseId || (track as any).source === 'netease') {
        // netease歌曲，需要先获取播放URL
        console.log('处理netease歌曲:', track);
        const neteaseId = (track as any).neteaseId || track.id;
        
        try {
          const response = await fetch(`/api/netease/command?command=/netease ${neteaseId}`);
          if (!response.ok) {
            throw new Error('获取播放地址失败');
          }
          
          const data = await response.json();
          if (!data.success || !data.data || data.data.length === 0) {
            throw new Error('获取播放地址失败');
          }
          
          const songData = data.data[0];
          if (!songData.url) {
            throw new Error('获取播放地址失败');
          }
          
          audioUrl = songData.url;
          console.log('获取到netease播放URL:', audioUrl);
          audioRef.current.src = audioUrl;
        } catch (error) {
          console.error('获取netease播放URL失败:', error);
          throw error;
        }
      } else if (track.filePath) {
        // 如果是MinIO的音频文件，使用filePath
        audioUrl = track.filePath;
        audioRef.current.src = audioUrl;
      }
      
      if (!audioUrl) {
        throw new Error('没有可用的音频源');
      }
      
      console.log('设置音频源:', audioUrl);
      
      // 等待音频加载
      await new Promise((resolve, reject) => {
        const handleCanPlay = () => {
          console.log('音频数据已加载');
          audioRef.current.removeEventListener('canplay', handleCanPlay);
          audioRef.current.removeEventListener('error', handleError);
          resolve(null);
        };
        
        const handleError = (error: Event) => {
          console.error('音频加载错误:', error);
          audioRef.current.removeEventListener('canplay', handleCanPlay);
          audioRef.current.removeEventListener('error', handleError);
          
          const audioElement = error.target as HTMLAudioElement;
          let errorMessage = '未知错误';
          if (audioElement.error) {
            switch (audioElement.error.code) {
              case MediaError.MEDIA_ERR_ABORTED:
                errorMessage = '音频加载被中断';
                break;
              case MediaError.MEDIA_ERR_NETWORK:
                errorMessage = '网络错误，请检查网络连接';
                break;
              case MediaError.MEDIA_ERR_DECODE:
                errorMessage = '音频解码错误，请检查音频格式';
                break;
              case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                errorMessage = '不支持的音频格式';
                break;
            }
          }
          reject(new Error(errorMessage));
        };
        
        audioRef.current.addEventListener('canplay', handleCanPlay);
        audioRef.current.addEventListener('error', handleError);
        
        setTimeout(() => {
          audioRef.current.removeEventListener('canplay', handleCanPlay);
          audioRef.current.removeEventListener('error', handleError);
          reject(new Error('音频加载超时'));
        }, 30000);
      });
      
      // 开始播放
      await audioRef.current.play();
      setPlayerState(prev => ({ ...prev, isPlaying: true }));
      
    } catch (error) {
      console.error('Error playing audio:', error);
      setPlayerState(prev => ({ ...prev, isPlaying: false }));
      
      let errorMessage = '播放失败，请重试';
      if (error instanceof Error) {
        if (error.message === '没有可用的音频源') {
          errorMessage = '无法获取音频源';
        } else if (error.message === '音频加载超时' || error.message === 'HLS加载超时') {
          errorMessage = '音频加载超时，请检查网络连接或重试';
        } else if (error.message.includes('网络错误')) {
          errorMessage = '网络错误，请检查网络连接';
        } else if (error.message.includes('解码错误')) {
          errorMessage = '音频解码错误，请检查音频格式';
        } else if (error.message.includes('不支持HLS播放')) {
          errorMessage = '您的浏览器不支持HLS播放，请使用Chrome或Firefox';
        } else {
          errorMessage = error.message;
        }
      }
      
      addToast({
        message: errorMessage,
        type: 'error',
        duration: 5000,
      });
    }
  };

  // 辅助函数：加载HLS流
  const loadHLSStream = async (audioUrl: string) => {
    return new Promise((resolve, reject) => {
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        highBufferWatchdogPeriod: 2,
        nudgeMaxRetry: 5,
        nudgeOffset: 0.1,
        startLevel: -1,
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 20000,
        levelLoadingMaxRetry: 3,
        levelLoadingRetryDelay: 1000,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 3,
        fragLoadingRetryDelay: 1000
      });
      
      hlsInstanceRef.current = hls;
      
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        console.log('HLS: 媒体已附加');
      });
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS: 清单已解析');
        audioRef.current.play().then(() => {
          resolve(null);
        }).catch(error => {
          console.error('HLS播放错误:', error);
          reject(error);
        });
      });
      
      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS错误:', data);
        if (data.fatal) {
          reject(new Error(data.details || 'HLS加载失败'));
        }
      });
      
      hls.loadSource(audioUrl);
      hls.attachMedia(audioRef.current);
      
      setTimeout(() => {
        reject(new Error('HLS加载超时'));
      }, 30000);
    });
  };
  
  // 播放/暂停切换
  const togglePlayPause = async () => {
    if (!audioRef.current || !playerState.currentTrack) return;
    
    try {
      if (playerState.isPlaying) {
        audioRef.current.pause();
        setPlayerState(prev => ({ ...prev, isPlaying: false }));
      } else {
        // 如果当前没有播放，先确保音频已加载
        if (audioRef.current.readyState < 3) { // HAVE_FUTURE_DATA
          await new Promise((resolve, reject) => {
            const handleCanPlay = () => {
              audioRef.current.removeEventListener('canplay', handleCanPlay);
              audioRef.current.removeEventListener('error', handleError);
              resolve(null);
            };
            
            const handleError = (error: Event) => {
              audioRef.current.removeEventListener('canplay', handleCanPlay);
              audioRef.current.removeEventListener('error', handleError);
              reject(error);
            };
            
            audioRef.current.addEventListener('canplay', handleCanPlay);
            audioRef.current.addEventListener('error', handleError);
          });
        }
        
        await audioRef.current.play();
        setPlayerState(prev => ({ ...prev, isPlaying: true }));
      }
    } catch (error) {
      console.error('Error toggling play/pause:', error);
      setPlayerState(prev => ({ ...prev, isPlaying: false }));
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
  
  // 更新播放列表中的特定歌曲的信息
  const updatePlaylistTrackInfo = useCallback((trackId: string | number, trackInfo: Partial<Track>) => {
    setPlayerState(prev => {
      const newPlaylist = prev.playlist.map(track => {
        const currentId = (track as any).neteaseId || (track as any).trackId || track.id;
        if (currentId === trackId) {
          return { ...track, ...trackInfo };
        }
        return track;
      });
      return { ...prev, playlist: newPlaylist };
    });
  }, [setPlayerState]);

  // 添加到播放列表
  const addToPlaylist = useCallback(async (track: Track) => {
    if (!currentUser) return;
    
    // 统一检查播放列表中是否已存在歌曲
    const trackExists = playerState.playlist.some(item => {
      // 检查不同来源的ID
      const itemId = (item as any).neteaseId || (item as any).trackId || item.id;
      const trackId = (track as any).neteaseId || (track as any).trackId || track.id;
      return itemId === trackId;
    });
    
    if (trackExists) {
      console.log('Track already exists in playlist:', track.title);
      addToast({
        message: `《${track.title}》已在播放列表中`,
        type: 'info',
        duration: 3000,
      });
      return;
    }
    
    try {
      let playlistTrack: Track = track;
      // 1. 如果是网易云，先查详情
      if ((track as any).neteaseId || (track as any).source === 'netease') {
        const neteaseId = (track as any).neteaseId || track.id;
        try {
          const detailResponse = await fetch(`/api/netease/song/detail?ids=${neteaseId}`);
          const detailData = await detailResponse.json();
          if (detailData.success && detailData.data) {
            const detail = detailData.data;
            playlistTrack = {
              ...track,
              title: detail.name || track.title,
              artist: detail.ar ? detail.ar.map((a: { name: string }) => a.name).join(', ') : track.artist,
              album: detail.al ? detail.al.name : track.album,
              coverArtPath: 'https://p1.music.126.net/tzmGFZ0-DPOulXS97H5rmA==/18712588395102549.jpg', // mock
              neteaseId: neteaseId,
            };
          } else {
            playlistTrack = {
              ...track,
              coverArtPath: 'https://p1.music.126.net/tzmGFZ0-DPOulXS97H5rmA==/18712588395102549.jpg', // mock
              neteaseId: neteaseId,
            };
          }
        } catch (e) {
          playlistTrack = {
            ...track,
            coverArtPath: 'https://p1.music.126.net/tzmGFZ0-DPOulXS97H5rmA==/18712588395102549.jpg', // mock
            neteaseId: neteaseId,
          };
        }
      } else {
        // 本地歌曲保持原有逻辑，不mock封面
        playlistTrack = {
          ...track
        };
      }
      
      console.log('Adding to playlist:', playlistTrack);

      const response = await fetch('/api/playlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
        body: JSON.stringify(playlistTrack),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Server response:', errorData);
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      // 成功添加到后端后，重新获取播放列表以更新前端状态
      await fetchPlaylist();
      
      // 如果是网易云音乐歌曲，并且成功获取到详情，更新播放列表中的信息
      if (playlistTrack.neteaseId !== undefined) {
         // 延迟一小会儿，等待fetchPlaylist更新状态
         setTimeout(async () => {
           const updatedTrackInPlaylist = playerState.playlist.find(item => {
             const itemId = (item as any).neteaseId || item.id;
             return itemId === playlistTrack.neteaseId;
           });

           if (updatedTrackInPlaylist && (updatedTrackInPlaylist as any).neteaseId) {
             const neteaseIdStr = (updatedTrackInPlaylist as any).neteaseId.toString();
             
             // 直接调用获取详情的API，绕过Player组件的useEffect
             try {
                const detailResponse = await fetch(`/api/netease/song/detail?ids=${neteaseIdStr}`);
                const detailData = await detailResponse.json();

                if(detailData.success && detailData.data) {
                    const detail = detailData.data;
                    // 调用PlayerContext中的updatePlaylistTrackInfo来更新播放列表中的歌曲信息
                    updatePlaylistTrackInfo(String(playlistTrack.neteaseId), {
                        title: detail.name,
                        artist: detail.ar ? detail.ar.map((a: { name: string }) => a.name).join(', ') : 'Unknown Artist',
                        album: detail.al ? detail.al.name : '未知专辑',
                        coverArtPath: detail.al && detail.al.picUrl ? detail.al.picUrl : '',
                    });
                } else {
                    console.warn(`Failed to fetch detail for newly added netease track ID ${playlistTrack.neteaseId}`, detailData.error);
                }
             } catch (detailError) {
                console.error(`Error fetching detail for newly added netease track ID ${playlistTrack.neteaseId}:`, detailError);
             }
           }
         }, 100); // 延迟100ms，确保playlist状态已更新
      }

      addToast({
        message: `《${track.title}》已添加到播放列表`,
        type: 'success',
        duration: 3000,
      });
    } catch (error) {
      console.error('Error adding to playlist:', error);
      addToast({
        message: error instanceof Error ? error.message : '添加到播放列表失败',
        type: 'error',
        duration: 5000,
      });
    }
  }, [currentUser, playerState.playlist, authToken, fetchPlaylist, addToast, updatePlaylistTrackInfo]);
  
  // 从播放列表移除
  const removeFromPlaylist = async (trackId: string | number) => {
    if (!currentUser) return;
    
    try {
      // 获取要删除的歌曲信息
      const trackToRemove = playerState.playlist.find(track => {
        const itemId = (track as any).neteaseId || (track as any).trackId || track.id;
        return itemId === trackId;
      });
      
      if (!trackToRemove) {
        console.error('Track not found in playlist:', trackId);
        addToast({
          message: '未找到要删除的歌曲',
          type: 'error',
          duration: 3000,
        });
        return;
      }

      // 根据歌曲类型选择正确的参数
      const isNeteaseTrack = (trackToRemove as any).neteaseId !== undefined;
      const queryParam = isNeteaseTrack ? 'neteaseId' : 'trackId';
      const idToRemove = isNeteaseTrack ? 
        (trackToRemove as any).neteaseId : 
        ((trackToRemove as any).trackId || trackToRemove.id);

      if (!idToRemove) {
        console.error('Invalid track ID:', trackId);
        addToast({
          message: '无效的歌曲ID',
          type: 'error',
          duration: 3000,
        });
        return;
      }
      
      const response = await fetch(`/api/playlist?${queryParam}=${idToRemove}`, {
        method: 'DELETE',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      await fetchPlaylist();
      addToast({
        message: '已从播放列表移除',
        type: 'success',
        duration: 3000,
      });
      
      // 如果删除的是当前播放的歌曲，切换到下一首
      if (playerState.currentTrack) {
        const currentId = (playerState.currentTrack as any).neteaseId || 
                         (playerState.currentTrack as any).trackId || 
                         playerState.currentTrack.id;
        if (currentId === trackId) {
          handleNext();
        }
      }
    } catch (error) {
      console.error('Failed to remove track from playlist:', error);
      addToast({
        message: '移除歌曲失败，请重试',
        type: 'error',
        duration: 5000,
      });
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
  
  // 保存播放状态到localStorage
  const savePlayerState = useCallback((state: PlayerState) => {
    try {
      // 创建一个最小化的状态对象，只保存必要信息
      const stateToSave = {
        currentTrack: state.currentTrack ? {
          id: state.currentTrack.id,
          title: state.currentTrack.title,
          artist: state.currentTrack.artist,
          album: state.currentTrack.album,
          coverArtPath: state.currentTrack.coverArtPath,
          position: state.currentTrack.position,
          // 不保存url和hlsPlaylistUrl
        } : null,
        isPlaying: state.isPlaying,
        volume: state.volume,
        muted: state.muted,
        currentTime: state.currentTime,
        duration: state.duration,
        playMode: state.playMode,
        playlist: state.playlist.map(item => ({
          id: item.id,
          title: item.title,
          artist: item.artist,
          album: item.album,
          coverArtPath: item.coverArtPath,
          position: item.position,
          // 不保存url和hlsPlaylistUrl
        }))
      };
      localStorage.setItem('playerState', JSON.stringify(stateToSave));
    } catch (error) {
      console.error('保存播放状态失败:', error);
    }
  }, []);

  // 从localStorage加载播放状态
  const loadPlayerState = useCallback((): PlayerState => {
    try {
      const savedState = localStorage.getItem('playerState');
      if (savedState) {
        const parsedState = JSON.parse(savedState);
        return {
          ...parsedState,
          // 确保所有必要的字段都有默认值
          currentTrack: parsedState.currentTrack || null,
          isPlaying: parsedState.isPlaying || false,
          volume: parsedState.volume || 0.7,
          muted: parsedState.muted || false,
          currentTime: parsedState.currentTime || 0,
          duration: parsedState.duration || 0,
          playMode: parsedState.playMode || PlayMode.SEQUENTIAL,
          playlist: parsedState.playlist || []
        };
      }
    } catch (error) {
      console.error('加载播放状态失败:', error);
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
  }, []);
  
  // 组件卸载时清理HLS实例
  useEffect(() => {
    return () => {
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }
    };
  }, []);
  
  // 更新播放列表
  const updatePlaylist = (newPlaylist: Track[]) => {
    setPlayerState(prev => ({
      ...prev,
      playlist: newPlaylist.map((track, index) => ({
        ...track,
        position: index
      }))
    }));
  };
  
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
        updatePlaylist,
        audioRef,
        isLoadingPlaylist,
        showPlaylist,
        setShowPlaylist,
        currentTrack: playerState.currentTrack,
        isPlaying: playerState.isPlaying,
        pauseTrack: () => {
          if (audioRef.current) {
            audioRef.current.pause();
            setPlayerState(prev => ({ ...prev, isPlaying: false }));
          }
        },
        resumeTrack: () => {
          if (audioRef.current) {
            audioRef.current.play();
            setPlayerState(prev => ({ ...prev, isPlaying: true }));
          }
        },
        stopTrack: () => {
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            setPlayerState(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
          }
        }
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