import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRoom } from '../../contexts/RoomContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { usePlayer } from '../../contexts/PlayerContext';
import RoomChat from './RoomChat';
import RoomMembers from './RoomMembers';
import RoomPlaylist from './RoomPlaylist';
import RoomCreate from './RoomCreate';
import RoomJoin from './RoomJoin';
import MyRoomList from './MyRoomList';
import type { MasterSyncData, MasterModeData, Track } from '../../types';
import {
  Users,
  Music2,
  MessageSquare,
  LogOut,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Wifi,
  WifiOff,
  Loader2,
  Copy,
  Check,
  Headphones,
  MessageCircle,
} from 'lucide-react';

const RoomView: React.FC = () => {
  useAuth();
  const { addToast } = useToast();
  const { enterRoomMode, exitRoomMode, isInRoomMode, playerState, playTrack, seekTo, pauseTrack, resumeTrack, audioRef } = usePlayer();
  const {
    currentRoom,
    members,
    playlist,
    playbackState,
    myMember,
    isConnected,
    isLoading,
    error,
    leaveRoom,
    disbandRoom,
    switchMode,
    play,
    pause,
    nextSong,
    prevSong,
    isOwner,
    reportMasterPlayback,
    requestMasterPlayback,
  } = useRoom();

  const [leftTab, setLeftTab] = useState<'playlist' | 'members'>('playlist');
  const [copied, setCopied] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false); // 是否正在同步中
  const [masterInListenMode, setMasterInListenMode] = useState(false); // 房主是否在听歌模式
  const masterSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSyncRef = useRef<{ songId: string; position: number } | null>(null);
  const lastReportedTrackIdRef = useRef<string | null>(null); // 上次上报的歌曲ID

  // 显示错误
  useEffect(() => {
    if (error) {
      addToast({ type: 'error', message: error, duration: 4000 });
    }
  }, [error, addToast]);

  // 复制房间 ID
  const handleCopyRoomId = async () => {
    if (!currentRoom?.id) return;
    try {
      await navigator.clipboard.writeText(currentRoom.id);
      setCopied(true);
      addToast({ type: 'success', message: '房间号已复制', duration: 2000 });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast({ type: 'error', message: '复制失败', duration: 2000 });
    }
  };

  // 离开房间
  const handleLeaveRoom = async () => {
    setShowLeaveConfirm(false);
    // 如果在房间模式中，先恢复个人播放列表
    if (isInRoomMode) {
      exitRoomMode();
    }
    await leaveRoom();
    addToast({ type: 'info', message: '已离开房间', duration: 2000 });
  };

  // 解散房间（仅房主）
  const handleDisbandRoom = async () => {
    setShowLeaveConfirm(false);
    try {
      // 如果在房间模式中，先恢复个人播放列表
      if (isInRoomMode) {
        exitRoomMode();
      }
      await disbandRoom();
      addToast({ type: 'info', message: '房间已解散', duration: 2000 });
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : '解散房间失败', duration: 3000 });
    }
  };

  // 切换模式
  const handleSwitchMode = async () => {
    const newMode = myMember?.mode === 'listen' ? 'chat' : 'listen';

    // 切换播放列表模式
    if (newMode === 'listen') {
      // 进入听歌模式 - 切换到房间播放列表
      enterRoomMode();
    } else {
      // 退出听歌模式 - 恢复个人播放列表
      exitRoomMode();
    }

    await switchMode(newMode);

    // 如果切换到听歌模式且不是房主，请求房主当前播放状态
    if (newMode === 'listen' && !isOwner) {
      setTimeout(() => {
        requestMasterPlayback();
      }, 500); // 延迟 500ms 确保模式切换完成
    }

    addToast({
      type: 'success',
      message: newMode === 'listen' ? '已切换到听歌模式' : '已切换到聊天模式',
      duration: 2000,
    });
  };

  // 检查是否可以控制播放
  const canControl = myMember?.role === 'owner' || myMember?.role === 'admin' || myMember?.canControl;

  // 构建同步数据的辅助函数
  const buildSyncData = useCallback(() => {
    if (!playerState.currentTrack) return null;
    return {
      songId: String(playerState.currentTrack.id || playerState.currentTrack.neteaseId),
      songName: playerState.currentTrack.title,
      artist: playerState.currentTrack.artist || '',
      cover: playerState.currentTrack.coverArtPath || '',
      duration: Math.round(playerState.duration * 1000), // 转为毫秒
      position: playerState.currentTime,
      isPlaying: playerState.isPlaying,
      hlsUrl: playerState.currentTrack.hlsPlaylistUrl || '',
    };
  }, [playerState.currentTrack, playerState.duration, playerState.currentTime, playerState.isPlaying]);

  // 房主事件驱动上报 + 兜底定时上报
  useEffect(() => {
    // 只有房主在听歌模式时才上报
    if (!isOwner || !isConnected || !currentRoom || myMember?.mode !== 'listen') {
      if (masterSyncIntervalRef.current) {
        clearInterval(masterSyncIntervalRef.current);
        masterSyncIntervalRef.current = null;
      }
      return;
    }

    const audio = audioRef?.current;
    if (!audio) return;

    // 上报函数
    const doReport = () => {
      const syncData = buildSyncData();
      if (syncData) {
        reportMasterPlayback(syncData);
      }
    };

    // 播放事件
    const handlePlay = () => {
      console.log('[房主上报] 播放事件');
      doReport();
    };

    // 暂停事件
    const handlePause = () => {
      console.log('[房主上报] 暂停事件');
      doReport();
    };

    // 拖动完成事件
    const handleSeeked = () => {
      console.log('[房主上报] 拖动事件');
      doReport();
    };

    // 立即上报一次
    doReport();

    // 绑定事件监听
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('seeked', handleSeeked);

    // 兜底：每 5 秒上报一次（降低频率）
    masterSyncIntervalRef.current = setInterval(() => {
      if (!audio.paused) {
        doReport();
      }
    }, 5000);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('seeked', handleSeeked);
      if (masterSyncIntervalRef.current) {
        clearInterval(masterSyncIntervalRef.current);
        masterSyncIntervalRef.current = null;
      }
    };
  }, [isOwner, isConnected, currentRoom, myMember?.mode, audioRef, buildSyncData, reportMasterPlayback]);

  // 监听歌曲变化，房主立即上报
  useEffect(() => {
    if (!isOwner || !isConnected || myMember?.mode !== 'listen' || !playerState.currentTrack) return;

    const currentTrackId = String(playerState.currentTrack.id || playerState.currentTrack.neteaseId);

    // 歌曲变化时立即上报
    if (lastReportedTrackIdRef.current !== currentTrackId) {
      console.log('[房主上报] 切换歌曲:', currentTrackId);
      lastReportedTrackIdRef.current = currentTrackId;

      const syncData = buildSyncData();
      if (syncData) {
        syncData.position = 0; // 新歌从头开始
        reportMasterPlayback(syncData);
      }
    }
  }, [isOwner, isConnected, myMember?.mode, playerState.currentTrack?.id, playerState.currentTrack?.neteaseId, buildSyncData, reportMasterPlayback]);

  // 监听房主模式变更事件
  useEffect(() => {
    const handleMasterModeChange = (event: CustomEvent<MasterModeData>) => {
      const { mode } = event.detail;
      setMasterInListenMode(mode === 'listen');
      console.log('[房间] 房主模式变更:', mode);

      // 房主自己不需要收到这个提示
      if (isOwner) return;

      // 如果房主切换到聊天模式，且当前用户在听歌模式，自动切换到聊天模式
      if (mode === 'chat' && myMember?.mode === 'listen') {
        console.log('[房间] 房主退出听歌模式，自动切换到聊天模式');
        // 恢复个人播放列表
        exitRoomMode();
        // 通知后端切换模式
        switchMode('chat');
        addToast({
          type: 'info',
          message: '房主已退出听歌模式，已自动切换到聊天模式',
          duration: 3000,
        });
      } else if (mode === 'chat') {
        // 用户本身在聊天模式，但也提示房主状态变化
        addToast({
          type: 'info',
          message: '房主已退出听歌模式',
          duration: 2000,
        });
      } else if (mode === 'listen') {
        // 房主进入听歌模式
        addToast({
          type: 'info',
          message: '房主已开启听歌模式，可切换到听歌模式一起听',
          duration: 3000,
        });
      }
    };

    window.addEventListener('room-master-mode-change', handleMasterModeChange as EventListener);
    return () => {
      window.removeEventListener('room-master-mode-change', handleMasterModeChange as EventListener);
    };
  }, [myMember?.mode, isOwner, exitRoomMode, switchMode, addToast]);

  // 监听房间解散事件
  useEffect(() => {
    const handleRoomDisbanded = () => {
      console.log('[房间] 房间被解散');
      // 恢复个人播放列表
      if (isInRoomMode) {
        exitRoomMode();
      }
      addToast({ type: 'warning', message: '房间已被房主解散', duration: 4000 });
    };

    window.addEventListener('room-disbanded', handleRoomDisbanded);
    return () => {
      window.removeEventListener('room-disbanded', handleRoomDisbanded);
    };
  }, [isInRoomMode, exitRoomMode, addToast]);

  // 监听房主请求事件（房主收到后立即上报）
  useEffect(() => {
    if (!isOwner) return;

    const handleMasterRequest = () => {
      console.log('[房主] 收到状态请求，立即上报');
      const syncData = buildSyncData();
      if (syncData) {
        reportMasterPlayback(syncData);
      }
    };

    window.addEventListener('room-master-request', handleMasterRequest);
    return () => {
      window.removeEventListener('room-master-request', handleMasterRequest);
    };
  }, [isOwner, buildSyncData, reportMasterPlayback]);

  // 房主监听歌曲播放结束，自动播放下一首
  useEffect(() => {
    if (!isOwner || myMember?.mode !== 'listen') return;

    const audio = audioRef?.current;
    if (!audio) return;

    const handleEnded = () => {
      console.log('[房主] 歌曲播放结束，自动播放下一首');
      // 查找当前歌曲在歌单中的位置
      const currentTrackId = String(playerState.currentTrack?.id || playerState.currentTrack?.neteaseId || '');
      const currentIndex = playlist.findIndex(item => {
        const itemId = item.songId.replace('netease_', '');
        return itemId === currentTrackId || item.songId === currentTrackId;
      });

      if (currentIndex >= 0 && currentIndex < playlist.length - 1) {
        // 播放下一首
        const nextItem = playlist[currentIndex + 1];
        const nextTrack: Track = {
          id: nextItem.songId.replace('netease_', ''),
          neteaseId: Number(nextItem.songId.replace('netease_', '')) || undefined,
          title: nextItem.name,
          artist: nextItem.artist,
          album: '',
          coverArtPath: nextItem.cover || '',
          hlsPlaylistUrl: `/streams/netease/${nextItem.songId.replace('netease_', '')}/playlist.m3u8`,
          position: 0,
          source: 'netease',
        };
        console.log('[房主] 播放下一首:', nextTrack.title);
        playTrack(nextTrack);
      } else if (playlist.length > 0) {
        // 已经是最后一首，循环播放第一首
        const firstItem = playlist[0];
        const firstTrack: Track = {
          id: firstItem.songId.replace('netease_', ''),
          neteaseId: Number(firstItem.songId.replace('netease_', '')) || undefined,
          title: firstItem.name,
          artist: firstItem.artist,
          album: '',
          coverArtPath: firstItem.cover || '',
          hlsPlaylistUrl: `/streams/netease/${firstItem.songId.replace('netease_', '')}/playlist.m3u8`,
          position: 0,
          source: 'netease',
        };
        console.log('[房主] 循环播放第一首:', firstTrack.title);
        playTrack(firstTrack);
      }
    };

    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('ended', handleEnded);
    };
  }, [isOwner, myMember?.mode, audioRef, playerState.currentTrack, playlist, playTrack]);

  // 处理房主同步消息的回调
  const handleMasterSync = useCallback((event: CustomEvent<MasterSyncData>) => {
    // 只有听歌模式的非房主用户才需要同步
    if (isOwner || myMember?.mode !== 'listen') return;

    const syncData = event.detail;
    setIsSyncing(true);

    const audio = audioRef?.current;

    // 检查是否需要切换歌曲
    const currentSongId = String(playerState.currentTrack?.id || playerState.currentTrack?.neteaseId || '');
    if (syncData.songId !== currentSongId && syncData.songId) {
      // 需要切换歌曲
      console.log('[听歌模式] 切换歌曲:', syncData.songName);
      const trackData: Track = {
        id: syncData.songId,
        neteaseId: Number(syncData.songId) || undefined,
        title: syncData.songName,
        artist: syncData.artist,
        album: '',
        coverArtPath: syncData.cover || '',
        hlsPlaylistUrl: syncData.hlsUrl || `/streams/netease/${syncData.songId}/playlist.m3u8`,
        position: 0,
        source: 'netease',
      };
      playTrack(trackData);
      // 切换歌曲后需要等待加载完成再 seek 和同步播放状态
      setTimeout(() => {
        seekTo(syncData.position);
        if (syncData.isPlaying) {
          resumeTrack();
        }
      }, 500);
    } else {
      // 同一首歌 - 同步播放状态
      if (audio) {
        // 同步播放/暂停状态
        if (syncData.isPlaying && audio.paused) {
          console.log('[听歌模式] 同步播放');
          resumeTrack();
        } else if (!syncData.isPlaying && !audio.paused) {
          console.log('[听歌模式] 同步暂停');
          pauseTrack();
        }

        // 同步进度（差异 > 2 秒才同步，避免频繁 seek）
        const positionDiff = Math.abs(playerState.currentTime - syncData.position);
        if (positionDiff > 2) {
          console.log('[听歌模式] 同步进度:', syncData.position);
          seekTo(syncData.position);
        }
      }
    }

    // 更新最后同步记录
    lastSyncRef.current = {
      songId: syncData.songId,
      position: syncData.position,
    };

    setTimeout(() => setIsSyncing(false), 500);
  }, [isOwner, myMember?.mode, playerState.currentTrack, playerState.currentTime, audioRef, playTrack, seekTo, pauseTrack, resumeTrack]);

  // 监听房主同步事件
  useEffect(() => {
    window.addEventListener('room-master-sync', handleMasterSync as EventListener);
    return () => {
      window.removeEventListener('room-master-sync', handleMasterSync as EventListener);
    };
  }, [handleMasterSync]);

  // 如果不在房间中，显示创建/加入界面
  if (!currentRoom) {
    return (
      <div className="flex flex-col h-full bg-cyber-bg">
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center mb-8">
              <Users className="w-16 h-16 text-cyber-primary mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-cyber-text mb-2">一起听</h1>
              <p className="text-cyber-secondary/70">创建或加入房间，和朋友一起听歌</p>
            </div>

            <div className="space-y-4">
              <RoomCreate />
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-cyber-secondary/20" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-cyber-bg text-cyber-secondary/50">或者</span>
                </div>
              </div>
              <RoomJoin />
              <MyRoomList />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 房间视图 - 左右分栏布局
  return (
    <div className="flex flex-col h-full bg-cyber-bg">
      {/* 顶部信息栏 */}
      <div className="flex-shrink-0 bg-cyber-bg-darker/60 backdrop-blur-md border-b border-cyber-secondary/20 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* 连接状态 */}
            <div className={`p-1.5 rounded-full ${isConnected ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
              {isConnected ? (
                <Wifi className="w-4 h-4 text-green-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-red-500" />
              )}
            </div>

            {/* 房间信息 */}
            <div>
              <h2 className="text-sm font-semibold text-cyber-text">{currentRoom.name}</h2>
              <div className="flex items-center space-x-2 text-xs text-cyber-secondary/70">
                <button
                  onClick={handleCopyRoomId}
                  className="flex items-center space-x-1 hover:text-cyber-primary transition-colors"
                >
                  <span>#{currentRoom.id}</span>
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </button>
                <span>·</span>
                <span>{members.length} 人在线</span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* 同步状态指示 */}
            {myMember?.mode === 'listen' && !isOwner && (
              <div className={`flex items-center space-x-1 px-2 py-1 rounded-lg text-xs ${
                isSyncing
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-green-500/20 text-green-400'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  isSyncing ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'
                }`} />
                <span>{isSyncing ? '同步中' : '已同步'}</span>
              </div>
            )}

            {/* 房主标识 */}
            {isOwner && (
              <div className="flex items-center space-x-1 px-2 py-1 rounded-lg text-xs bg-cyber-primary/20 text-cyber-primary">
                <span>房主</span>
              </div>
            )}

            {/* 模式切换 */}
            <button
              onClick={handleSwitchMode}
              className={`p-2 rounded-lg transition-colors ${
                myMember?.mode === 'listen'
                  ? 'bg-cyber-primary/20 text-cyber-primary'
                  : 'bg-cyber-secondary/10 text-cyber-secondary hover:text-cyber-primary'
              }`}
              title={myMember?.mode === 'listen' ? '听歌模式' : '聊天模式'}
            >
              {myMember?.mode === 'listen' ? (
                <Headphones className="w-5 h-5" />
              ) : (
                <MessageCircle className="w-5 h-5" />
              )}
            </button>

            {/* 离开房间 */}
            <button
              onClick={() => setShowLeaveConfirm(true)}
              className="p-2 rounded-lg text-cyber-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="离开房间"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 播放控制栏 - 仅听歌模式显示 */}
        {myMember?.mode === 'listen' && (
          <div className="mt-3 pt-3 border-t border-cyber-secondary/10">
            <div className="flex items-center justify-between">
              {/* 当前播放歌曲信息 */}
              <div className="flex items-center flex-1 min-w-0 mr-4">
                {playerState.currentTrack?.coverArtPath && (
                  <img
                    src={playerState.currentTrack.coverArtPath}
                    alt=""
                    className="w-10 h-10 rounded-lg object-cover mr-3 flex-shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-cyber-text truncate">
                    {playerState.currentTrack?.title || '未播放'}
                  </p>
                  <p className="text-xs text-cyber-secondary/70 truncate">
                    {playerState.currentTrack?.artist || '-'}
                  </p>
                </div>
              </div>

              {/* 播放控制按钮 - 仅房主可控制 */}
              {isOwner && (
                <div className="flex items-center space-x-2">
                  <button
                    onClick={prevSong}
                    className="p-2 rounded-full hover:bg-cyber-secondary/10 text-cyber-secondary hover:text-cyber-primary transition-colors"
                  >
                    <SkipBack className="w-5 h-5" />
                  </button>
                  <button
                    onClick={playerState.isPlaying ? pauseTrack : resumeTrack}
                    className="p-3 rounded-full bg-cyber-primary text-cyber-bg hover:bg-cyber-hover-primary transition-colors"
                  >
                    {playerState.isPlaying ? (
                      <Pause className="w-5 h-5" />
                    ) : (
                      <Play className="w-5 h-5 ml-0.5" />
                    )}
                  </button>
                  <button
                    onClick={nextSong}
                    className="p-2 rounded-full hover:bg-cyber-secondary/10 text-cyber-secondary hover:text-cyber-primary transition-colors"
                  >
                    <SkipForward className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 主内容区域 - 左右分栏 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧面板 - 歌单/成员 */}
        <div className="w-72 flex-shrink-0 border-r border-cyber-secondary/20 flex flex-col bg-cyber-bg-darker/30">
          {/* 左侧标签切换 */}
          <div className="flex border-b border-cyber-secondary/20">
            <button
              onClick={() => setLeftTab('playlist')}
              className={`flex-1 py-2.5 flex items-center justify-center space-x-1.5 text-sm font-medium transition-colors ${
                leftTab === 'playlist'
                  ? 'text-cyber-primary border-b-2 border-cyber-primary bg-cyber-primary/5'
                  : 'text-cyber-secondary/70 hover:text-cyber-text'
              }`}
            >
              <Music2 className="w-4 h-4" />
              <span>歌单</span>
              <span className="text-xs opacity-60">({playlist.length})</span>
            </button>
            <button
              onClick={() => setLeftTab('members')}
              className={`flex-1 py-2.5 flex items-center justify-center space-x-1.5 text-sm font-medium transition-colors ${
                leftTab === 'members'
                  ? 'text-cyber-primary border-b-2 border-cyber-primary bg-cyber-primary/5'
                  : 'text-cyber-secondary/70 hover:text-cyber-text'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>成员</span>
              <span className="text-xs opacity-60">({members.length})</span>
            </button>
          </div>

          {/* 左侧内容 */}
          <div className="flex-1 overflow-hidden">
            {leftTab === 'playlist' && <RoomPlaylist />}
            {leftTab === 'members' && <RoomMembers />}
          </div>
        </div>

        {/* 右侧面板 - 聊天 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 聊天标题 */}
          <div className="flex-shrink-0 px-4 py-2.5 border-b border-cyber-secondary/20 bg-cyber-bg-darker/20">
            <div className="flex items-center space-x-2">
              <MessageSquare className="w-4 h-4 text-cyber-primary" />
              <span className="text-sm font-medium text-cyber-text">聊天</span>
            </div>
          </div>

          {/* 聊天内容 */}
          <div className="flex-1 overflow-hidden">
            <RoomChat />
          </div>
        </div>
      </div>

      {/* 加载遮罩 */}
      {isLoading && (
        <div className="absolute inset-0 bg-cyber-bg/80 flex items-center justify-center z-50">
          <Loader2 className="w-8 h-8 text-cyber-primary animate-spin" />
        </div>
      )}

      {/* 离开确认弹窗 */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-cyber-bg-darker rounded-xl p-6 max-w-sm w-full border border-cyber-secondary/20">
            <h3 className="text-lg font-semibold text-cyber-text mb-2">
              {isOwner ? '离开或解散房间' : '离开房间'}
            </h3>
            <p className="text-sm text-cyber-secondary/70 mb-6">
              {isOwner
                ? '你是房主。离开房间后，你可以随时回来；解散房间将关闭房间，所有成员都会被移出。'
                : '确定要离开房间吗？你可以随时重新加入。'}
            </p>
            <div className="flex flex-col space-y-2">
              {isOwner ? (
                <>
                  <button
                    onClick={handleLeaveRoom}
                    className="w-full py-2.5 rounded-lg bg-cyber-secondary/10 text-cyber-text hover:bg-cyber-secondary/20 transition-colors"
                  >
                    暂时离开
                  </button>
                  <button
                    onClick={handleDisbandRoom}
                    className="w-full py-2.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                  >
                    解散房间
                  </button>
                  <button
                    onClick={() => setShowLeaveConfirm(false)}
                    className="w-full py-2.5 rounded-lg text-cyber-secondary/70 hover:text-cyber-text transition-colors"
                  >
                    取消
                  </button>
                </>
              ) : (
                <div className="flex space-x-3">
                  <button
                    onClick={() => setShowLeaveConfirm(false)}
                    className="flex-1 py-2 rounded-lg bg-cyber-secondary/10 text-cyber-text hover:bg-cyber-secondary/20 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleLeaveRoom}
                    className="flex-1 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                  >
                    离开
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomView;
