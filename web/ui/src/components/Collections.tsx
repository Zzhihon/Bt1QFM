import React, { useState, useEffect, useCallback } from 'react';
import {
  Music, User, ChevronRight, Play, Plus, Loader2,
  AlertCircle, Clock, Calendar, Users, Check, CheckSquare
} from 'lucide-react';
import { usePlayer } from '../contexts/PlayerContext';
import { useRoom } from '../contexts/RoomContext';
import { useToast } from '../contexts/ToastContext';
import { authInterceptor } from '../utils/authInterceptor';
import { retryWithDelay } from '../utils/retry';
import AddToTargetMenu from './common/AddToTargetMenu';
import { Track } from '../types';

// 获取后端 URL，提供默认值
const getBackendUrl = () => {
  if (typeof window !== 'undefined' && (window as any).__ENV__?.BACKEND_URL) {
    return (window as any).__ENV__.BACKEND_URL;
  }
  return import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';
};

interface NeteasePlaylist {
  id: number;
  name: string;
  description: string | null;
  coverImgUrl: string;
  trackCount: number;
  playCount: number;
  creator: {
    nickname: string;
    avatarUrl: string;
  };
  createTime: number;
  updateTime: number;
}

interface NeteaseSong {
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
  dt: number; // 歌曲时长（毫秒）
  // 添加新的字段以支持完整的API响应
  mainTitle?: string | null;
  additionalTitle?: string | null;
  alia?: string[];
  pop?: number;
  fee?: number;
  mv?: number;
}

interface PlaylistDetail {
  playlist: {
    id: number;
    name: string;
    description: string | null;
    coverImgUrl: string;
    trackCount: number;
    creator: {
      nickname: string;
      avatarUrl: string;
    };
    createTime?: number;
    updateTime?: number;
    tracks: NeteaseSong[];
  };
}

const Collections: React.FC = () => {
  const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<{
    neteaseUsername: string;
    neteaseUID: string;
  }>({
    neteaseUsername: '',
    neteaseUID: ''
  });
  const [retryingTrack, setRetryingTrack] = useState<number | null>(null);

  // 批量选择相关状态
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState<Set<number>>(new Set());

  // 添加目标菜单状态
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);
  const [trackToAdd, setTrackToAdd] = useState<NeteaseSong | null>(null);

  const { addToPlaylist, playTrack } = usePlayer();
  const { addSong } = useRoom();
  const { addToast } = useToast();

  // 获取用户资料
  const fetchUserProfile = useCallback(async () => {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        setError('请先登录');
        return;
      }

      console.log('正在获取用户资料...');
      const response = await fetch(`${getBackendUrl()}/api/user/profile`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      console.log('用户资料API响应状态:', response.status);

      // 检查401响应
      if (response.status === 401) {
        console.log('获取用户资料收到401响应，触发登录重定向');
        authInterceptor.triggerUnauthorized();
        return;
      }

      if (response.ok) {
        const result = await response.json();
        console.log('用户资料API响应数据:', result);
        
        if (result.success && result.data) {
          const userData = {
            neteaseUsername: result.data.neteaseUsername || '',
            neteaseUID: result.data.neteaseUID || ''
          };
          
          console.log('设置用户网易云信息:', userData);
          setUserProfile(userData);
          
          // 如果有网易云信息，立即尝试获取歌单
          if (userData.neteaseUsername || userData.neteaseUID) {
            console.log('发现网易云信息，准备获取歌单');
          }
        } else {
          console.warn('API返回格式异常:', result);
        }
      } else {
        const errorText = await response.text();
        console.error('获取用户资料失败:', response.status, errorText);
        setError(`获取用户资料失败: ${response.status}`);
      }
    } catch (error) {
      console.error('获取用户资料异常:', error);
      setError('网络连接失败，请检查网络');
    }
  }, []);

  // 通过用户名获取UID
  const getUserIdByNickname = useCallback(async (nickname: string): Promise<string | null> => {
    try {
      const response = await fetch(`${getBackendUrl()}/api/netease/get/userids?nicknames=${encodeURIComponent(nickname)}`);
      const data = await response.json();
      
      if (data.success && data.data && data.data[nickname]) {
        return data.data[nickname].toString();
      }
      
      return null;
    } catch (error) {
      console.error('获取用户ID失败:', error);
      return null;
    }
  }, []);

  // 获取用户歌单
  const fetchUserPlaylists = useCallback(async () => {
    if (!userProfile.neteaseUsername && !userProfile.neteaseUID) {
      setError('请先在个人资料中绑定网易云账号');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let uid = userProfile.neteaseUID;

      // 如果没有UID，通过用户名获取
      if (!uid && userProfile.neteaseUsername) {
        uid = await getUserIdByNickname(userProfile.neteaseUsername) || '';
        if (!uid) {
          setError('无法找到该网易云用户，请检查用户名是否正确');
          setLoading(false);
          return;
        }
      }

      const response = await fetch(`${getBackendUrl()}/api/netease/user/playlist?uid=${uid}`);
      
      // 检查401响应
      if (response.status === 401) {
        console.log('获取歌单收到401响应，触发登录重定向');
        authInterceptor.triggerUnauthorized();
        return;
      }

      const data = await response.json();

      if (data.success && data.data.playlist) {
        setPlaylists(data.data.playlist);
      } else {
        setError('获取歌单失败');
      }
    } catch (error) {
      console.error('获取歌单失败:', error);
      setError('获取歌单失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  }, [userProfile, getUserIdByNickname]);

  // 获取歌单详情
  const fetchPlaylistDetail = useCallback(async (playlistId: number) => {
    setLoading(true);
    setError(null);

    try {
      console.log('正在获取歌单详情，ID:', playlistId);
      const response = await fetch(`${getBackendUrl()}/api/netease/playlist/detail?id=${playlistId}`);
      
      // 检查401响应
      if (response.status === 401) {
        console.log('获取歌单详情收到401响应，触发登录重定向');
        authInterceptor.triggerUnauthorized();
        return;
      }

      const data = await response.json();
      console.log('歌单详情API响应:', data);

      if (data.success && data.data && data.data.playlist) {
        const playlistData = data.data.playlist;
        
        // 确保tracks字段存在且为数组
        if (!playlistData.tracks) {
          playlistData.tracks = [];
        }
        
        console.log('歌单歌曲数量:', playlistData.tracks.length);
        console.log('前5首歌曲:', playlistData.tracks.slice(0, 5).map((song: NeteaseSong) => ({
          id: song.id,
          name: song.name,
          artist: song.ar?.map(a => a.name).join(', '),
          album: song.al?.name
        })));
        
        setSelectedPlaylist(data.data);
      } else {
        console.error('歌单详情API返回格式异常:', data);
        setError('获取歌单详情失败：数据格式异常');
      }
    } catch (error) {
      console.error('获取歌单详情失败:', error);
      setError('获取歌单详情失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  }, []);

  // 格式化播放次数
  const formatPlayCount = (count: number) => {
    if (count >= 100000000) {
      return (count / 100000000).toFixed(1) + '亿';
    } else if (count >= 10000) {
      return (count / 10000).toFixed(1) + '万';
    }
    return count.toString();
  };

  // 格式化时长
  const formatDuration = (milliseconds: number) => {
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // 格式化日期
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('zh-CN');
  };

  // 检查音频流是否可用
  const checkStreamAvailability = useCallback(async (url: string): Promise<boolean> => {
    try {
      console.log('🔍 检查音频流可用性:', url);
      const response = await fetch(url, { method: 'HEAD' });
      const isAvailable = response.status === 200;
      
      if (!isAvailable) {
        console.log('⚠️ 音频流不可用，状态码:', response.status);
        if (response.status === 408) {
          console.log('🔄 检测到处理超时，歌曲可能正在处理中');
        }
      } else {
        console.log('✅ 音频流验证成功');
      }
      
      return isAvailable;
    } catch (error) {
      console.error('❌ 检查音频流失败:', error);
      return false;
    }
  }, []);

  // 播放单首歌曲 - 带重试机制
  const handlePlaySong = useCallback(async (song: NeteaseSong) => {
    // 处理歌曲名称，优先使用主标题
    const songTitle = song.mainTitle || song.name;
    const fullTitle = song.additionalTitle ? `${songTitle} ${song.additionalTitle}` : songTitle;
    
    const track = {
      id: song.id,
      neteaseId: song.id,
      position: 0,
      title: fullTitle,
      artist: song.ar?.map(a => a.name).join(', ') || 'Unknown Artist',
      album: song.al?.name || 'Unknown Album',
      coverArtPath: song.al?.picUrl || '',
      duration: Math.floor((song.dt || 0) / 1000),
      source: 'netease' as const,
      hlsPlaylistUrl: `/streams/netease/${song.id}/playlist.m3u8`
    };
    
    console.log('🎵 开始播放歌曲，启用重试机制:', {
      songId: song.id,
      title: track.title,
      url: track.hlsPlaylistUrl
    });
    setRetryingTrack(song.id);
    
    try {
      // 使用重试机制检查音频流是否可用
      await retryWithDelay(async () => {
        console.log(`🔄 重试检查音频流: ${track.hlsPlaylistUrl}`);
        const isAvailable = await checkStreamAvailability(track.hlsPlaylistUrl);
        if (!isAvailable) {
          console.log('🔄 音频流暂不可用，可能正在处理中，继续重试...');
          throw new Error(`音频流不可用: ${track.hlsPlaylistUrl}`);
        }
        return true;
      }, 20, 50); // 最多重试20次，每次间隔50ms
      
      // 音频流可用后触发播放
      console.log('✅ 音频流验证成功，开始播放:', track.title);
      playTrack(track);
      
    } catch (error) {
      console.error('❌ 歌曲播放失败，音频流不可用:', error);
      setError(`播放失败，音频流不可用: ${track.title}`);
    } finally {
      setRetryingTrack(null);
    }
  }, [playTrack, checkStreamAvailability]);

  // 添加整个歌单到播放列表
  const handleAddPlaylistToQueue = useCallback(async () => {
    if (!selectedPlaylist) return;

    const tracks = selectedPlaylist.playlist.tracks.map((song, index) => {
      // 处理歌曲名称，优先使用主标题
      const songTitle = song.mainTitle || song.name;
      const fullTitle = song.additionalTitle ? `${songTitle} ${song.additionalTitle}` : songTitle;

      return {
        id: song.id,
        neteaseId: song.id,
        position: index,
        title: fullTitle,
        artist: song.ar?.map(a => a.name).join(', ') || 'Unknown Artist',
        album: song.al?.name || 'Unknown Album',
        coverArtPath: song.al?.picUrl || '',
        duration: Math.floor((song.dt || 0) / 1000),
        source: 'netease' as const,
        hlsPlaylistUrl: `/streams/netease/${song.id}/playlist.m3u8`
      };
    });

    console.log('添加整个歌单到播放列表，歌曲数量:', tracks.length);
    
    try {
      // 逐个添加歌曲，避免批量请求导致的问题
      for (const track of tracks) {
        await addToPlaylist(track);
      }
      console.log('✅ 成功添加整个歌单到播放列表');
    } catch (error) {
      console.error('❌ 添加歌单到播放列表失败:', error);
      setError(`添加歌单失败: ${selectedPlaylist.playlist.name}`);
    }
  }, [selectedPlaylist, addToPlaylist]);

  // 将 NeteaseSong 转换为 Track 类型
  const convertSongToTrack = useCallback((song: NeteaseSong): Track => {
    const songTitle = song.mainTitle || song.name;
    const fullTitle = song.additionalTitle ? `${songTitle} ${song.additionalTitle}` : songTitle;

    return {
      id: song.id,
      neteaseId: song.id,
      position: 0, // 默认位置，添加到播放列表时会被更新
      title: fullTitle,
      artist: song.ar?.map(a => a.name).join(', ') || 'Unknown Artist',
      album: song.al?.name || 'Unknown Album',
      coverArtPath: song.al?.picUrl || '',
      duration: Math.floor((song.dt || 0) / 1000),
      source: 'netease' as const,
      hlsPlaylistUrl: `/streams/netease/${song.id}/playlist.m3u8`
    };
  }, []);

  // 切换选择模式
  const toggleSelectMode = useCallback(() => {
    setIsSelectMode(prev => !prev);
    if (isSelectMode) {
      setSelectedTracks(new Set());
    }
  }, [isSelectMode]);

  // 切换单个歌曲选择
  const toggleTrackSelection = useCallback((trackId: number) => {
    setSelectedTracks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(trackId)) {
        newSet.delete(trackId);
      } else {
        newSet.add(trackId);
      }
      return newSet;
    });
  }, []);

  // 全选/取消全选
  const toggleSelectAll = useCallback(() => {
    if (!selectedPlaylist) return;
    const allTracks = selectedPlaylist.playlist.tracks || [];
    if (selectedTracks.size === allTracks.length) {
      setSelectedTracks(new Set());
    } else {
      setSelectedTracks(new Set(allTracks.map(t => t.id)));
    }
  }, [selectedTracks.size, selectedPlaylist]);

  // 打开添加菜单（单个歌曲）
  const handleOpenAddMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>, song: NeteaseSong) => {
    e.stopPropagation();
    setTrackToAdd(song);
    setAddMenuAnchor(e.currentTarget);
    setShowAddMenu(true);
  }, []);

  // 打开添加菜单（批量）
  const handleOpenBatchAddMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setTrackToAdd(null);
    setAddMenuAnchor(e.currentTarget);
    setShowAddMenu(true);
  }, []);

  // 添加到个人播放列表
  const handleAddToPersonal = useCallback(async () => {
    if (!selectedPlaylist) return;

    if (trackToAdd) {
      // 单个添加
      const track = convertSongToTrack(trackToAdd);
      await addToPlaylist(track);
      addToast({
        message: `已添加 "${track.title}" 到播放列表`,
        type: 'success',
        duration: 3000,
      });
    } else if (selectedTracks.size > 0) {
      // 批量添加
      const songsToAdd = selectedPlaylist.playlist.tracks.filter(s => selectedTracks.has(s.id));
      for (const song of songsToAdd) {
        const track = convertSongToTrack(song);
        await addToPlaylist(track);
      }
      addToast({
        message: `已添加 ${songsToAdd.length} 首歌曲到播放列表`,
        type: 'success',
        duration: 3000,
      });
      setSelectedTracks(new Set());
      setIsSelectMode(false);
    }
  }, [trackToAdd, selectedTracks, selectedPlaylist, addToPlaylist, convertSongToTrack, addToast]);

  // 添加到聊天室
  const handleAddToRoom = useCallback(async (_roomId: string) => {
    if (!selectedPlaylist) return;

    const songsToAdd = trackToAdd
      ? [trackToAdd]
      : selectedPlaylist.playlist.tracks.filter(s => selectedTracks.has(s.id));

    for (const song of songsToAdd) {
      const songTitle = song.mainTitle || song.name;
      const fullTitle = song.additionalTitle ? `${songTitle} ${song.additionalTitle}` : songTitle;

      addSong({
        songId: `netease_${song.id}`,
        name: fullTitle,
        artist: song.ar?.map(a => a.name).join(', ') || 'Unknown Artist',
        cover: song.al?.picUrl || '',
        duration: song.dt || 0,
        source: 'netease',
        hlsUrl: `/streams/netease/${song.id}/playlist.m3u8`,
      });
    }

    addToast({
      message: `已添加 ${songsToAdd.length} 首歌曲到房间`,
      type: 'success',
      duration: 3000,
    });

    if (!trackToAdd) {
      setSelectedTracks(new Set());
      setIsSelectMode(false);
    }
  }, [trackToAdd, selectedTracks, selectedPlaylist, addSong, addToast]);

  useEffect(() => {
    fetchUserProfile();
  }, [fetchUserProfile]);

  // 切换歌单时重置选择状态
  useEffect(() => {
    setIsSelectMode(false);
    setSelectedTracks(new Set());
  }, [selectedPlaylist]);

  useEffect(() => {
    if (userProfile.neteaseUsername || userProfile.neteaseUID) {
      fetchUserPlaylists();
    }
  }, [userProfile, fetchUserPlaylists]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-cyber-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-center">
        <AlertCircle className="h-16 w-16 text-cyber-red mb-4" />
        <p className="text-cyber-red mb-4">{error}</p>
        <button 
          onClick={fetchUserPlaylists}
          className="px-4 py-2 bg-cyber-primary text-cyber-bg-darker rounded hover:bg-cyber-hover-primary transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  if (selectedPlaylist) {
    return (
      <div className="p-6 min-h-screen">
        {/* 返回按钮 */}
        <button 
          onClick={() => setSelectedPlaylist(null)}
          className="mb-6 flex items-center text-cyber-secondary hover:text-cyber-primary transition-colors"
        >
          <ChevronRight className="h-5 w-5 rotate-180 mr-2" />
          返回歌单列表
        </button>

        {/* 歌单信息 */}
        <div className="bg-cyber-bg-darker rounded-lg p-6 mb-6">
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-shrink-0">
              <img 
                src={selectedPlaylist.playlist.coverImgUrl}
                alt={selectedPlaylist.playlist.name}
                className="w-64 h-64 rounded-lg object-cover shadow-lg"
              />
            </div>
            <div className="flex-1 space-y-4">
              <div>
                <h1 className="text-3xl font-bold text-cyber-primary mb-2">
                  {selectedPlaylist.playlist.name}
                </h1>
                <div className="flex items-center text-cyber-secondary mb-3">
                  <User className="h-4 w-4 mr-2" />
                  <span className="text-lg">{selectedPlaylist.playlist.creator.nickname}</span>
                </div>
              </div>

              {/* 歌单统计信息 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4 border-y border-cyber-bg">
                <div className="text-center">
                  <div className="text-2xl font-bold text-cyber-primary">
                    {selectedPlaylist.playlist.trackCount}
                  </div>
                  <div className="text-sm text-cyber-secondary flex items-center justify-center">
                    <Music className="h-3 w-3 mr-1" />
                    歌曲
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-cyber-primary">
                    {Math.floor(selectedPlaylist.playlist.tracks.reduce((total, song) => total + (song.dt || 0), 0) / 60000)}
                  </div>
                  <div className="text-sm text-cyber-secondary flex items-center justify-center">
                    <Clock className="h-3 w-3 mr-1" />
                    分钟
                  </div>
                </div>
                {selectedPlaylist.playlist.createTime && (
                  <div className="text-center">
                    <div className="text-lg font-bold text-cyber-primary">
                      {formatDate(selectedPlaylist.playlist.createTime).split('/')[0]}
                    </div>
                    <div className="text-sm text-cyber-secondary flex items-center justify-center">
                      <Calendar className="h-3 w-3 mr-1" />
                      创建年份
                    </div>
                  </div>
                )}
                {selectedPlaylist.playlist.updateTime && (
                  <div className="text-center">
                    <div className="text-lg font-bold text-cyber-primary">
                      {formatDate(selectedPlaylist.playlist.updateTime)}
                    </div>
                    <div className="text-sm text-cyber-secondary">
                      最后更新
                    </div>
                  </div>
                )}
              </div>

              {/* 歌单描述 */}
              {selectedPlaylist.playlist.description && (
                <div className="bg-cyber-bg rounded-lg p-4">
                  <h3 className="text-cyber-primary font-semibold mb-2">简介</h3>
                  <p className="text-cyber-text text-sm leading-relaxed whitespace-pre-wrap">
                    {selectedPlaylist.playlist.description}
                  </p>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex flex-wrap gap-3 pt-2">
                <button 
                  onClick={handleAddPlaylistToQueue}
                  className="flex items-center px-6 py-3 bg-cyber-primary text-cyber-bg-darker rounded-lg hover:bg-cyber-hover-primary transition-colors font-medium"
                >
                  <Plus className="h-5 w-5 mr-2" />
                  添加全部到播放列表
                </button>
                <button 
                  onClick={() => handlePlaySong(selectedPlaylist.playlist.tracks[0])}
                  className="flex items-center px-6 py-3 bg-transparent border border-cyber-primary text-cyber-primary rounded-lg hover:bg-cyber-primary hover:text-cyber-bg-darker transition-colors font-medium"
                  disabled={!selectedPlaylist.playlist.tracks.length}
                >
                  <Play className="h-5 w-5 mr-2" />
                  播放全部
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 歌曲列表 */}
        <div className="bg-cyber-bg-darker rounded-lg overflow-hidden">
          <div className="p-6 border-b border-cyber-primary">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <h2 className="text-xl font-semibold text-cyber-primary">
                歌曲列表
              </h2>
              <div className="flex items-center space-x-3">
                {/* 批量选择按钮组 */}
                <button
                  onClick={toggleSelectMode}
                  className={`flex items-center ${isSelectMode ? 'bg-cyber-primary text-cyber-bg-darker' : 'bg-cyber-bg text-cyber-secondary'} hover:bg-cyber-hover-secondary font-semibold py-2 px-4 rounded-lg shadow-md transition-all duration-300`}
                >
                  {isSelectMode ? <Check className="mr-2 h-4 w-4" /> : <CheckSquare className="mr-2 h-4 w-4" />}
                  {isSelectMode ? '取消选择' : '批量操作'}
                </button>
                {isSelectMode && (
                  <>
                    <button
                      onClick={toggleSelectAll}
                      className="flex items-center bg-cyber-bg text-cyber-secondary hover:bg-cyber-hover-secondary font-semibold py-2 px-4 rounded-lg shadow-md transition-all duration-300"
                    >
                      {selectedTracks.size === (selectedPlaylist.playlist.tracks?.length || 0) ? '取消全选' : '全选'}
                    </button>
                    {selectedTracks.size > 0 && (
                      <button
                        onClick={handleOpenBatchAddMenu}
                        className="flex items-center bg-cyber-secondary text-cyber-bg-darker hover:bg-cyber-hover-secondary font-semibold py-2 px-4 rounded-lg shadow-md transition-all duration-300"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        添加 {selectedTracks.size} 首
                      </button>
                    )}
                  </>
                )}
                <span className="text-cyber-secondary">
                  共 {selectedPlaylist.playlist.tracks?.length || 0} 首歌曲
                </span>
              </div>
            </div>
          </div>

          {/* 列表头部 */}
          <div className="px-6 py-3 bg-cyber-bg border-b border-cyber-bg text-cyber-secondary text-sm">
            <div className="flex items-center">
              {isSelectMode && <div className="w-10"></div>}
              <div className="w-12 text-center">#</div>
              <div className="w-16 mr-4"></div>
              <div className="flex-1">歌曲信息</div>
              <div className="w-20 text-center">时长</div>
              <div className="w-24 text-center">操作</div>
            </div>
          </div>

          {/* 歌曲列表内容 */}
          <div className="divide-y divide-cyber-bg">
            {selectedPlaylist.playlist.tracks && selectedPlaylist.playlist.tracks.length > 0 ? (
              selectedPlaylist.playlist.tracks.map((song, index) => {
                // 处理歌曲名称显示
                const songTitle = song.mainTitle || song.name;
                const fullTitle = song.additionalTitle ? `${songTitle} ${song.additionalTitle}` : songTitle;
                const isChecked = selectedTracks.has(song.id);

                return (
                  <div
                    key={song.id}
                    className={`flex items-center px-6 py-4 hover:bg-cyber-bg transition-colors group ${isChecked ? 'bg-cyber-bg/50' : ''} ${isSelectMode ? 'cursor-pointer' : ''}`}
                    onClick={isSelectMode ? () => toggleTrackSelection(song.id) : undefined}
                  >
                    {/* 复选框 */}
                    {isSelectMode && (
                      <div className="w-10 flex-shrink-0">
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${isChecked ? 'bg-cyber-primary border-cyber-primary' : 'bg-cyber-bg/80 border-cyber-secondary'}`}>
                          {isChecked && <Check className="h-3 w-3 text-cyber-bg-darker" />}
                        </div>
                      </div>
                    )}

                    <div className="w-12 text-center text-cyber-secondary text-sm">
                      {!isSelectMode && (
                        <>
                          <span className="group-hover:hidden">{index + 1}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlaySong(song);
                            }}
                            className="hidden group-hover:block p-1 text-cyber-primary hover:text-cyber-hover-primary transition-colors"
                            disabled={retryingTrack === song.id}
                          >
                            {retryingTrack === song.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </button>
                        </>
                      )}
                      {isSelectMode && <span>{index + 1}</span>}
                    </div>

                    <div className="w-16 h-16 rounded-lg mr-4 overflow-hidden flex-shrink-0 shadow-sm">
                      <img
                        src={song.al?.picUrl || ''}
                        alt={song.al?.name || 'Unknown Album'}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>

                    <div className="flex-1 min-w-0 pr-4">
                      <div className="text-cyber-primary font-medium truncate text-base mb-1">
                        {fullTitle}
                      </div>
                      <div className="text-cyber-secondary text-sm truncate mb-1">
                        {song.ar?.map(a => a.name).join(', ') || 'Unknown Artist'}
                      </div>
                      <div className="text-cyber-secondary text-xs truncate">
                        专辑: {song.al?.name || 'Unknown Album'}
                      </div>
                      {/* 显示别名信息 */}
                      {song.alia && song.alia.length > 0 && (
                        <div className="text-cyber-secondary text-xs truncate mt-1 opacity-75">
                          别名: {song.alia.join(' · ')}
                        </div>
                      )}
                    </div>

                    <div className="w-20 text-center text-cyber-secondary text-sm">
                      {formatDuration(song.dt || 0)}
                    </div>

                    <div className="w-24 flex items-center justify-center space-x-2">
                      {!isSelectMode && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlaySong(song);
                            }}
                            className="p-2 text-cyber-secondary hover:text-cyber-primary transition-colors opacity-0 group-hover:opacity-100"
                            title="播放"
                            disabled={retryingTrack === song.id}
                          >
                            {retryingTrack === song.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            onClick={(e) => handleOpenAddMenu(e, song)}
                            className="p-2 text-cyber-secondary hover:text-cyber-primary transition-colors opacity-0 group-hover:opacity-100"
                            title="添加到..."
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-12 text-center text-cyber-secondary">
                <Music className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>该歌单暂无歌曲</p>
              </div>
            )}
          </div>
        </div>

        {/* 添加目标选择菜单 */}
        <AddToTargetMenu
          isOpen={showAddMenu}
          onClose={() => {
            setShowAddMenu(false);
            setTrackToAdd(null);
          }}
          onAddToPersonal={handleAddToPersonal}
          onAddToRoom={handleAddToRoom}
          anchorEl={addMenuAnchor}
          track={trackToAdd ? convertSongToTrack(trackToAdd) : undefined}
          tracks={!trackToAdd && selectedTracks.size > 0 && selectedPlaylist
            ? selectedPlaylist.playlist.tracks
                .filter(s => selectedTracks.has(s.id))
                .map(convertSongToTrack)
            : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-cyber-primary">我的收藏</h1>
        <button 
          onClick={fetchUserPlaylists}
          className="px-4 py-2 bg-cyber-primary text-cyber-bg-darker rounded hover:bg-cyber-hover-primary transition-colors"
        >
          刷新
        </button>
      </div>

      {playlists.length === 0 ? (
        <div className="text-center py-12">
          <Music className="h-16 w-16 text-cyber-secondary mx-auto mb-4" />
          <p className="text-cyber-secondary">
            {userProfile.neteaseUsername || userProfile.neteaseUID 
              ? '暂无歌单数据' 
              : '请先在个人资料中绑定网易云账号'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {playlists.map((playlist) => (
            <div 
              key={playlist.id}
              className="bg-cyber-bg-darker rounded-lg overflow-hidden hover:bg-cyber-bg transition-colors cursor-pointer"
              onClick={() => fetchPlaylistDetail(playlist.id)}
            >
              <div className="relative">
                <img 
                  src={playlist.coverImgUrl}
                  alt={playlist.name}
                  className="w-full h-48 object-cover"
                />
                <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center">
                  <Users className="h-3 w-3 mr-1" />
                  {formatPlayCount(playlist.playCount)}
                </div>
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-cyber-primary mb-2 truncate">
                  {playlist.name}
                </h3>
                <p className="text-cyber-secondary text-sm mb-2 line-clamp-2">
                  {playlist.description || '暂无描述'}
                </p>
                <div className="flex items-center justify-between text-xs text-cyber-secondary">
                  <span className="flex items-center">
                    <Music className="h-3 w-3 mr-1" />
                    {playlist.trackCount}首
                  </span>
                  <span className="flex items-center">
                    <Calendar className="h-3 w-3 mr-1" />
                    {formatDate(playlist.updateTime)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Collections;