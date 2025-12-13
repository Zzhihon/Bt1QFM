import React, { useState } from 'react';
import { useRoom } from '../../contexts/RoomContext';
import { useToast } from '../../contexts/ToastContext';
import {
  Music,
  Trash2,
  Plus,
  Search,
  X,
  Disc3,
  Clock,
} from 'lucide-react';
import { RoomPlaylistItem } from '../../types';

const RoomPlaylist: React.FC = () => {
  const { addToast } = useToast();
  const { playlist, playbackState, myMember, addSong, removeSong } = useRoom();
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // 检查是否可以控制
  const canControl = myMember?.role === 'owner' || myMember?.role === 'admin' || myMember?.canControl;

  // 格式化时长
  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 搜索歌曲（调用网易云 API）
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const response = await fetch(`/api/netease/search?keywords=${encodeURIComponent(searchQuery)}&limit=20`);
      if (response.ok) {
        const data = await response.json();
        // API 返回格式: { success: true, data: [...] }
        setSearchResults(data.data || []);
      } else {
        addToast({ type: 'error', message: '搜索失败', duration: 3000 });
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
      // API 返回的 picUrl 直接在 song 对象上
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
              const isPlaying = playbackState?.currentIndex === index;

              return (
                <div
                  key={`${item.songId}-${index}`}
                  className={`flex items-center p-3 hover:bg-cyber-bg-darker/30 transition-colors ${
                    isPlaying ? 'bg-cyber-primary/10' : ''
                  }`}
                >
                  {/* 序号/播放指示 */}
                  <div className="w-8 flex-shrink-0 text-center">
                    {isPlaying ? (
                      <div className="flex items-center justify-center">
                        <div className="w-2 h-2 bg-cyber-primary rounded-full animate-pulse" />
                      </div>
                    ) : (
                      <span className="text-xs text-cyber-secondary/50">{index + 1}</span>
                    )}
                  </div>

                  {/* 封面 */}
                  <div className="w-10 h-10 rounded overflow-hidden bg-cyber-bg-darker/50 flex-shrink-0 mr-3">
                    {item.cover ? (
                      <img
                        src={item.cover}
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
                        isPlaying ? 'text-cyber-primary' : 'text-cyber-text'
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
                      onClick={() => handleRemoveSong(item)}
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
