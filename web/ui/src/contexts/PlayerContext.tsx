import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Track, PlaylistItem, PlayMode, PlayerState } from '../types';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import Hls from 'hls.js';
import { authInterceptor } from '../utils/authInterceptor';

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

// 获取后端 URL，提供默认值
const getBackendUrl = () => {
  // 从全局变量读取
  if (typeof window !== 'undefined' && (window as any).__ENV__?.BACKEND_URL) {
    return (window as any).__ENV__.BACKEND_URL;
  }
  return import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';
};

export const PlayerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { currentUser, authToken, logout } = useAuth();
  const { addToast } = useToast();
  const audioRef = React.useRef<HTMLAudioElement>(new Audio());
  const hlsInstanceRef = React.useRef<Hls | null>(null);
  
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  
  // 获取后端 URL - 移动到组件顶部
  const backendUrl = getBackendUrl();
  
  const [playerState, setPlayerState] = useState<PlayerState>(() => {
    // 从localStorage中恢复播放器状态
    const savedState = localStorage.getItem('playerState');
    if (savedState) {
      try {
        const parsedState = JSON.parse(savedState);
        return {
          ...parsedState,
          // 页面刷新后重置播放状态，但保持播放进度
          isPlaying: false,
          // 保持currentTime，不要重置为0
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
  
  // 修复音频恢复逻辑 - 恢复播放进度
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // 设置音频基本属性
    audio.volume = playerState.volume;
    audio.muted = playerState.muted;

    // 如果有当前播放的歌曲，设置音频源并恢复播放进度
    if (playerState.currentTrack) {
      console.log('恢复播放器状态，当前歌曲:', playerState.currentTrack);
      console.log('恢复播放进度:', playerState.currentTime);
      
      // 设置音频源
      let audioUrl = '';
      if (playerState.currentTrack.hlsPlaylistUrl) {
        audioUrl = playerState.currentTrack.hlsPlaylistUrl.startsWith('http') 
          ? playerState.currentTrack.hlsPlaylistUrl 
          : `${backendUrl}${playerState.currentTrack.hlsPlaylistUrl}`;
        
        if (Hls.isSupported()) {
          // 为HLS流初始化，并在加载完成后设置播放位置
          const hls = new Hls({ debug: false });
          hlsInstanceRef.current = hls;
          
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log('HLS清单解析完成，设置播放位置到:', playerState.currentTime);
            // 设置播放位置
            if (playerState.currentTime > 0) {
              audio.currentTime = playerState.currentTime;
            }
          });
          
          hls.loadSource(audioUrl);
          hls.attachMedia(audio);
        } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
          audio.src = audioUrl;
          // 监听音频加载完成事件，然后设置播放位置
          const handleLoadedData = () => {
            console.log('音频数据加载完成，设置播放位置到:', playerState.currentTime);
            if (playerState.currentTime > 0) {
              audio.currentTime = playerState.currentTime;
            }
            audio.removeEventListener('loadeddata', handleLoadedData);
          };
          audio.addEventListener('loadeddata', handleLoadedData);
        }
      } else if (playerState.currentTrack.url) {
        audio.src = playerState.currentTrack.url;
        // 监听音频加载完成事件，然后设置播放位置
        const handleLoadedData = () => {
          console.log('音频数据加载完成，设置播放位置到:', playerState.currentTime);
          if (playerState.currentTime > 0) {
            audio.currentTime = playerState.currentTime;
          }
          audio.removeEventListener('loadeddata', handleLoadedData);
        };
        audio.addEventListener('loadeddata', handleLoadedData);
      } else if (playerState.currentTrack.filePath) {
        audio.src = playerState.currentTrack.filePath;
        // 监听音频加载完成事件，然后设置播放位置
        const handleLoadedData = () => {
          console.log('音频数据加载完成，设置播放位置到:', playerState.currentTime);
          if (playerState.currentTime > 0) {
            audio.currentTime = playerState.currentTime;
          }
          audio.removeEventListener('loadeddata', handleLoadedData);
        };
        audio.addEventListener('loadeddata', handleLoadedData);
      }
      
      console.log('音频源已设置，等待用户操作');
    }
  }, [backendUrl]); // 添加 backendUrl 到依赖数组
  
  // 获取播放列表
  const fetchPlaylist = async () => {
    if (!currentUser) return;
    
    setIsLoadingPlaylist(true);
    try {
      console.log('开始获取播放列表...');
      const response = await fetch(`${backendUrl}/api/playlist`, {
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });
      
      // 检查401响应
      if (response.status === 401) {
        console.log('获取播放列表收到401响应，触发登录重定向');
        authInterceptor.triggerUnauthorized();
        return;
      }
      
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
  const playTrack = useCallback(async (track: Track) => {
    console.log('🎵 开始播放歌曲:', {
      id: track.id,
      neteaseId: track.neteaseId,
      title: track.title,
      source: track.source,
      hlsPlaylistPath: track.hlsPlaylistPath,
      url: track.url,
      hasNeteaseId: !!track.neteaseId,
      hasUrl: !!track.url,
      hasHlsPath: !!track.hlsPlaylistPath
    });

    if (!audioRef.current) {
      console.error('❌ Audio element not available');
      return;
    }

    try {
      // 清理之前的HLS实例
      if (hlsInstanceRef.current) {
        console.log('🧹 清理之前的HLS实例');
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }

      // 停止当前播放
      audioRef.current.pause();
      audioRef.current.currentTime = 0;

      // 更新当前歌曲
      setPlayerState(prevState => ({
        ...prevState,
        currentTrack: track,
        isPlaying: false
      }));

      // 确定播放URL
      let playUrl = '';
      
      // 统一获取 track ID，支持不同的 ID 字段
      const trackId = track.id || track.trackId || (track as any).neteaseId;
      
      // 优先使用HLS路径（适用于网易云歌曲）
      if (track.hlsPlaylistPath) {
        playUrl = track.hlsPlaylistPath;
        console.log('🎵 使用HLS路径播放:', playUrl);
      } else if (track.url) {
        playUrl = track.url;
        console.log('🎵 使用直接URL播放:', playUrl);
      } else if (track.neteaseId || (track.source === 'netease' && trackId)) {
        // 构建网易云HLS路径
        const songId = track.neteaseId || trackId;
        playUrl = `/streams/netease/${songId}/playlist.m3u8`;
        console.log('🎵 构建网易云HLS路径:', playUrl);
      } else if (trackId) {
        // 本地上传的歌曲
        playUrl = `/streams/${trackId}/playlist.m3u8`;
        console.log('🎵 构建本地HLS路径:', playUrl);
      } else {
        throw new Error('无法确定播放URL：缺少有效的track ID');
      }

      console.log('🔗 最终播放URL:', playUrl);

      // 检查是否为HLS流
      if (playUrl.includes('.m3u8')) {
        console.log('🎥 检测到HLS流，准备使用HLS.js');
        
        if (Hls.isSupported()) {
          console.log('✅ HLS.js支持检测通过');
          
          const hls = new Hls({
            debug: true, // 启用HLS调试
            enableWorker: false,
            lowLatencyMode: false,
            backBufferLength: 90,
            maxBufferLength: 30,
            maxMaxBufferLength: 600,
            maxBufferSize: 60 * 1000 * 1000,
            maxBufferHole: 0.5,
          });

          hlsInstanceRef.current = hls;

          // HLS事件监听
          hls.on(Hls.Events.MANIFEST_LOADED, (event, data) => {
            console.log('📜 HLS Manifest加载成功:', data);
          });

          hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
            console.log('📊 HLS Level加载成功:', data);
          });

          hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
            console.log('🧩 HLS分片加载成功:', data.frag.url);
          });

          hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('❌ HLS错误:', {
              type: data.type,
              details: data.details,
              fatal: data.fatal,
              reason: data.reason,
              response: data.response,
              networkDetails: data.networkDetails
            });

            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.log('🔄 网络错误，尝试恢复...');
                  hls.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.log('🔄 媒体错误，尝试恢复...');
                  hls.recoverMediaError();
                  break;
                default:
                  console.error('💥 致命错误，销毁HLS实例');
                  hls.destroy();
                  hlsInstanceRef.current = null;
                  break;
              }
            }
          });

          // 先测试URL是否可访问
          console.log('🔍 测试HLS URL可访问性:', playUrl);
          
          try {
            const testResponse = await fetch(playUrl, { method: 'HEAD' });
            console.log('📡 HLS URL测试响应:', {
              status: testResponse.status,
              statusText: testResponse.statusText,
              headers: Object.fromEntries(testResponse.headers.entries())
            });
            
            if (testResponse.ok) {
              console.log('✅ HLS URL可访问，开始加载');
              hls.loadSource(playUrl);
              hls.attachMedia(audioRef.current);
            } else {
              console.error('❌ HLS URL不可访问:', testResponse.status, testResponse.statusText);
              throw new Error(`HLS URL不可访问: ${testResponse.status} ${testResponse.statusText}`);
            }
          } catch (fetchError) {
            console.error('❌ HLS URL测试失败:', fetchError);
            throw new Error(`无法访问音频流: ${fetchError.message}`);
          }

        } else if (audioRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          console.log('🍎 使用原生HLS支持（Safari）');
          audioRef.current.src = playUrl;
        } else {
          console.error('❌ 浏览器不支持HLS播放');
          throw new Error('浏览器不支持HLS播放');
        }
      } else {
        console.log('🎵 直接音频文件，设置src');
        audioRef.current.src = playUrl;
      }

      // 音频事件监听
      const audio = audioRef.current;
      
      const handleLoadStart = () => console.log('📥 开始加载音频');
      const handleLoadedData = () => console.log('📄 音频数据加载完成');
      const handleCanPlay = () => console.log('▶️ 音频可以开始播放');
      const handleCanPlayThrough = () => console.log('⏩ 音频可以流畅播放');
      const handlePlay = () => console.log('🎵 音频开始播放');
      const handlePlaying = () => console.log('🎶 音频正在播放');
      const handlePause = () => console.log('⏸️ 音频暂停');
      const handleEnded = () => console.log('🔚 音频播放结束');
      const handleError = (e: Event) => {
        const error = (e.target as HTMLAudioElement).error;
        console.error('❌ 音频播放错误:', {
          code: error?.code,
          message: error?.message,
          networkState: audio.networkState,
          readyState: audio.readyState,
          src: audio.src,
          currentSrc: audio.currentSrc
        });
      };

      // 添加事件监听器
      audio.addEventListener('loadstart', handleLoadStart);
      audio.addEventListener('loadeddata', handleLoadedData);
      audio.addEventListener('canplay', handleCanPlay);
      audio.addEventListener('canplaythrough', handleCanPlayThrough);
      audio.addEventListener('play', handlePlay);
      audio.addEventListener('playing', handlePlaying);
      audio.addEventListener('pause', handlePause);
      audio.addEventListener('ended', handleEnded);
      audio.addEventListener('error', handleError);

      // 清理函数
      const cleanup = () => {
        audio.removeEventListener('loadstart', handleLoadStart);
        audio.removeEventListener('loadeddata', handleLoadedData);
        audio.removeEventListener('canplay', handleCanPlay);
        audio.removeEventListener('canplaythrough', handleCanPlayThrough);
        audio.removeEventListener('play', handlePlay);
        audio.removeEventListener('playing', handlePlaying);
        audio.removeEventListener('pause', handlePause);
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('error', handleError);
      };

      // 等待音频可以播放
      await new Promise<void>((resolve, reject) => {
        const handleCanPlayResolve = () => {
          console.log('✅ 音频准备就绪，开始播放');
          cleanup();
          resolve();
        };
        
        const handleErrorReject = () => {
          console.error('❌ 音频加载失败');
          cleanup();
          reject(new Error('音频加载失败'));
        };

        audio.addEventListener('canplay', handleCanPlayResolve, { once: true });
        audio.addEventListener('error', handleErrorReject, { once: true });

        // 设置超时
        setTimeout(() => {
          cleanup();
          reject(new Error('音频加载超时'));
        }, 10000);
      });

      // 开始播放
      console.log('🎵 尝试播放音频...');
      await audioRef.current.play();
      
      setPlayerState(prevState => ({
        ...prevState,
        isPlaying: true
      }));

      console.log('✅ 音频播放成功');

    } catch (error: any) {
      console.error('❌ 播放音频失败:', {
        error: error.message,
        stack: error.stack,
        audioState: {
          networkState: audioRef.current?.networkState,
          readyState: audioRef.current?.readyState,
          src: audioRef.current?.src,
          currentSrc: audioRef.current?.currentSrc
        }
      });

      setPlayerState(prevState => ({
        ...prevState,
        isPlaying: false
      }));

      throw new Error(`播放失败: ${error.message}`);
    }
  }, []);
  
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
        // 顺序播放模式下，播放完最后一首后停止播放
        console.log('Reached end of playlist in sequential mode, stopping playback');
        if (audioRef.current) {
          audioRef.current.pause();
          setPlayerState(prev => ({ ...prev, isPlaying: false }));
        }
        return;
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
  
  // 播放/暂停切换
  const togglePlayPause = useCallback(() => {
    if (!audioRef.current) return;

    if (playerState.isPlaying) {
      audioRef.current.pause();
      setPlayerState(prev => ({ ...prev, isPlaying: false }));
    } else {
      if (playerState.currentTrack) {
        audioRef.current.play().then(() => {
          setPlayerState(prev => ({ ...prev, isPlaying: true }));
        }).catch(error => {
          console.error('播放失败:', error);
          setPlayerState(prev => ({ ...prev, isPlaying: false }));
        });
      }
    }
  }, [playerState.isPlaying, playerState.currentTrack]);

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
  
  // 调整进度 - 优化拖拽体验
  const seekTo = useCallback((time: number) => {
    if (!audioRef.current) return;
    
    // 确保时间在有效范围内
    const clampedTime = Math.max(0, Math.min(time, playerState.duration || 0));
    
    try {
      audioRef.current.currentTime = clampedTime;
      setPlayerState(prev => ({ ...prev, currentTime: clampedTime }));
    } catch (error) {
      console.error('Seek failed:', error);
    }
  }, [playerState.duration]);
  
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

      const requestData = {
        trackId: playlistTrack.source === 'netease' ? 0 : Number(playlistTrack.id),
        neteaseId: playlistTrack.source === 'netease' ? Number(playlistTrack.id) : 0,
        title: playlistTrack.title,
        artist: playlistTrack.artist || '',
        album: playlistTrack.album || '',
        coverArtPath: playlistTrack.coverArtPath,
        hlsPlaylistUrl: playlistTrack.hlsPlaylistUrl
      };

      const response = await fetch(`${backendUrl}/api/playlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
        body: JSON.stringify(requestData),
      });

      // 检查401响应
      if (response.status === 401) {
        console.log('添加到播放列表收到401响应，触发登录重定向');
        authInterceptor.triggerUnauthorized();
        return;
      }

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
                const detailResponse = await fetch(`${backendUrl}/api/netease/song/detail?ids=${neteaseIdStr}`);
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
      
      const response = await fetch(`${backendUrl}/api/playlist?${queryParam}=${idToRemove}`, {
        method: 'DELETE',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });
      
      // 检查401响应
      if (response.status === 401) {
        console.log('移除播放列表收到401响应，触发登录重定向');
        authInterceptor.triggerUnauthorized();
        return;
      }
      
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
      const response = await fetch(`${backendUrl}/api/playlist?clear=true`, {
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
      const response = await fetch(`${backendUrl}/api/playlist?shuffle=true`, {
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
      const response = await fetch(`${backendUrl}/api/playlist/all`, {
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
  
  // 监听音频事件 - 确保事件监听器正确设置
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    const handlePlay = () => {
      console.log('音频开始播放事件');
      setPlayerState(prev => ({ ...prev, isPlaying: true }));
    };
    
    const handlePause = () => {
      console.log('音频暂停事件'); 
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
      console.log('音频播放结束事件');
      // 根据播放模式处理歌曲结束后的行为
      switch (playerState.playMode) {
        case PlayMode.SEQUENTIAL:
          // 顺序播放：检查是否是最后一首
          const currentPosition = playerState.currentTrack?.position ?? -1;
          if (currentPosition === playerState.playlist.length - 1) {
            // 如果是最后一首，停止播放
            console.log('Reached end of playlist in sequential mode, stopping playback');
            setPlayerState(prev => ({ ...prev, isPlaying: false }));
          } else {
            // 不是最后一首，播放下一首
            handleNext();
          }
          break;
        case PlayMode.REPEAT_ALL:
          const currentPos = playerState.currentTrack?.position ?? -1;
          if (currentPos === playerState.playlist.length - 1) {
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
    
    const handleLoadStart = () => {
      console.log('音频开始加载');
    };
    
    const handleCanPlay = () => {
      console.log('音频可以播放');
    };
    
    const handleError = (error: Event) => {
      console.error('音频播放错误:', error);
      setPlayerState(prev => ({ ...prev, isPlaying: false }));
    };
    
    // 添加所有事件监听器
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('volumechange', handleVolumeChange);
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('error', handleError);
    
    return () => {
      // 清理所有事件监听器
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('volumechange', handleVolumeChange);
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('error', handleError);
    };
  }, [playerState.playMode, playerState.playlist, playerState.currentTrack]);
  
  // 保存播放状态到localStorage - 确保保存播放进度
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
          hlsPlaylistUrl: state.currentTrack.hlsPlaylistUrl, // 保存播放链接用于恢复
          url: state.currentTrack.url, // 保存URL用于恢复
          filePath: state.currentTrack.filePath, // 保存文件路径用于恢复
          neteaseId: (state.currentTrack as any).neteaseId, // 保存网易云ID
          source: (state.currentTrack as any).source, // 保存来源信息
        } : null,
        isPlaying: state.isPlaying,
        volume: state.volume,
        muted: state.muted,
        currentTime: state.currentTime, // 重要：保存播放进度
        duration: state.duration,
        playMode: state.playMode,
        playlist: state.playlist.map(item => ({
          id: item.id,
          title: item.title,
          artist: item.artist,
          album: item.album,
          coverArtPath: item.coverArtPath,
          position: item.position,
          hlsPlaylistUrl: item.hlsPlaylistUrl, // 保存播放链接
          neteaseId: (item as any).neteaseId, // 保存网易云ID
          source: (item as any).source, // 保存来源信息
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