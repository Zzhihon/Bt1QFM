import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Track, PlaylistItem, PlayMode, PlayerState, RoomPlaylistItem, PlaylistSource, RoomPlaylistPermissions } from '../types';
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
  currentSongId: string | number | null;
  // 播放列表来源管理（新API）
  playlistSource: PlaylistSource;
  activateRoomPlaylist: (playlist: RoomPlaylistItem[], permissions: RoomPlaylistPermissions) => void;
  deactivateRoomPlaylist: () => void;
  updateRoomPlaylist: (playlist: RoomPlaylistItem[], permissions?: Partial<RoomPlaylistPermissions>) => void;
  // 兼容旧API（将被废弃）
  enterRoomMode: (roomPlaylist?: Track[]) => void;
  exitRoomMode: () => void;
  isInRoomMode: boolean;
  setRoomPlaylistForAutoPlay: (playlist: RoomPlaylistItem[], isOwner: boolean, isListenMode: boolean, canControl?: boolean) => void;
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

  // 房间模式相关状态
  const [isInRoomMode, setIsInRoomMode] = useState(false);
  const savedPersonalPlaylistRef = React.useRef<Track[] | null>(null);
  const savedCurrentTrackRef = React.useRef<Track | null>(null);
  const savedCurrentTimeRef = React.useRef<number>(0);

  // 新的播放列表来源管理
  const [playlistSource, setPlaylistSource] = useState<PlaylistSource>('personal');
  const roomDataRef = React.useRef<{
    playlist: RoomPlaylistItem[];
    permissions: RoomPlaylistPermissions;
  }>({
    playlist: [],
    permissions: { isOwner: false, canControl: false }
  });

  // 兼容旧代码的 ref（将被废弃）
  const roomPlaylistRef = React.useRef<RoomPlaylistItem[]>([]);
  const isRoomOwnerRef = React.useRef(false);
  const isRoomListenModeRef = React.useRef(false);
  const canControlRef = React.useRef(false);

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
          isTranscoding: false, // 重置转码状态
          estimatedDuration: undefined,
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
      playlist: [],
      isTranscoding: false,
      estimatedDuration: undefined,
    };
  });
  
  // 监听playerState变化，保存到localStorage - 使用防抖避免过于频繁的写入
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      localStorage.setItem('playerState', JSON.stringify(playerState));
    }, 50); // 防抖50ms，避免过于频繁的写入
    
    return () => clearTimeout(timeoutId);
  }, [playerState]);

  // 新增：高频更新localStorage中的播放时间
  useEffect(() => {
    if (!playerState.isPlaying || !playerState.currentTrack) return;
    
    const updateInterval = setInterval(() => {
      if (audioRef.current && !isNaN(audioRef.current.currentTime)) {
        const currentTime = audioRef.current.currentTime;
        
        // 只更新localStorage，不触发状态更新以避免重渲染
        try {
          const savedState = localStorage.getItem('playerState');
          if (savedState) {
            const parsedState = JSON.parse(savedState);
            const updatedState = {
              ...parsedState,
              currentTime: currentTime,
              duration: audioRef.current.duration || parsedState.duration
            };
            localStorage.setItem('playerState', JSON.stringify(updatedState));
          }
        } catch (error) {
          console.warn('更新localStorage播放时间失败:', error);
        }
      }
    }, 100); // 每100ms更新一次播放时间到localStorage
    
    return () => clearInterval(updateInterval);
  }, [playerState.isPlaying, playerState.currentTrack]);
  
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
    if (!audioRef.current) {
      return;
    }

    try {
      // 清理之前的HLS实例
      if (hlsInstanceRef.current) {
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
      } else if (track.url) {
        playUrl = track.url;
      } else if (track.neteaseId || (track.source === 'netease' && trackId)) {
        // 构建网易云HLS路径
        const songId = track.neteaseId || trackId;
        playUrl = `/streams/netease/${songId}/playlist.m3u8`;
      } else if (trackId) {
        // 本地上传的歌曲
        playUrl = `/streams/${trackId}/playlist.m3u8`;
      } else {
        throw new Error('无法确定播放URL：缺少有效的track ID');
      }

      // 检查是否为HLS流
      if (playUrl.includes('.m3u8')) {
        if (Hls.isSupported()) {
          const hls = new Hls({
            debug: false,
            enableWorker: false,
            lowLatencyMode: false,
            backBufferLength: 90,
            maxBufferLength: 30,
            maxMaxBufferLength: 600,
            maxBufferSize: 60 * 1000 * 1000,
            maxBufferHole: 0.5,
          });

          hlsInstanceRef.current = hls;

          // 🎯 HLS 智能检测：MANIFEST_PARSED 事件
          hls.on(Hls.Events.MANIFEST_PARSED, async (event, data) => {
            console.log('📊 HLS Manifest 解析完成:', data);

            // 检测是否还在转码中（没有 EXT-X-ENDLIST 标签）
            const level = data.levels[0];
            const isTranscoding = level?.details?.live !== false;

            console.log('🔍 HLS 状态检测:', {
              isLive: level?.details?.live,
              isTranscoding,
              fragments: level?.details?.fragments?.length,
            });

            if (isTranscoding) {
              // 转码中：获取预估时长
              let estimatedDuration = 0;

              // 优先从网易云 API 获取原始时长
              if (track.neteaseId || (track.source === 'netease' && trackId)) {
                try {
                  const songId = track.neteaseId || trackId;
                  const response = await fetch(`${backendUrl}/api/netease/song/detail?ids=${songId}`);
                  const detailData = await response.json();

                  if (detailData.success && detailData.data) {
                    // 网易云返回的时长单位是毫秒
                    estimatedDuration = (detailData.data.dt || 0) / 1000;
                    console.log('✅ 从网易云获取预估时长:', estimatedDuration, '秒');
                  }
                } catch (error) {
                  console.warn('⚠️ 获取网易云歌曲时长失败:', error);
                }
              }

              // 更新状态：标记为转码中
              setPlayerState(prev => ({
                ...prev,
                isTranscoding: true,
                estimatedDuration: estimatedDuration || 180, // 默认 3 分钟
                duration: estimatedDuration || 180,
              }));

              console.log('🔄 转码中，使用预估时长:', estimatedDuration || 180, '秒');
            } else {
              // 转码完成：使用真实时长
              const realDuration = level?.details?.totalduration || audioRef.current?.duration || 0;

              setPlayerState(prev => ({
                ...prev,
                isTranscoding: false,
                estimatedDuration: undefined,
                duration: realDuration,
              }));

              console.log('✅ 转码完成，真实时长:', realDuration, '秒');
            }
          });

          // HLS 错误监听（仅保留错误处理）
          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
              console.error('❌ HLS致命错误:', data.type, data.details);
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  hls.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  hls.recoverMediaError();
                  break;
                default:
                  hls.destroy();
                  hlsInstanceRef.current = null;
                  break;
              }
            }
          });

          // 测试URL是否可访问
          try {
            const testResponse = await fetch(playUrl, { method: 'HEAD' });

            if (testResponse.ok) {
              hls.loadSource(playUrl);
              hls.attachMedia(audioRef.current);
            } else {
              throw new Error(`HLS URL不可访问: ${testResponse.status} ${testResponse.statusText}`);
            }
          } catch (fetchError) {
            throw new Error(`无法访问音频流: ${fetchError.message}`);
          }

        } else if (audioRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          audioRef.current.src = playUrl;
        } else {
          throw new Error('浏览器不支持HLS播放');
        }
      } else {
        audioRef.current.src = playUrl;
      }

      // 等待音频可以播放
      const audio = audioRef.current;
      await new Promise<void>((resolve, reject) => {
        const handleCanPlayResolve = () => {
          resolve();
        };

        const handleErrorReject = () => {
          reject(new Error('音频加载失败'));
        };

        audio.addEventListener('canplay', handleCanPlayResolve, { once: true });
        audio.addEventListener('error', handleErrorReject, { once: true });

        // 设置超时
        setTimeout(() => {
          reject(new Error('音频加载超时'));
        }, 10000);
      });

      // 开始播放
      await audioRef.current.play();
      
      setPlayerState(prevState => ({
        ...prevState,
        isPlaying: true
      }));

    } catch (error: any) {
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

  // ==================== 播放列表策略函数 ====================

  // 将 RoomPlaylistItem 转换为 Track
  const roomItemToTrack = (item: RoomPlaylistItem): Track => {
    const songId = item.songId.replace('netease_', '').replace('local_', '');
    const isLocal = item.songId.startsWith('local_');
    const hlsUrl = isLocal
      ? `/streams/${songId}/playlist.m3u8`
      : `/streams/netease/${songId}/playlist.m3u8`;

    return {
      id: songId,
      neteaseId: isLocal ? undefined : Number(songId) || undefined,
      title: item.name,
      artist: item.artist,
      album: '',
      coverArtPath: item.cover || '',
      hlsPlaylistUrl: hlsUrl,
      position: item.position,
      source: isLocal ? 'local' : 'netease',
    };
  };

  // 派发切歌同步事件
  const dispatchSongChangeEvent = (item: RoomPlaylistItem) => {
    const songId = item.songId.replace('netease_', '').replace('local_', '');
    const isLocal = item.songId.startsWith('local_');
    const hlsUrl = isLocal
      ? `/streams/${songId}/playlist.m3u8`
      : `/streams/netease/${songId}/playlist.m3u8`;

    window.dispatchEvent(new CustomEvent('player-song-change', {
      detail: {
        songId: songId,
        songName: item.name,
        artist: item.artist,
        cover: item.cover || '',
        duration: item.duration || 0,
        hlsUrl: hlsUrl,
        position: 0,
        isPlaying: true,
      }
    }));
  };

  // 获取当前歌曲在房间歌单中的索引
  const getCurrentRoomIndex = (roomPlaylist: RoomPlaylistItem[]): number => {
    const currentTrackId = String(playerState.currentTrack?.id || playerState.currentTrack?.neteaseId || '');
    return roomPlaylist.findIndex(item => {
      const itemId = item.songId.replace('netease_', '').replace('local_', '');
      return itemId === currentTrackId || item.songId === currentTrackId;
    });
  };

  // 房间播放列表 - 下一首
  const handleRoomNext = (): boolean => {
    const { playlist, permissions } = roomDataRef.current;
    const hasPermission = permissions.isOwner || permissions.canControl;

    if (!hasPermission) {
      console.log('[PlayerContext] 无切歌权限');
      return false;
    }
    if (playlist.length === 0) {
      console.log('[PlayerContext] 房间歌单为空');
      return false;
    }

    const currentIndex = getCurrentRoomIndex(playlist);
    // 循环播放：到末尾后回到开头
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % playlist.length;
    const nextItem = playlist[nextIndex];

    console.log('[PlayerContext] 房间模式切歌到下一首:', nextItem.name);
    playTrack(roomItemToTrack(nextItem));
    dispatchSongChangeEvent(nextItem);
    return true;
  };

  // 房间播放列表 - 上一首
  const handleRoomPrevious = (): boolean => {
    const { playlist, permissions } = roomDataRef.current;
    const hasPermission = permissions.isOwner || permissions.canControl;

    if (!hasPermission) {
      console.log('[PlayerContext] 无切歌权限');
      return false;
    }
    if (playlist.length === 0) {
      console.log('[PlayerContext] 房间歌单为空');
      return false;
    }

    const currentIndex = getCurrentRoomIndex(playlist);
    // 循环播放：到开头后回到末尾
    const prevIndex = currentIndex <= 0 ? playlist.length - 1 : currentIndex - 1;
    const prevItem = playlist[prevIndex];

    console.log('[PlayerContext] 房间模式切歌到上一首:', prevItem.name);
    playTrack(roomItemToTrack(prevItem));
    dispatchSongChangeEvent(prevItem);
    return true;
  };

  // 个人播放列表 - 下一首
  const handlePersonalNext = (): boolean => {
    if (playerState.playlist.length === 0) return false;

    // 随机播放模式
    if (playerState.playMode === PlayMode.SHUFFLE) {
      const randomTrack = getRandomTrack();
      if (randomTrack) {
        playTrack(randomTrack);
        return true;
      }
      return false;
    }

    // 其他播放模式
    const currentPosition = playerState.currentTrack?.position ?? -1;
    let nextPosition = 0;

    if (currentPosition !== -1) {
      // 顺序播放模式，播放完最后一首后停止
      if (playerState.playMode === PlayMode.SEQUENTIAL && currentPosition === playerState.playlist.length - 1) {
        if (audioRef.current) {
          audioRef.current.pause();
          setPlayerState(prev => ({ ...prev, isPlaying: false }));
        }
        return false;
      }
      nextPosition = (currentPosition + 1) % playerState.playlist.length;
    }

    const nextTrack = playerState.playlist.find(track => track.position === nextPosition);
    if (nextTrack) {
      playTrack(nextTrack);
      return true;
    }
    return false;
  };

  // 个人播放列表 - 上一首
  const handlePersonalPrevious = (): boolean => {
    if (playerState.playlist.length === 0) return false;

    // 随机播放模式
    if (playerState.playMode === PlayMode.SHUFFLE) {
      const randomTrack = getRandomTrack();
      if (randomTrack) {
        playTrack(randomTrack);
        return true;
      }
      return false;
    }

    // 其他播放模式
    const currentPosition = playerState.currentTrack?.position ?? -1;
    let prevPosition = playerState.playlist.length - 1;

    if (currentPosition !== -1) {
      prevPosition = (currentPosition - 1 + playerState.playlist.length) % playerState.playlist.length;
    }

    const prevTrack = playerState.playlist.find(track => track.position === prevPosition);
    if (prevTrack) {
      playTrack(prevTrack);
      return true;
    }
    return false;
  };

  // ==================== 主控制函数 ====================

  // 下一首
  const handleNext = () => {
    console.log('[PlayerContext] handleNext called, playlistSource:', playlistSource);

    if (playlistSource === 'room') {
      handleRoomNext();
    } else {
      handlePersonalNext();
    }
  };

  // 上一首
  const handlePrevious = () => {
    console.log('[PlayerContext] handlePrevious called, playlistSource:', playlistSource);

    if (playlistSource === 'room') {
      handleRoomPrevious();
    } else {
      handlePersonalPrevious();
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
      console.log('音频播放结束事件, playlistSource:', playlistSource);

      // 房间模式下，只有房主才自动播放下一首
      if (playlistSource === 'room' && roomDataRef.current.permissions.isOwner) {
        console.log('[房间模式-房主] 歌曲播放结束，自动播放下一首');
        // 使用统一的 handleRoomNext 函数
        handleRoomNext();
        return;
      }

      // 个人模式：根据播放模式处理歌曲结束后的行为
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
  }, [playerState.playMode, playerState.playlist, playerState.currentTrack, isInRoomMode, playTrack]);
  
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

  // ==================== 新的播放列表来源管理 API ====================

  // 激活房间播放列表
  const activateRoomPlaylist = useCallback((playlist: RoomPlaylistItem[], permissions: RoomPlaylistPermissions) => {
    console.log('[PlayerContext] 激活房间播放列表, 权限:', permissions);

    // 如果已经是房间模式，只更新数据不重复保存
    if (playlistSource !== 'room') {
      // 保存当前个人播放状态
      savedPersonalPlaylistRef.current = [...playerState.playlist];
      savedCurrentTrackRef.current = playerState.currentTrack;
      savedCurrentTimeRef.current = audioRef.current?.currentTime || 0;

      // 暂停当前播放
      if (audioRef.current) {
        audioRef.current.pause();
      }

      // 重置播放状态
      setPlayerState(prev => ({
        ...prev,
        currentTrack: null,
        isPlaying: false,
        currentTime: 0,
      }));
    }

    // 更新房间数据
    roomDataRef.current = { playlist, permissions };

    // 同步到旧的 ref（兼容期间）
    roomPlaylistRef.current = playlist;
    isRoomOwnerRef.current = permissions.isOwner;
    isRoomListenModeRef.current = true;
    canControlRef.current = permissions.canControl;

    // 切换到房间模式
    setPlaylistSource('room');
    setIsInRoomMode(true);

    addToast({
      type: 'info',
      message: '已切换到房间播放列表',
      duration: 2000,
    });
  }, [playlistSource, playerState.playlist, playerState.currentTrack, addToast]);

  // 停用房间播放列表，恢复个人列表
  const deactivateRoomPlaylist = useCallback(() => {
    console.log('[PlayerContext] 停用房间播放列表，恢复个人列表');

    if (playlistSource !== 'room') {
      return;
    }

    // 暂停当前播放
    if (audioRef.current) {
      audioRef.current.pause();
    }

    // 恢复个人播放状态
    const restoredPlaylist = savedPersonalPlaylistRef.current || [];
    const restoredTrack = savedCurrentTrackRef.current;
    const restoredTime = savedCurrentTimeRef.current;

    setPlayerState(prev => ({
      ...prev,
      playlist: restoredPlaylist,
      currentTrack: restoredTrack,
      isPlaying: false,
      currentTime: restoredTime,
    }));

    // 清理保存的状态
    savedPersonalPlaylistRef.current = null;
    savedCurrentTrackRef.current = null;
    savedCurrentTimeRef.current = 0;

    // 清理房间数据
    roomDataRef.current = { playlist: [], permissions: { isOwner: false, canControl: false } };

    // 同步清理旧的 ref（兼容期间）
    roomPlaylistRef.current = [];
    isRoomOwnerRef.current = false;
    isRoomListenModeRef.current = false;
    canControlRef.current = false;

    // 切换回个人模式
    setPlaylistSource('personal');
    setIsInRoomMode(false);

    addToast({
      type: 'info',
      message: '已恢复个人播放列表',
      duration: 2000,
    });
  }, [playlistSource, addToast]);

  // 更新房间播放列表（不切换模式，只更新数据）
  const updateRoomPlaylist = useCallback((playlist: RoomPlaylistItem[], permissions?: Partial<RoomPlaylistPermissions>) => {
    console.log('[PlayerContext] 更新房间播放列表, 歌曲数:', playlist.length);

    const currentPermissions = roomDataRef.current.permissions;
    const newPermissions = {
      isOwner: permissions?.isOwner ?? currentPermissions.isOwner,
      canControl: permissions?.canControl ?? currentPermissions.canControl,
    };

    roomDataRef.current = { playlist, permissions: newPermissions };

    // 同步到旧的 ref（兼容期间）
    roomPlaylistRef.current = playlist;
    isRoomOwnerRef.current = newPermissions.isOwner;
    canControlRef.current = newPermissions.canControl;
    // isRoomListenModeRef 保持当前状态
  }, []);

  // ==================== 兼容旧 API（将被废弃）====================

  // 进入房间模式 - 保存个人播放列表并切换到房间播放列表
  const enterRoomMode = useCallback((roomPlaylist?: Track[]) => {
    console.log('[PlayerContext] enterRoomMode (旧API)');

    // 如果已经是房间模式，不重复执行
    if (playlistSource === 'room' || isInRoomMode) {
      return;
    }

    // 保存当前个人播放状态
    savedPersonalPlaylistRef.current = [...playerState.playlist];
    savedCurrentTrackRef.current = playerState.currentTrack;
    savedCurrentTimeRef.current = audioRef.current?.currentTime || 0;

    // 暂停当前播放
    if (audioRef.current) {
      audioRef.current.pause();
    }

    // 切换到房间播放列表
    setPlayerState(prev => ({
      ...prev,
      playlist: roomPlaylist?.map((track, index) => ({ ...track, position: index })) || [],
      currentTrack: null,
      isPlaying: false,
      currentTime: 0,
    }));

    // 立即设置听歌模式标记
    isRoomListenModeRef.current = true;

    // 切换到房间模式
    setPlaylistSource('room');
    setIsInRoomMode(true);
    addToast({
      type: 'info',
      message: '已切换到房间播放列表',
      duration: 2000,
    });
  }, [playlistSource, isInRoomMode, playerState.playlist, playerState.currentTrack, addToast]);

  // 退出房间模式 - 恢复个人播放列表
  const exitRoomMode = useCallback(() => {
    console.log('[PlayerContext] exitRoomMode (旧API)');

    if (playlistSource !== 'room' && !isInRoomMode) {
      return;
    }

    // 暂停当前播放
    if (audioRef.current) {
      audioRef.current.pause();
    }

    // 恢复个人播放状态
    const restoredPlaylist = savedPersonalPlaylistRef.current || [];
    const restoredTrack = savedCurrentTrackRef.current;
    const restoredTime = savedCurrentTimeRef.current;

    setPlayerState(prev => ({
      ...prev,
      playlist: restoredPlaylist,
      currentTrack: restoredTrack,
      isPlaying: false,
      currentTime: restoredTime,
    }));

    // 清理保存的状态
    savedPersonalPlaylistRef.current = null;
    savedCurrentTrackRef.current = null;
    savedCurrentTimeRef.current = 0;

    // 清理房间歌单状态
    roomDataRef.current = { playlist: [], permissions: { isOwner: false, canControl: false } };
    roomPlaylistRef.current = [];
    isRoomOwnerRef.current = false;
    isRoomListenModeRef.current = false;
    canControlRef.current = false;

    // 切换回个人模式
    setPlaylistSource('personal');
    setIsInRoomMode(false);
    addToast({
      type: 'info',
      message: '已恢复个人播放列表',
      duration: 2000,
    });
  }, [playlistSource, isInRoomMode, addToast]);

  // 设置房间歌单（兼容旧API，用于房主自动播放下一首）
  const setRoomPlaylistForAutoPlay = useCallback((playlist: RoomPlaylistItem[], isOwner: boolean, isListenMode: boolean, canControl?: boolean) => {
    console.log('[PlayerContext] setRoomPlaylistForAutoPlay (旧API), isListenMode:', isListenMode, 'playlistSource:', playlistSource);

    // 更新新的数据结构
    roomDataRef.current = {
      playlist,
      permissions: { isOwner, canControl: canControl || false }
    };

    // 同步到旧的 ref
    roomPlaylistRef.current = playlist;
    isRoomOwnerRef.current = isOwner;
    isRoomListenModeRef.current = isListenMode;
    canControlRef.current = canControl || false;

    // 根据 isListenMode 同步 playlistSource
    if (isListenMode && playlistSource !== 'room') {
      // 切换到房间模式前，先保存个人播放列表（如果还没保存过）
      if (savedPersonalPlaylistRef.current === null) {
        console.log('[PlayerContext] 保存个人播放列表, 长度:', playerState.playlist.length);
        savedPersonalPlaylistRef.current = [...playerState.playlist];
        savedCurrentTrackRef.current = playerState.currentTrack;
        savedCurrentTimeRef.current = audioRef.current?.currentTime || 0;
      }
      setPlaylistSource('room');
    } else if (!isListenMode && playlistSource === 'room') {
      setPlaylistSource('personal');
    }
  }, [playlistSource, playerState.playlist, playerState.currentTrack]);

  // 监听 RoomContext 派发的歌单更新事件（解决切换页面后无法自动播放下一首的问题）
  // 使用 ref 获取最新的 playerState 以避免闭包问题
  const playerStateRef = React.useRef(playerState);
  playerStateRef.current = playerState;

  const playlistSourceRef = React.useRef(playlistSource);
  playlistSourceRef.current = playlistSource;

  useEffect(() => {
    const handleRoomPlaylistUpdate = (event: CustomEvent<{ playlist: RoomPlaylistItem[]; isOwner: boolean; isListenMode: boolean; canControl?: boolean }>) => {
      const { playlist, isOwner, isListenMode, canControl } = event.detail;

      // 更新新的数据结构
      roomDataRef.current = {
        playlist,
        permissions: { isOwner, canControl: canControl || false }
      };

      // 同步到旧的 ref
      roomPlaylistRef.current = playlist;
      isRoomOwnerRef.current = isOwner;
      isRoomListenModeRef.current = isListenMode;
      canControlRef.current = canControl || false;

      // 根据 isListenMode 同步 playlistSource
      if (isListenMode && playlistSourceRef.current !== 'room') {
        // 切换到房间模式前，先保存个人播放列表（如果还没保存过）
        if (savedPersonalPlaylistRef.current === null) {
          const currentState = playerStateRef.current;
          console.log('[PlayerContext] 事件处理：保存个人播放列表, 长度:', currentState.playlist.length);
          savedPersonalPlaylistRef.current = [...currentState.playlist];
          savedCurrentTrackRef.current = currentState.currentTrack;
          savedCurrentTimeRef.current = audioRef.current?.currentTime || 0;
        }
        setPlaylistSource('room');
      } else if (!isListenMode && playlistSourceRef.current === 'room') {
        setPlaylistSource('personal');
      }
    };

    window.addEventListener('room-playlist-update', handleRoomPlaylistUpdate as EventListener);
    return () => {
      window.removeEventListener('room-playlist-update', handleRoomPlaylistUpdate as EventListener);
    };
  }, []);

  // 获取当前歌曲ID
  const currentSongId = playerState.currentTrack
    ? (playerState.currentTrack.neteaseId || playerState.currentTrack.id)
    : null;

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
        },
        currentSongId,
        // 新 API
        playlistSource,
        activateRoomPlaylist,
        deactivateRoomPlaylist,
        updateRoomPlaylist,
        // 兼容旧 API
        enterRoomMode,
        exitRoomMode,
        isInRoomMode,
        setRoomPlaylistForAutoPlay,
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