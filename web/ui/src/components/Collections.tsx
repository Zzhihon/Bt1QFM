import React, { useState, useEffect, useCallback } from 'react';
import { 
  Music, User, ChevronRight, Play, Plus, Loader2, 
  AlertCircle, Heart, Clock, Calendar, Users
} from 'lucide-react';
import { usePlayer } from '../contexts/PlayerContext';
import { authInterceptor } from '../utils/authInterceptor';
import { retryWithDelay } from '../utils/retry';

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

  const { addToPlaylist, playTrack } = usePlayer();

  // 获取用户资料
  const fetchUserProfile = useCallback(async () => {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        setError('请先登录');
        return;
      }

      console.log('正在获取用户资料...');
      const response = await fetch('/api/user/profile', {
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
      const response = await fetch(`/api/netease/get/userids?nicknames=${encodeURIComponent(nickname)}`);
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

      const response = await fetch(`/api/netease/user/playlist?uid=${uid}`);
      
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
      const response = await fetch(`/api/netease/playlist/detail?id=${playlistId}`);
      
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

  // 添加单首歌曲到播放列表
  const handleAddSong = useCallback((song: NeteaseSong) => {
    // 处理歌曲名称，优先使用主标题
    const songTitle = song.mainTitle || song.name;
    const fullTitle = song.additionalTitle ? `${songTitle} ${song.additionalTitle}` : songTitle;
    
    const track = {
      id: song.id,
      neteaseId: song.id,
      title: fullTitle,
      artist: song.ar?.map(a => a.name).join(', ') || 'Unknown Artist',
      album: song.al?.name || 'Unknown Album',
      coverArtPath: song.al?.picUrl || '',
      duration: Math.floor((song.dt || 0) / 1000),
      source: 'netease' as const,
      hlsPlaylistPath: `/streams/netease/${song.id}/playlist.m3u8`,
      url: `http://localhost:8080/streams/netease/${song.id}/playlist.m3u8`
    };
    
    console.log('添加歌曲到播放列表:', track);
    addToPlaylist(track);
  }, [addToPlaylist]);

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
      title: fullTitle,
      artist: song.ar?.map(a => a.name).join(', ') || 'Unknown Artist',
      album: song.al?.name || 'Unknown Album',
      coverArtPath: song.al?.picUrl || '',
      duration: Math.floor((song.dt || 0) / 1000),
      source: 'netease' as const,
      hlsPlaylistPath: `/streams/netease/${song.id}/playlist.m3u8`,
      url: `http://localhost:8080/streams/netease/${song.id}/playlist.m3u8`
    };
    
    console.log('🎵 开始播放歌曲，启用重试机制:', {
      songId: song.id,
      title: track.title,
      url: track.url
    });
    setRetryingTrack(song.id);
    
    try {
      // 使用重试机制检查音频流是否可用
      await retryWithDelay(async () => {
        console.log(`🔄 重试检查音频流: ${track.url}`);
        const isAvailable = await checkStreamAvailability(track.url);
        if (!isAvailable) {
          console.log('🔄 音频流暂不可用，可能正在处理中，继续重试...');
          throw new Error(`音频流不可用: ${track.url}`);
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
  const handleAddPlaylistToQueue = useCallback(() => {
    if (!selectedPlaylist) return;

    const tracks = selectedPlaylist.playlist.tracks.map(song => {
      // 处理歌曲名称，优先使用主标题
      const songTitle = song.mainTitle || song.name;
      const fullTitle = song.additionalTitle ? `${songTitle} ${song.additionalTitle}` : songTitle;
      
      return {
        id: song.id,
        neteaseId: song.id,
        title: fullTitle,
        artist: song.ar?.map(a => a.name).join(', ') || 'Unknown Artist',
        album: song.al?.name || 'Unknown Album',
        coverArtPath: song.al?.picUrl || '',
        duration: Math.floor((song.dt || 0) / 1000),
        source: 'netease' as const,
        hlsPlaylistPath: `/streams/netease/${song.id}/playlist.m3u8`,
        url: `http://localhost:8080/streams/netease/${song.id}/playlist.m3u8`
      };
    });

    console.log('添加整个歌单到播放列表，歌曲数量:', tracks.length);
    tracks.forEach(track => addToPlaylist(track));
  }, [selectedPlaylist, addToPlaylist]);

  useEffect(() => {
    fetchUserProfile();
  }, [fetchUserProfile]);

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
      <div className="p-6">
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
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-shrink-0">
              <img 
                src={selectedPlaylist.playlist.coverImgUrl}
                alt={selectedPlaylist.playlist.name}
                className="w-48 h-48 rounded-lg object-cover"
              />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-cyber-primary mb-2">
                {selectedPlaylist.playlist.name}
              </h1>
              <div className="flex items-center text-cyber-secondary mb-4">
                <User className="h-4 w-4 mr-2" />
                <span>{selectedPlaylist.playlist.creator.nickname}</span>
              </div>
              {selectedPlaylist.playlist.description && (
                <p className="text-cyber-text mb-4 line-clamp-3">
                  {selectedPlaylist.playlist.description}
                </p>
              )}
              <div className="flex items-center gap-4 text-sm text-cyber-secondary mb-4">
                <span className="flex items-center">
                  <Music className="h-4 w-4 mr-1" />
                  {selectedPlaylist.playlist.trackCount} 首歌曲
                </span>
              </div>
              <button 
                onClick={handleAddPlaylistToQueue}
                className="flex items-center px-4 py-2 bg-cyber-primary text-cyber-bg-darker rounded hover:bg-cyber-hover-primary transition-colors"
              >
                <Plus className="h-4 w-4 mr-2" />
                添加全部到播放列表
              </button>
            </div>
          </div>
        </div>

        {/* 歌曲列表 */}
        <div className="bg-cyber-bg-darker rounded-lg overflow-hidden">
          <div className="p-4 border-b border-cyber-primary">
            <h2 className="text-lg font-semibold text-cyber-primary">
              歌曲列表 ({selectedPlaylist.playlist.tracks?.length || 0}首)
            </h2>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {selectedPlaylist.playlist.tracks && selectedPlaylist.playlist.tracks.length > 0 ? (
              selectedPlaylist.playlist.tracks.map((song, index) => {
                // 处理歌曲名称显示
                const songTitle = song.mainTitle || song.name;
                const fullTitle = song.additionalTitle ? `${songTitle} ${song.additionalTitle}` : songTitle;
                
                return (
                  <div 
                    key={song.id} 
                    className="flex items-center p-4 hover:bg-cyber-bg transition-colors border-b border-cyber-bg last:border-b-0"
                  >
                    <div className="w-8 text-center text-cyber-secondary text-sm mr-4">
                      {index + 1}
                    </div>
                    <div className="w-12 h-12 rounded mr-4 overflow-hidden flex-shrink-0">
                      <img 
                        src={song.al?.picUrl || ''}
                        alt={song.al?.name || 'Unknown Album'}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // 图片加载失败时显示默认占位符
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-cyber-primary font-medium truncate">
                        {fullTitle}
                      </div>
                      <div className="text-cyber-secondary text-sm truncate">
                        {song.ar?.map(a => a.name).join(', ') || 'Unknown Artist'} · {song.al?.name || 'Unknown Album'}
                      </div>
                      {/* 显示别名信息 */}
                      {song.alia && song.alia.length > 0 && (
                        <div className="text-cyber-secondary text-xs truncate mt-1">
                          {song.alia.join(' · ')}
                        </div>
                      )}
                    </div>
                    <div className="text-cyber-secondary text-sm mr-4">
                      {formatDuration(song.dt || 0)}
                    </div>
                    {/* 显示歌曲热度和VIP标识 */}
                    <div className="flex items-center space-x-2 mr-2">
                      {(song.fee === 1 || song.fee === 8) && (
                        <span className="text-xs bg-yellow-600 text-white px-1 py-0.5 rounded">VIP</span>
                      )}
                      {song.mv && song.mv > 0 && (
                        <span className="text-xs bg-red-600 text-white px-1 py-0.5 rounded">MV</span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <button 
                        onClick={() => handlePlaySong(song)}
                        className="p-2 text-cyber-secondary hover:text-cyber-primary transition-colors relative"
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
                        onClick={() => handleAddSong(song)}
                        className="p-2 text-cyber-secondary hover:text-cyber-primary transition-colors"
                        title="添加到播放列表"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center text-cyber-secondary">
                该歌单暂无歌曲
              </div>
            )}
          </div>
        </div>
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