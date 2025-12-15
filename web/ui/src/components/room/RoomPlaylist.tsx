import React, { useState, useEffect, useRef } from 'react';
import { useRoom } from '../../contexts/RoomContext';
import { usePlayer } from '../../contexts/PlayerContext';
import { useToast } from '../../contexts/ToastContext';
import {
  Music,
  Trash2,
  Plus,
  Search,
  X,
  Disc3,
  Clock,
  PlayCircle,
  GripVertical,
} from 'lucide-react';
import type { RoomPlaylistItem, Track } from '../../types/index';

const RoomPlaylist: React.FC = () => {
  const { addToast } = useToast();
  const { playlist, myMember, addSong, removeSong, reorderPlaylist } = useRoom();
  const { playTrack, playerState } = usePlayer();
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // 本地封面缓存，用于补充服务端缺失的封面
  const [coverCache, setCoverCache] = useState<Record<string, string>>({});
  const fetchedIdsRef = useRef<Set<string>>(new Set());

  // 拖拽状态
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // 当 playlist 变化时，获取缺失的封面
  useEffect(() => {
    const fetchMissingCovers = async () => {
      // 找出没有封面且尚未获取过的歌曲
      const songsNeedCover = playlist.filter(item => {
        const songId = item.songId.replace('netease_', '');
        return !item.cover && !coverCache[songId] && !fetchedIdsRef.current.has(songId);
      });

      if (songsNeedCover.length === 0) return;

      // 标记为正在获取
      songsNeedCover.forEach(item => {
        const songId = item.songId.replace('netease_', '');
        fetchedIdsRef.current.add(songId);
      });

      // 批量获取歌曲详情
      const songIds = songsNeedCover.map(item => item.songId.replace('netease_', '')).join(',');

      try {
        const response = await fetch(`/api/netease/song/detail?ids=${songIds}`);
        const data = await response.json();

        if (data.success && data.data) {
          const details = Array.isArray(data.data) ? data.data : [data.data];
          const newCovers: Record<string, string> = {};

          details.forEach((detail: any) => {
            if (detail && detail.id && detail.al?.picUrl) {
              newCovers[String(detail.id)] = detail.al.picUrl;
            }
          });

          if (Object.keys(newCovers).length > 0) {
            setCoverCache(prev => ({ ...prev, ...newCovers }));
          }
        }
      } catch (error) {
        console.warn('获取封面失败:', error);
      }
    };

    fetchMissingCovers();
  }, [playlist, coverCache]);

  // 获取歌曲封面（优先使用 item.cover，其次使用缓存）
  const getCover = (item: RoomPlaylistItem): string => {
    if (item.cover) return item.cover;
    const songId = item.songId.replace('netease_', '');
    return coverCache[songId] || '';
  };

  // 检查是否可以控制
  const canControl = myMember?.role === 'owner' || myMember?.role === 'admin' || myMember?.canControl;

  // 格式化时长
  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 搜索歌曲（调用网易云 API - 使用与 BotView 相同的方式）
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      // 先搜索
      const response = await fetch(`/api/netease/search?q=${encodeURIComponent(searchQuery)}&limit=20`);
      if (!response.ok) {
        throw new Error('搜索失败');
      }
      const data = await response.json();

      if (data.success && data.data) {
        const searchData = data.data;

        // 获取歌曲详情以获取完整封面 - 逐个获取确保正确
        const detailsMap = new Map<number, any>();

        // 批量获取可能有问题，改为逐个获取前20首歌的详情
        const fetchPromises = searchData.slice(0, 20).map(async (item: any) => {
          try {
            const detailResponse = await fetch(`/api/netease/song/detail?ids=${item.id}`);
            const detailData = await detailResponse.json();

            if (detailData.success && detailData.data) {
              const detail = detailData.data;
              if (detail && detail.id) {
                detailsMap.set(detail.id, detail);
              }
            }
          } catch (e) {
            console.warn(`获取歌曲 ${item.id} 详情失败`);
          }
        });

        // 并行获取所有详情
        await Promise.all(fetchPromises);

        // 合并数据
        const enrichedResults = searchData.map((item: any) => {
          const detail = detailsMap.get(item.id);
          return {
            ...item,
            // 优先使用详情接口的封面（detail.al.picUrl）
            picUrl: detail?.al?.picUrl || item.picUrl || '',
          };
        });

        setSearchResults(enrichedResults);
      } else {
        addToast({ type: 'error', message: data.error || '搜索失败', duration: 3000 });
      }
    } catch (error) {
      console.error('Search error:', error);
      addToast({ type: 'error', message: '搜索出错', duration: 3000 });
    } finally {
      setIsSearching(false);
    }
  };

  // 添加歌曲到歌单
  const handleAddSong = (song: any) => {
    const item: Omit<RoomPlaylistItem, 'position' | 'addedBy' | 'addedAt'> = {
      songId: `netease_${song.id}`,
      name: song.name,
      // API 返回的 artists 是字符串数组
      artist: song.artists?.join(', ') || '未知艺人',
      // 使用已获取的封面
      cover: song.picUrl || '',
      duration: Math.floor((song.duration || 0) / 1000),
      source: 'netease',
    };

    addSong(item);
    addToast({ type: 'success', message: `已添加 "${song.name}"`, duration: 2000 });
    setShowAddModal(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  // 删除歌曲
  const handleRemoveSong = (item: RoomPlaylistItem) => {
    removeSong(item.position);
    addToast({ type: 'info', message: `已移除 "${item.name}"`, duration: 2000 });
  };

  // 点击播放歌曲（房主或有控制权限的用户可操作）
  const handlePlaySong = (item: RoomPlaylistItem) => {
    if (!canControl) {
      addToast({ type: 'info', message: '需要房主授权才能选择播放歌曲', duration: 2000 });
      return;
    }

    // 检查是否在听歌模式
    if (myMember?.mode !== 'listen') {
      addToast({ type: 'info', message: '请先切换到听歌模式', duration: 2000 });
      return;
    }

    // 根据 source 类型构建正确的 HLS URL
    const source = item.source || 'netease';
    let hlsUrl: string;
    let actualId: string;

    if (source === 'local') {
      // 本地歌曲：songId 格式为 "local_123"，URL 为 /streams/123/playlist.m3u8
      actualId = item.songId.replace('local_', '');
      hlsUrl = `/streams/${actualId}/playlist.m3u8`;
    } else {
      // 网易云歌曲：songId 格式为 "netease_123" 或 "123"，URL 为 /streams/netease/123/playlist.m3u8
      actualId = item.songId.replace('netease_', '');
      hlsUrl = `/streams/netease/${actualId}/playlist.m3u8`;
    }

    const track: Track = {
      id: actualId,
      neteaseId: source === 'netease' ? (Number(actualId) || undefined) : undefined,
      title: item.name,
      artist: item.artist,
      album: '',
      coverArtPath: getCover(item) || '',
      hlsPlaylistUrl: hlsUrl,
      position: 0,
      source: source as 'netease' | 'local',
    };

    playTrack(track);

    // 派发切歌同步事件，通知后端同步给其他用户
    window.dispatchEvent(new CustomEvent('player-song-change', {
      detail: {
        songId: actualId,
        songName: item.name,
        artist: item.artist,
        cover: getCover(item) || '',
        duration: item.duration || 0,
        hlsUrl: hlsUrl,
        position: 0,
        isPlaying: true,
      }
    }));

    addToast({ type: 'success', message: `正在播放: ${item.name}`, duration: 2000 });
  };

  // 拖拽开始
  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (!canControl) {
      e.preventDefault();
      return;
    }
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    // 设置拖拽时的样式
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '0.5';
  };

  // 拖拽结束
  const handleDragEnd = (e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '1';
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // 拖拽悬停
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndex !== null && index !== draggedIndex) {
      setDragOverIndex(index);
    }
  };

  // 拖拽离开
  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  // 放置
  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = draggedIndex;
    if (fromIndex !== null && fromIndex !== toIndex) {
      reorderPlaylist(fromIndex, toIndex);
      addToast({ type: 'info', message: '已调整歌曲顺序', duration: 1500 });
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 歌单列表 */}
      <div className="flex-1 overflow-y-auto">
        {playlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-cyber-secondary/50 p-4">
            <Disc3 className="w-16 h-16 mb-4" />
            <p className="text-sm mb-4">歌单是空的</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-cyber-primary text-cyber-bg rounded-lg hover:bg-cyber-hover-primary transition-colors flex items-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>添加歌曲</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-cyber-secondary/10">
            {playlist.map((item, index) => {
              // 检查是否是当前播放的歌曲
              const songId = item.songId.replace('netease_', '');
              const isCurrentPlaying = String(playerState.currentTrack?.id) === songId ||
                String(playerState.currentTrack?.neteaseId) === songId;
              const isDragOver = dragOverIndex === index;

              return (
                <div
                  key={`${item.songId}-${index}`}
                  draggable={canControl}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onClick={() => handlePlaySong(item)}
                  className={`flex items-center p-3 transition-all cursor-pointer group ${
                    isCurrentPlaying ? 'bg-cyber-primary/10' : 'hover:bg-cyber-bg-darker/30'
                  } ${isDragOver ? 'border-t-2 border-cyber-primary bg-cyber-primary/5' : ''} ${
                    draggedIndex === index ? 'opacity-50' : ''
                  }`}
                >
                  {/* 拖拽手柄 */}
                  {canControl && (
                    <div
                      className="w-6 flex-shrink-0 cursor-grab active:cursor-grabbing mr-1 text-cyber-secondary/30 hover:text-cyber-secondary/60 transition-colors"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <GripVertical className="w-4 h-4" />
                    </div>
                  )}

                  {/* 序号/播放指示 */}
                  <div className="w-6 flex-shrink-0 text-center">
                    {isCurrentPlaying ? (
                      <div className="flex items-center justify-center">
                        <div className="w-2 h-2 bg-cyber-primary rounded-full animate-pulse" />
                      </div>
                    ) : (
                      <div className="relative">
                        <span className="text-xs text-cyber-secondary/50 group-hover:opacity-0">{index + 1}</span>
                        {canControl && (
                          <PlayCircle className="w-4 h-4 text-cyber-primary absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </div>
                    )}
                  </div>

                  {/* 封面 */}
                  <div className="w-10 h-10 rounded overflow-hidden bg-cyber-bg-darker/50 flex-shrink-0 mr-3">
                    {getCover(item) ? (
                      <img
                        src={getCover(item)}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music className="w-5 h-5 text-cyber-secondary/30" />
                      </div>
                    )}
                  </div>

                  {/* 歌曲信息 */}
                  <div className="flex-1 min-w-0 mr-3">
                    <p
                      className={`text-sm font-medium truncate ${
                        isCurrentPlaying ? 'text-cyber-primary' : 'text-cyber-text'
                      }`}
                    >
                      {item.name}
                    </p>
                    <p className="text-xs text-cyber-secondary/70 truncate">{item.artist}</p>
                  </div>

                  {/* 时长 */}
                  <div className="flex items-center space-x-1 text-xs text-cyber-secondary/50 mr-3">
                    <Clock className="w-3 h-3" />
                    <span>{formatDuration(item.duration)}</span>
                  </div>

                  {/* 删除按钮 */}
                  {canControl && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveSong(item);
                      }}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-cyber-secondary/50 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部添加按钮 */}
      {playlist.length > 0 && (
        <div className="p-3 bg-cyber-bg-darker/30 border-t border-cyber-secondary/10">
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full py-2 bg-cyber-primary/10 text-cyber-primary rounded-lg hover:bg-cyber-primary/20 transition-colors flex items-center justify-center space-x-2"
          >
            <Plus className="w-4 h-4" />
            <span>添加歌曲</span>
          </button>
        </div>
      )}

      {/* 添加歌曲弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-cyber-bg-darker rounded-xl w-full max-w-md max-h-[80vh] flex flex-col border border-cyber-secondary/20">
            {/* 标题 */}
            <div className="flex items-center justify-between p-4 border-b border-cyber-secondary/10">
              <h3 className="text-lg font-semibold text-cyber-text">添加歌曲</h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                className="p-2 rounded-lg hover:bg-cyber-secondary/10 text-cyber-secondary hover:text-cyber-text transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 搜索框 */}
            <div className="p-4 border-b border-cyber-secondary/10">
              <div className="flex items-center space-x-2">
                <div className="flex-1 flex items-center bg-cyber-bg-darker/40 rounded-lg border border-cyber-secondary/20 px-3">
                  <Search className="w-4 h-4 text-cyber-secondary/50" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="搜索歌曲..."
                    className="flex-1 px-2 py-2 text-sm bg-transparent text-cyber-text placeholder:text-cyber-secondary/50 focus:outline-none"
                  />
                </div>
                <button
                  onClick={handleSearch}
                  disabled={isSearching || !searchQuery.trim()}
                  className="px-4 py-2 bg-cyber-primary text-cyber-bg rounded-lg hover:bg-cyber-hover-primary disabled:opacity-50 transition-colors"
                >
                  {isSearching ? '搜索中...' : '搜索'}
                </button>
              </div>
            </div>

            {/* 搜索结果 */}
            <div className="flex-1 overflow-y-auto">
              {searchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-cyber-secondary/50">
                  <Search className="w-12 h-12 mb-2" />
                  <p className="text-sm">搜索你想添加的歌曲</p>
                </div>
              ) : (
                <div className="divide-y divide-cyber-secondary/10">
                  {searchResults.map((song) => (
                    <button
                      key={song.id}
                      onClick={() => handleAddSong(song)}
                      className="w-full flex items-center p-3 hover:bg-cyber-bg-darker/50 transition-colors text-left"
                    >
                      {/* 封面 */}
                      <div className="w-10 h-10 rounded overflow-hidden bg-cyber-bg-darker/50 flex-shrink-0 mr-3">
                        {song.picUrl ? (
                          <img
                            src={song.picUrl}
                            alt={song.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music className="w-5 h-5 text-cyber-secondary/30" />
                          </div>
                        )}
                      </div>

                      {/* 歌曲信息 */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-cyber-text truncate">
                          {song.name}
                        </p>
                        <p className="text-xs text-cyber-secondary/70 truncate">
                          {song.artists?.join(', ') || '未知艺人'}
                        </p>
                      </div>

                      <Plus className="w-5 h-5 text-cyber-primary flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomPlaylist;
