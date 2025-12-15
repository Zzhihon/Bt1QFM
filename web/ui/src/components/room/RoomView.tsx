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
import type { MasterSyncData, MasterModeData, Track, SongChangeData } from '../../types';
import {
  Users,
  Music2,
  MessageSquare,
  LogOut,
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
  const { enterRoomMode, exitRoomMode, isInRoomMode, playerState, playTrack, seekTo, pauseTrack, resumeTrack, audioRef, setRoomPlaylistForAutoPlay } = usePlayer();
  const {
    currentRoom,
    members,
    playlist,
    myMember,
    isConnected,
    isLoading,
    error,
    leaveRoom,
    disbandRoom,
    switchMode,
    isOwner,
    reportMasterPlayback,
    requestMasterPlayback,
  } = useRoom();

  const [leftTab, setLeftTab] = useState<'playlist' | 'members'>('playlist');
  const [mobileTab, setMobileTab] = useState<'chat' | 'playlist' | 'members'>('chat'); // 移动端当前标签
  const [copied, setCopied] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false); // 是否正在同步中
  const masterSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSyncRef = useRef<{ songId: string; position: number } | null>(null);
  const lastReportedTrackIdRef = useRef<string | null>(null); // 上次上报的歌曲ID
  const songChangeSilenceRef = useRef(false); // 切歌静默期标记，避免 song_change 后被 master_sync 覆盖
  const songChangeSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 静默期定时器
  const masterReportPausedRef = useRef(false); // 房主上报暂停标记，避免切歌期间上报旧状态
  const masterReportPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 上报暂停定时器

  // 显示错误（排除重连过程中的状态信息）
  useEffect(() => {
    if (error) {
      // 重连过程中的状态信息不弹 toast，只在顶部显示状态即可
      const isReconnectingStatus = error.includes('秒后重连') || error.includes('等待恢复');
      if (!isReconnectingStatus) {
        addToast({ type: 'error', message: error, duration: 4000 });
      }
    }
  }, [error, addToast]);

  // 进入房间后自动处理模式切换
  const hasAutoSwitchedRef = useRef(false);
  useEffect(() => {
    // 确保只执行一次，且房间和成员信息已加载
    if (!currentRoom || !myMember || !isConnected || hasAutoSwitchedRef.current) return;

    // 标记已处理，避免重复执行
    hasAutoSwitchedRef.current = true;

    // 如果已经是 listen 模式，不需要处理
    if (myMember.mode === 'listen') return;

    if (isOwner) {
      // 房主自动切换到听歌模式
      enterRoomMode();
      // 立即设置房间歌单信息，确保 isRoomListenModeRef 被正确设置
      const canControl = myMember?.canControl || false;
      setRoomPlaylistForAutoPlay(playlist, isOwner, true, canControl);
      switchMode('listen');
      addToast({
        type: 'info',
        message: '已自动切换到一起听模式',
        duration: 3000,
      });
    } else {
      // 其他用户提示切换
      addToast({
        type: 'info',
        message: '点击右上角切换到「一起听」模式，与房主同步播放',
        duration: 5000,
      });
    }
  }, [currentRoom, myMember, isConnected, isOwner, enterRoomMode, switchMode, addToast, playlist, setRoomPlaylistForAutoPlay]);

  // 离开房间时重置自动切换标记
  useEffect(() => {
    if (!currentRoom) {
      hasAutoSwitchedRef.current = false;
    }
  }, [currentRoom]);

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
    const canControl = myMember?.canControl || false;

    // 切换播放列表模式
    if (newMode === 'listen') {
      // 进入听歌模式 - 切换到房间播放列表
      enterRoomMode();
      // 立即设置房间歌单信息，不等待 myMember.mode 更新
      // 这样可以确保在 enterRoomMode 后立即点击下一首能正确工作
      setRoomPlaylistForAutoPlay(playlist, isOwner, true, canControl);
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

  // 同步房间歌单到 PlayerContext（用于房主在其他页面时自动播放下一首）
  useEffect(() => {
    const isListenMode = myMember?.mode === 'listen';
    const canControl = myMember?.canControl || false;
    setRoomPlaylistForAutoPlay(playlist, isOwner, isListenMode, canControl);
  }, [playlist, isOwner, myMember?.mode, myMember?.canControl, setRoomPlaylistForAutoPlay]);

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
      // 如果上报被暂停（正在切歌），跳过本次上报
      if (masterReportPausedRef.current) {
        console.log('[房主上报] 切歌期间暂停上报，跳过');
        return;
      }
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

  // 注意：房间模式下的上一首/下一首逻辑已移至 PlayerContext 中直接处理
  // PlayerContext 会通过 player-song-change 事件通知 RoomContext 发送 WebSocket 消息

  // 处理房主同步消息的回调
  const handleMasterSync = useCallback((event: CustomEvent<MasterSyncData>) => {
    // 只有听歌模式的非房主用户才需要同步
    // 有控制权限的用户在收到 song_change 后会有静默期，这里需要排除
    if (isOwner || myMember?.mode !== 'listen') return;

    // 如果在静默期内（刚收到 song_change），忽略 master_sync 避免被覆盖
    if (songChangeSilenceRef.current) {
      console.log('[听歌模式] 静默期内，忽略 master_sync');
      return;
    }

    const syncData = event.detail;
    const audio = audioRef?.current;

    // 标记是否需要执行同步操作
    let needsSync = false;

    // 检查是否需要切换歌曲
    const currentSongId = String(playerState.currentTrack?.id || playerState.currentTrack?.neteaseId || '');
    if (syncData.songId !== currentSongId && syncData.songId) {
      // 需要切换歌曲 - 这是重要的同步操作
      needsSync = true;
      setIsSyncing(true);
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
        setIsSyncing(false);
      }, 1000);
    } else {
      // 同一首歌 - 同步播放状态
      if (audio) {
        // 同步播放/暂停状态
        if (syncData.isPlaying && audio.paused) {
          console.log('[听歌模式] 同步播放');
          resumeTrack();
          // 播放/暂停状态切换不需要显示同步指示器
        } else if (!syncData.isPlaying && !audio.paused) {
          console.log('[听歌模式] 同步暂停');
          pauseTrack();
        }

        // 同步进度（差异 > 3 秒才同步，提高阈值减少频繁 seek）
        const positionDiff = Math.abs(playerState.currentTime - syncData.position);
        if (positionDiff > 3) {
          needsSync = true;
          setIsSyncing(true);
          console.log('[听歌模式] 同步进度:', syncData.position);
          seekTo(syncData.position);
          setTimeout(() => setIsSyncing(false), 500);
        }
      }
    }

    // 更新最后同步记录
    lastSyncRef.current = {
      songId: syncData.songId,
      position: syncData.position,
    };
  }, [isOwner, myMember?.mode, playerState.currentTrack, playerState.currentTime, audioRef, playTrack, seekTo, pauseTrack, resumeTrack]);

  // 处理切歌同步消息的回调（来自任何有权限用户的切歌）
  const handleSongChange = useCallback((event: CustomEvent<SongChangeData>) => {
    // 听歌模式的用户需要处理切歌同步
    // 房主也需要处理：当授权用户切歌时，房主需要同步切换，这样房主的 master_report 才会上报新歌曲
    const shouldHandle = myMember?.mode === 'listen' || isOwner;
    if (!shouldHandle) return;

    const songData = event.detail;
    const currentSongId = String(playerState.currentTrack?.id || playerState.currentTrack?.neteaseId || '');

    // 检查是否是自己发起的切歌（避免重复处理）
    // 注意：切歌者的本地已经开始播放了，不需要再同步
    if (songData.songId === currentSongId) {
      console.log('[切歌同步] 同一首歌，跳过');
      return;
    }

    console.log('[切歌同步] 收到切歌消息:', songData.songName, '来自:', songData.changedByName, '我是房主:', isOwner);

    // 设置静默期：在此期间忽略 master_sync，避免被房主旧状态覆盖
    // 清除之前的定时器
    if (songChangeSilenceTimerRef.current) {
      clearTimeout(songChangeSilenceTimerRef.current);
    }
    songChangeSilenceRef.current = true;
    // 静默期 5 秒后解除
    songChangeSilenceTimerRef.current = setTimeout(() => {
      songChangeSilenceRef.current = false;
      console.log('[切歌同步] 静默期结束');
    }, 5000);

    // 如果是房主，立即暂停上报，避免在切歌过程中上报旧状态
    // 这必须在 playTrack 之前设置，因为 playTrack 可能会触发上报事件
    if (isOwner) {
      lastReportedTrackIdRef.current = songData.songId;
      masterReportPausedRef.current = true;
      console.log('[房主] 收到切歌，暂停上报');

      // 清除之前的暂停定时器
      if (masterReportPauseTimerRef.current) {
        clearTimeout(masterReportPauseTimerRef.current);
      }
      // 3秒后恢复上报（足够新歌曲加载完成）
      masterReportPauseTimerRef.current = setTimeout(() => {
        masterReportPausedRef.current = false;
        console.log('[房主] 切歌完成，恢复上报');
        // 恢复后立即上报一次新状态
        const newSyncData = buildSyncData();
        if (newSyncData && newSyncData.songId === songData.songId) {
          reportMasterPlayback(newSyncData);
        }
      }, 3000);
    }

    setIsSyncing(true);

    // 切换到新歌曲
    const trackData: Track = {
      id: songData.songId,
      neteaseId: Number(songData.songId) || undefined,
      title: songData.songName,
      artist: songData.artist,
      album: '',
      coverArtPath: songData.cover || '',
      hlsPlaylistUrl: songData.hlsUrl || `/streams/netease/${songData.songId}/playlist.m3u8`,
      position: 0,
      source: 'netease',
    };
    playTrack(trackData);

    // 等待加载完成后设置播放位置和状态
    setTimeout(() => {
      seekTo(songData.position);
      if (songData.isPlaying) {
        resumeTrack();
      } else {
        pauseTrack();
      }
      setIsSyncing(false);
    }, 500);

    // 更新最后同步记录
    lastSyncRef.current = {
      songId: songData.songId,
      position: songData.position,
    };
  }, [myMember?.mode, playerState.currentTrack, playTrack, seekTo, resumeTrack, pauseTrack, isOwner, buildSyncData, reportMasterPlayback]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (songChangeSilenceTimerRef.current) {
        clearTimeout(songChangeSilenceTimerRef.current);
      }
      if (masterReportPauseTimerRef.current) {
        clearTimeout(masterReportPauseTimerRef.current);
      }
    };
  }, []);

  // 监听房主同步事件
  useEffect(() => {
    window.addEventListener('room-master-sync', handleMasterSync as EventListener);
    return () => {
      window.removeEventListener('room-master-sync', handleMasterSync as EventListener);
    };
  }, [handleMasterSync]);

  // 监听切歌同步事件（来自任何有权限用户的切歌）
  useEffect(() => {
    window.addEventListener('room-song-change', handleSongChange as EventListener);
    return () => {
      window.removeEventListener('room-song-change', handleSongChange as EventListener);
    };
  }, [handleSongChange]);

  // 监听本地切歌事件（授权用户自己切歌时立即进入静默期）
  // 这是关键：在发送 song_change 消息的同时立即进入静默期，避免被房主的旧状态覆盖
  useEffect(() => {
    // 只有有权限的用户（非房主但有 canControl 权限）才需要监听
    const canControl = myMember?.canControl || false;
    if (isOwner || !canControl || myMember?.mode !== 'listen') return;

    const handleLocalSongChange = () => {
      console.log('[授权用户] 本地切歌，立即进入静默期');
      // 立即进入静默期
      if (songChangeSilenceTimerRef.current) {
        clearTimeout(songChangeSilenceTimerRef.current);
      }
      songChangeSilenceRef.current = true;
      // 静默期 5 秒后解除
      songChangeSilenceTimerRef.current = setTimeout(() => {
        songChangeSilenceRef.current = false;
        console.log('[授权用户] 静默期结束');
      }, 5000);
    };

    window.addEventListener('player-song-change', handleLocalSongChange);
    return () => {
      window.removeEventListener('player-song-change', handleLocalSongChange);
    };
  }, [isOwner, myMember?.canControl, myMember?.mode]);

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

  // 房间视图 - 响应式布局（移动端标签切换，桌面端左右分栏）
  return (
    <div className="h-[calc(100vh-64px-114px)] md:h-[calc(100vh-64px-84px)] flex flex-col bg-cyber-bg overflow-hidden">
      {/* 移动端顶部信息栏 */}
      <div className="md:hidden flex-shrink-0 p-3 border-b border-cyber-secondary/20 bg-cyber-bg-darker/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 flex-1 min-w-0">
            {/* 连接状态 */}
            <div className={`p-1 rounded-full flex-shrink-0 ${isConnected ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
              {isConnected ? (
                <Wifi className="w-3 h-3 text-green-500" />
              ) : (
                <WifiOff className="w-3 h-3 text-red-500" />
              )}
            </div>
            {/* 房间名称 */}
            <h2 className="text-sm font-semibold text-cyber-text truncate">{currentRoom.name}</h2>
            {/* 房主标识 */}
            {isOwner && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyber-primary/20 text-cyber-primary flex-shrink-0">房主</span>
            )}
          </div>

          <div className="flex items-center space-x-2 flex-shrink-0">
            {/* 同步状态指示 - 只在同步时显示，平时不显示避免闪烁 */}
            {myMember?.mode === 'listen' && !isOwner && isSyncing && (
              <div className="flex items-center space-x-1 px-2 py-1 rounded-lg text-xs bg-yellow-500/20 text-yellow-400">
                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                <span className="hidden sm:inline">同步中</span>
              </div>
            )}

            {/* 模式切换 */}
            <button
              onClick={handleSwitchMode}
              className={`flex items-center space-x-1 px-2 py-1 rounded-lg transition-colors ${
                myMember?.mode === 'listen'
                  ? 'bg-cyber-primary/20 text-cyber-primary'
                  : 'bg-cyber-secondary/10 text-cyber-secondary hover:text-cyber-primary'
              }`}
              title={myMember?.mode === 'listen' ? '听歌模式' : '聊天模式'}
            >
              {myMember?.mode === 'listen' ? (
                <>
                  <Headphones className="w-4 h-4" />
                  <span className="text-xs">一起听</span>
                </>
              ) : (
                <>
                  <MessageCircle className="w-4 h-4" />
                  <span className="text-xs">聊天</span>
                </>
              )}
            </button>

            {/* 离开房间 */}
            <button
              onClick={() => setShowLeaveConfirm(true)}
              className="p-1.5 rounded-lg text-cyber-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="离开房间"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 房间号和在线人数 */}
        <div className="flex items-center justify-between text-xs text-cyber-secondary/70 mt-2">
          <button
            onClick={handleCopyRoomId}
            className="flex items-center space-x-1 hover:text-cyber-primary transition-colors"
          >
            <span>#{currentRoom.id}</span>
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
          <span>{members.length} 人在线</span>
        </div>
      </div>

      {/* 移动端标签切换 */}
      <div className="md:hidden flex-shrink-0 flex border-b border-cyber-secondary/20 bg-cyber-bg-darker/50">
        <button
          onClick={() => setMobileTab('chat')}
          className={`flex-1 py-2.5 flex items-center justify-center space-x-1.5 text-sm font-medium transition-colors ${
            mobileTab === 'chat'
              ? 'text-cyber-primary border-b-2 border-cyber-primary bg-cyber-primary/5'
              : 'text-cyber-secondary/70'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>聊天</span>
        </button>
        <button
          onClick={() => setMobileTab('playlist')}
          className={`flex-1 py-2.5 flex items-center justify-center space-x-1.5 text-sm font-medium transition-colors ${
            mobileTab === 'playlist'
              ? 'text-cyber-primary border-b-2 border-cyber-primary bg-cyber-primary/5'
              : 'text-cyber-secondary/70'
          }`}
        >
          <Music2 className="w-4 h-4" />
          <span>歌单</span>
          <span className="text-xs opacity-60">({playlist.length})</span>
        </button>
        <button
          onClick={() => setMobileTab('members')}
          className={`flex-1 py-2.5 flex items-center justify-center space-x-1.5 text-sm font-medium transition-colors ${
            mobileTab === 'members'
              ? 'text-cyber-primary border-b-2 border-cyber-primary bg-cyber-primary/5'
              : 'text-cyber-secondary/70'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>成员</span>
          <span className="text-xs opacity-60">({members.length})</span>
        </button>
      </div>

      {/* 移动端内容区域 */}
      <div className="md:hidden flex-1 overflow-hidden">
        {mobileTab === 'chat' && <RoomChat />}
        {mobileTab === 'playlist' && <RoomPlaylist />}
        {mobileTab === 'members' && <RoomMembers />}
      </div>

      {/* 桌面端：主内容区域 - 左右分栏 */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        {/* 左侧面板 - 房间信息 + 歌单/成员 */}
        <div className="w-72 flex-shrink-0 border-r border-cyber-secondary/20 flex flex-col bg-cyber-bg-darker/30">
          {/* 房间信息 - 固定在顶部 */}
          <div className="flex-shrink-0 p-3 border-b border-cyber-secondary/20 bg-cyber-bg-darker/50">
            <div className="flex items-center space-x-2 mb-2">
              {/* 连接状态 */}
              <div className={`p-1 rounded-full ${isConnected ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                {isConnected ? (
                  <Wifi className="w-3 h-3 text-green-500" />
                ) : (
                  <WifiOff className="w-3 h-3 text-red-500" />
                )}
              </div>
              {/* 房间名称 */}
              <h2 className="text-sm font-semibold text-cyber-text truncate flex-1">{currentRoom.name}</h2>
              {/* 房主标识 */}
              {isOwner && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyber-primary/20 text-cyber-primary">房主</span>
              )}
            </div>
            <div className="flex items-center justify-between text-xs text-cyber-secondary/70">
              <button
                onClick={handleCopyRoomId}
                className="flex items-center space-x-1 hover:text-cyber-primary transition-colors"
              >
                <span>#{currentRoom.id}</span>
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </button>
              <span>{members.length} 人在线</span>
            </div>
          </div>

          {/* 左侧标签切换 */}
          <div className="flex-shrink-0 flex border-b border-cyber-secondary/20 bg-cyber-bg-darker/50">
            <button
              onClick={() => setLeftTab('playlist')}
              className={`flex-1 py-2 flex items-center justify-center space-x-1.5 text-sm font-medium transition-colors ${
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
              className={`flex-1 py-2 flex items-center justify-center space-x-1.5 text-sm font-medium transition-colors ${
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

          {/* 左侧内容 - 可滚动 */}
          <div className="flex-1 overflow-y-auto">
            {leftTab === 'playlist' && <RoomPlaylist />}
            {leftTab === 'members' && <RoomMembers />}
          </div>
        </div>

        {/* 右侧面板 - 聊天 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 聊天标题栏 - 固定在顶部，包含操作按钮 */}
          <div className="flex-shrink-0 px-4 py-2 border-b border-cyber-secondary/20 bg-cyber-bg-darker/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <MessageSquare className="w-4 h-4 text-cyber-primary" />
                <span className="text-sm font-medium text-cyber-text">聊天</span>
              </div>

              <div className="flex items-center space-x-2">
                {/* 同步状态指示 - 只在同步时显示，平时不显示避免闪烁 */}
                {myMember?.mode === 'listen' && !isOwner && isSyncing && (
                  <div className="flex items-center space-x-1 px-2 py-1 rounded-lg text-xs bg-yellow-500/20 text-yellow-400">
                    <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                    <span>同步中</span>
                  </div>
                )}

                {/* 模式切换 */}
                <button
                  onClick={handleSwitchMode}
                  className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg transition-colors ${
                    myMember?.mode === 'listen'
                      ? 'bg-cyber-primary/20 text-cyber-primary'
                      : 'bg-cyber-secondary/10 text-cyber-secondary hover:text-cyber-primary'
                  }`}
                  title={myMember?.mode === 'listen' ? '切换到聊天模式' : '切换到一起听模式'}
                >
                  {myMember?.mode === 'listen' ? (
                    <>
                      <Headphones className="w-4 h-4" />
                      <span className="text-xs font-medium">一起听</span>
                    </>
                  ) : (
                    <>
                      <MessageCircle className="w-4 h-4" />
                      <span className="text-xs font-medium">聊天模式</span>
                    </>
                  )}
                </button>

                {/* 离开房间 */}
                <button
                  onClick={() => setShowLeaveConfirm(true)}
                  className="p-1.5 rounded-lg text-cyber-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="离开房间"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* 聊天内容 - 可滚动 */}
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
