import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePlayer } from '../../contexts/PlayerContext';
import { useRoom } from '../../contexts/RoomContext';
import { Track } from '../../types';
import { AlertTriangle, UploadCloud, Music2, PlayCircle, PauseCircle, ListMusic, Plus, Check, CheckSquare, Square } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import UploadForm from '../upload/UploadForm';
import { authInterceptor } from '../../utils/authInterceptor';
import AddToTargetMenu from '../common/AddToTargetMenu';

// 声明全局jsmediatags类型
declare global {
  interface Window {
    jsmediatags: {
      read: (file: File, callbacks: {
        onSuccess: (tag: any) => void;
        onError: (error: Error) => void;
      }) => void;
    };
  }
}

const MusicLibraryView: React.FC = () => {
  const { currentUser, authToken, logout } = useAuth();
  const {
    playerState,
    playTrack,
    addToPlaylist,
    showPlaylist,
    setShowPlaylist
  } = usePlayer();
  const { addSong, currentRoom } = useRoom();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload form state
  const [showUploadForm, setShowUploadForm] = useState(false);
  const { addToast } = useToast();

  // 批量选择相关状态
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState<Set<number | string>>(new Set());

  // 添加目标菜单状态
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);
  const [trackToAdd, setTrackToAdd] = useState<Track | null>(null);

  // 添加 Toast 容器样式
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .toast-container {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setIsLoading(false);
      setError('Please login to view your music library.');
      setTracks([]);
      return;
    }
    fetchTracks();
  }, [currentUser]);

  const fetchTracks = async () => {
    if (!currentUser) {
      setError('User not authenticated to fetch tracks.');
      setIsLoading(false);
      setTracks([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      console.log('Fetching tracks from /api/tracks with token:', authToken?.substring(0, 20) + "...");
      const response = await fetch('/api/tracks', {
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
          'Content-Type': 'application/json'
        }
      });

      // 检查401响应
      if (response.status === 401) {
        console.log('收到401响应，触发登录重定向');
        authInterceptor.triggerUnauthorized();
        return;
      }

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = { error: response.statusText }; 
        }
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      let fetchedTracks: Track[] = await response.json();
      
      fetchedTracks = fetchedTracks.map(track => {
        const finalCoverArtPath = track.coverArtPath === "" ? undefined : track.coverArtPath;

        return {
          ...track,
          hlsPlaylistUrl: track.hlsPlaylistUrl || (track.id ? `/streams/${track.id}/playlist.m3u8` : undefined),
          coverArtPath: finalCoverArtPath 
        };
      });

      console.log("Processed fetched tracks with cover paths:", fetchedTracks);
      setTracks(fetchedTracks);

    } catch (err: any) {
      console.error("Failed to fetch tracks:", err);
      setError(err.message || 'Failed to load tracks. Please try again later.');
      setTracks([]);
    } finally {
      setIsLoading(false);
    }
  };

  // 添加播放歌曲的处理函数
  const handlePlayTrack = (track: Track) => {
    console.log("=== 播放歌曲信息 ===");
    console.log("原始歌曲信息:", {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      hlsPlaylistUrl: track.hlsPlaylistUrl,
      hlsPlaylistPath: track.hlsPlaylistPath // 检查是否有错误的字段
    });
    console.log("API请求路径:", track.hlsPlaylistUrl);
    
    // 确保使用正确的HLS URL格式，清理任何错误的字段
    const correctTrack = {
      ...track,
      hlsPlaylistUrl: `/streams/${track.id}/playlist.m3u8`,
      hlsPlaylistPath: undefined // 清理可能存在的错误字段
    };
    
    console.log("修正后传递给PlayerContext的track:", {
      id: correctTrack.id,
      title: correctTrack.title,
      hlsPlaylistUrl: correctTrack.hlsPlaylistUrl
    });
    console.log("==================");
    
    playTrack(correctTrack);
  };

  // 切换选择模式
  const toggleSelectMode = useCallback(() => {
    setIsSelectMode(prev => !prev);
    if (isSelectMode) {
      setSelectedTracks(new Set());
    }
  }, [isSelectMode]);

  // 切换单个歌曲选择
  const toggleTrackSelection = useCallback((trackId: number | string) => {
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
    if (selectedTracks.size === tracks.length) {
      setSelectedTracks(new Set());
    } else {
      setSelectedTracks(new Set(tracks.map(t => t.id)));
    }
  }, [selectedTracks.size, tracks]);

  // 打开添加菜单（单个歌曲）
  const handleOpenAddMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>, track: Track) => {
    e.stopPropagation();
    setTrackToAdd(track);
    setAddMenuAnchor(e.currentTarget);
    setShowAddMenu(true);
  }, []);

  // 打开添加菜单（批量）
  const handleOpenBatchAddMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setTrackToAdd(null); // 批量模式不设置单个 track
    setAddMenuAnchor(e.currentTarget);
    setShowAddMenu(true);
  }, []);

  // 添加到个人播放列表
  const handleAddToPersonal = useCallback(async () => {
    if (trackToAdd) {
      // 单个添加
      await addToPlaylist(trackToAdd);
    } else if (selectedTracks.size > 0) {
      // 批量添加
      const tracksToAdd = tracks.filter(t => selectedTracks.has(t.id));
      for (const track of tracksToAdd) {
        await addToPlaylist(track);
      }
      addToast({
        message: `已添加 ${tracksToAdd.length} 首歌曲到播放列表`,
        type: 'success',
        duration: 3000,
      });
      setSelectedTracks(new Set());
      setIsSelectMode(false);
    }
  }, [trackToAdd, selectedTracks, tracks, addToPlaylist, addToast]);

  // 添加到聊天室
  const handleAddToRoom = useCallback(async (roomId: string) => {
    const tracksToAdd = trackToAdd ? [trackToAdd] : tracks.filter(t => selectedTracks.has(t.id));

    for (const track of tracksToAdd) {
      addSong({
        songId: `local_${track.id}`,
        name: track.title,
        artist: track.artist || 'Unknown Artist',
        cover: track.coverArtPath || '',
        duration: track.duration || 0,
        source: 'local',
        hlsUrl: `/streams/${track.id}/playlist.m3u8`,
      });
    }

    addToast({
      message: `已添加 ${tracksToAdd.length} 首歌曲到房间`,
      type: 'success',
      duration: 3000,
    });

    if (!trackToAdd) {
      setSelectedTracks(new Set());
      setIsSelectMode(false);
    }
  }, [trackToAdd, selectedTracks, tracks, addSong, addToast]);

  if (isLoading) {
    return <div className="min-h-[calc(100vh-150px)] flex items-center justify-center p-4 text-cyber-primary text-xl">Loading music library...</div>;
  }

  if (error) {
    return (
      <div className="min-h-[calc(100vh-150px)] flex flex-col items-center justify-center p-4 text-cyber-red">
        <AlertTriangle className="h-12 w-12 mb-4" />
        <p className="text-xl">{error}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 min-h-[calc(100vh-100px)] pb-32 max-w-7xl">
      <header className="my-8 text-center">
        <h1 className="text-5xl font-bold text-cyber-primary animate-pulse">Music Matrix</h1>
        <p className="text-cyber-secondary mt-2">Your digital soundscape awaits.</p>
      </header>

      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-4">
          {currentUser && tracks.length > 0 && (
            <>
              <button
                onClick={toggleSelectMode}
                className={`flex items-center ${isSelectMode ? 'bg-cyber-primary text-cyber-bg-darker' : 'bg-cyber-bg-darker text-cyber-secondary'} hover:bg-cyber-hover-secondary font-semibold py-2 px-4 rounded-lg shadow-md transition-all duration-300 hover:scale-105 focus:outline-none focus:ring-2 ring-offset-2 ring-offset-cyber-bg ring-cyber-primary`}
              >
                {isSelectMode ? <Check className="mr-2 h-5 w-5" /> : <CheckSquare className="mr-2 h-5 w-5" />}
                {isSelectMode ? '取消选择' : '批量操作'}
              </button>
              {isSelectMode && (
                <>
                  <button
                    onClick={toggleSelectAll}
                    className="flex items-center bg-cyber-bg-darker text-cyber-secondary hover:bg-cyber-hover-secondary font-semibold py-2 px-4 rounded-lg shadow-md transition-all duration-300"
                  >
                    {selectedTracks.size === tracks.length ? '取消全选' : '全选'}
                  </button>
                  {selectedTracks.size > 0 && (
                    <button
                      onClick={handleOpenBatchAddMenu}
                      className="flex items-center bg-cyber-secondary text-cyber-bg-darker hover:bg-cyber-hover-secondary font-semibold py-2 px-4 rounded-lg shadow-md transition-all duration-300"
                    >
                      <Plus className="mr-2 h-5 w-5" />
                      添加 {selectedTracks.size} 首
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="flex items-center space-x-4">
          {currentUser && (
            <>
              <button
                onClick={() => setShowPlaylist(!showPlaylist)}
                className={`flex items-center ${showPlaylist ? 'bg-cyber-primary text-cyber-bg-darker' : 'bg-cyber-bg-darker text-cyber-secondary'} hover:bg-cyber-hover-secondary font-semibold py-2 px-4 rounded-lg shadow-md transition-all duration-300 hover:scale-105 focus:outline-none focus:ring-2 ring-offset-2 ring-offset-cyber-bg ring-cyber-primary`}
              >
                <ListMusic className="mr-2 h-5 w-5" /> 播放列表
              </button>
              <button
                onClick={() => setShowUploadForm(!showUploadForm)}
                className="flex items-center bg-cyber-secondary hover:bg-cyber-hover-secondary text-cyber-bg-darker font-semibold py-2 px-4 rounded-lg shadow-md transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 ring-offset-2 ring-offset-cyber-bg ring-cyber-primary"
              >
                <UploadCloud className="mr-2 h-5 w-5" /> {showUploadForm ? '取消上传' : '上传音乐'}
              </button>
            </>
          )}
        </div>
      </div>

      {showUploadForm && currentUser && (
        <div className="fixed inset-0 bg-cyber-bg/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-cyber-bg-darker rounded-xl p-6 max-w-2xl w-full mx-4 shadow-2xl border border-cyber-secondary/30">
            <UploadForm 
              onUploadSuccess={() => {
                setShowUploadForm(false);
                fetchTracks();
              }}
              onCancel={() => setShowUploadForm(false)}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {tracks.length === 0 && !isLoading && (
          <p className="col-span-full text-center text-cyber-muted text-lg py-12">
            Your music library is currently empty. Try uploading some tracks!
          </p>
        )}

        {tracks.map((track) => {
          const isPlayable = !!track.hlsPlaylistUrl;
          const isCurrentlyPlaying = (playerState.currentTrack?.id === track.id ||
                                     // @ts-ignore - 支持trackId字段
                                     playerState.currentTrack?.trackId === track.id) &&
                                     playerState.isPlaying;
          const isTrackSelected = playerState.currentTrack?.id === track.id ||
                            // @ts-ignore - 支持trackId字段
                            playerState.currentTrack?.trackId === track.id;
          const isChecked = selectedTracks.has(track.id);

          return (
            <div
              key={track.id}
              className={`bg-cyber-bg-darker border-2 ${isTrackSelected ? 'border-cyber-primary' : isChecked ? 'border-cyber-secondary' : 'border-cyber-secondary/30'} rounded-lg overflow-hidden shadow-lg transition-all duration-300 hover:shadow-xl hover:scale-[1.02] ${isSelectMode ? 'cursor-pointer' : ''}`}
              onClick={isSelectMode ? () => toggleTrackSelection(track.id) : undefined}
            >
              <div className="aspect-[4/5] bg-cyber-bg relative overflow-hidden">
                {track.coverArtPath ? (
                  <img
                    src={track.coverArtPath}
                    alt={track.title}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }}
                  />
                ) : null}
                <div className={`absolute inset-0 flex items-center justify-center bg-cyber-bg bg-opacity-60 ${track.coverArtPath ? 'hidden' : ''}`}>
                  <Music2 className="w-16 h-16 text-cyber-primary opacity-70" />
                </div>

                {/* 选择模式下的复选框 */}
                {isSelectMode && (
                  <div className="absolute top-2 left-2 z-10">
                    <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${isChecked ? 'bg-cyber-primary border-cyber-primary' : 'bg-cyber-bg/80 border-cyber-secondary'}`}>
                      {isChecked && <Check className="h-4 w-4 text-cyber-bg-darker" />}
                    </div>
                  </div>
                )}

                {/* Play/Pause Overlay */}
                {!isSelectMode && (
                  <div
                    className="absolute inset-0 bg-cyber-bg-darker bg-opacity-40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
                    onClick={() => isPlayable && handlePlayTrack(track)}
                  >
                    {isCurrentlyPlaying ? (
                      <PauseCircle className="h-16 w-16 text-cyber-primary" />
                    ) : (
                      <PlayCircle className="h-16 w-16 text-cyber-primary" />
                    )}
                  </div>
                )}
              </div>

              <div className="p-4">
                <h3 className="text-lg font-semibold text-cyber-primary truncate">{track.title}</h3>
                <p className="text-sm text-cyber-secondary truncate">{track.artist || 'Unknown Artist'}</p>
                <p className="text-xs text-cyber-muted truncate">{track.album || 'Unknown Album'}</p>

                {!isSelectMode && (
                  <div className="mt-4 flex justify-between items-center">
                    <button
                      onClick={() => isPlayable && handlePlayTrack(track)}
                      disabled={!isPlayable}
                      className={`flex items-center px-3 py-1 rounded-full text-sm font-medium transition-colors ${isPlayable ? 'bg-cyber-primary text-cyber-bg-darker hover:bg-cyber-hover-primary' : 'bg-cyber-bg text-cyber-muted cursor-not-allowed'}`}
                    >
                      {isCurrentlyPlaying ? 'Now Playing' : 'Play'}
                    </button>

                    <button
                      onClick={(e) => handleOpenAddMenu(e, track)}
                      disabled={!isPlayable}
                      className={`flex items-center p-1 rounded-full transition-colors ${isPlayable ? 'text-cyber-secondary hover:text-cyber-primary' : 'text-cyber-muted cursor-not-allowed'}`}
                      title="添加到..."
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
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
        track={trackToAdd || undefined}
        tracks={!trackToAdd && selectedTracks.size > 0 ? tracks.filter(t => selectedTracks.has(t.id)) : undefined}
      />
    </div>
  );
};

export default MusicLibraryView;