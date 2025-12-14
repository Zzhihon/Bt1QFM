import React, { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import {
  Room,
  RoomMember,
  RoomMemberOnline,
  RoomInfo,
  RoomPlaybackState,
  RoomPlaylistItem,
  RoomWSMessage,
  RoomWSMessageType,
  MasterSyncData,
  SongChangeData,
} from '../types';

interface RoomContextType {
  // 状态
  currentRoom: RoomInfo | null;
  members: RoomMemberOnline[];
  playlist: RoomPlaylistItem[];
  playbackState: RoomPlaybackState | null;
  myMember: RoomMember | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  reconnectAttempt: number; // 新增：重连尝试次数
  isOwner: boolean; // 是否是房主

  // 房间操作
  createRoom: (name: string) => Promise<Room | null>;
  joinRoom: (roomId: string) => Promise<boolean>;
  leaveRoom: () => Promise<void>;
  disbandRoom: () => Promise<void>; // 解散房间（仅房主）

  // 模式切换
  switchMode: (mode: 'chat' | 'listen') => Promise<void>;

  // 播放控制
  play: () => void;
  pause: () => void;
  seek: (position: number) => void;
  nextSong: () => void;
  prevSong: () => void;

  // 歌单操作
  addSong: (song: Omit<RoomPlaylistItem, 'position' | 'addedBy' | 'addedAt'>) => void;
  removeSong: (position: number) => void;

  // 聊天
  sendMessage: (content: string) => void;

  // 权限管理
  transferOwner: (targetUserId: number) => void;
  grantControl: (targetUserId: number, canControl: boolean) => void;

  // 房主同步上报
  reportMasterPlayback: (data: Omit<MasterSyncData, 'serverTime' | 'masterId' | 'masterName'>) => void;
  // 请求房主播放状态
  requestMasterPlayback: () => void;
  // 切歌同步（有权限用户切歌后发送）
  sendSongChange: (data: Omit<SongChangeData, 'changedBy' | 'changedByName' | 'timestamp'>) => void;
}

const RoomContext = createContext<RoomContextType | undefined>(undefined);

export const RoomProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { currentUser, authToken } = useAuth();

  // 状态
  const [currentRoom, setCurrentRoom] = useState<RoomInfo | null>(null);
  const [members, setMembers] = useState<RoomMemberOnline[]>([]);
  const [playlist, setPlaylist] = useState<RoomPlaylistItem[]>([]);
  const [playbackState, setPlaybackState] = useState<RoomPlaybackState | null>(null);
  const [myMember, setMyMember] = useState<RoomMember | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  // WebSocket 引用
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  const currentRoomIdRef = useRef<string | null>(null);

  // 清理函数
  const cleanup = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    reconnectAttemptsRef.current = 0;
    setReconnectAttempt(0);
    currentRoomIdRef.current = null;
  }, []);

  // 发送 WebSocket 消息
  const sendWSMessage = useCallback((type: RoomWSMessageType, data?: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const message: RoomWSMessage = {
        type,
        roomId: currentRoom?.id,
        userId: currentUser?.id as number,
        username: currentUser?.username,
        data: data ? JSON.stringify(data) : undefined,
        timestamp: Date.now(),
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, [currentRoom?.id, currentUser]);

  // 处理 WebSocket 消息
  const handleWSMessage = useCallback((event: MessageEvent) => {
    try {
      const message: RoomWSMessage = JSON.parse(event.data);

      switch (message.type) {
        case 'join':
          // 有人加入房间
          if (message.userId && message.username) {
            setMembers(prev => {
              const exists = prev.some(m => m.userId === message.userId);
              if (exists) return prev;
              return [...prev, {
                userId: message.userId!,
                username: message.username!,
                role: 'member',
                mode: 'chat',
                canControl: false,
                joinedAt: message.timestamp,
              }];
            });
          }
          break;

        case 'leave':
          // 有人离开房间
          if (message.userId) {
            setMembers(prev => prev.filter(m => m.userId !== message.userId));
          }
          break;

        case 'member_list':
          // 成员列表更新
          if (message.data) {
            const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            setMembers(data as RoomMemberOnline[]);
          }
          break;

        case 'chat':
          // 聊天消息 - 通过自定义事件分发给 RoomChat 组件
          if (message.userId && message.username && message.data) {
            const chatData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            const chatMessage = {
              id: message.timestamp,
              userId: message.userId,
              username: message.username,
              content: chatData.content,
              timestamp: message.timestamp,
              type: 'chat' as const,
            };
            window.dispatchEvent(new CustomEvent('room-chat-message', { detail: chatMessage }));
          }
          break;

        case 'sync':
        case 'playback':
          // 播放状态同步
          if (message.data) {
            const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            setPlaybackState(data as RoomPlaybackState);
          }
          break;

        case 'playlist':
          // 歌单更新
          if (message.data) {
            const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            setPlaylist(data as RoomPlaylistItem[]);
          }
          break;

        case 'song_add':
          // 添加歌曲
          if (message.data) {
            const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            setPlaylist(prev => [...prev, data as RoomPlaylistItem]);
          }
          break;

        case 'song_del':
          // 删除歌曲
          if (message.data) {
            const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            const position = (data as { position: number }).position;
            setPlaylist(prev => prev.filter(item => item.position !== position));
          }
          break;

        case 'song_search':
          // 歌曲搜索结果 - 通过自定义事件分发给 RoomChat 组件
          if (message.userId && message.username && message.data) {
            const searchData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            const chatMessage = {
              id: message.timestamp || Date.now(),
              userId: message.userId,
              username: message.username,
              content: `搜索「${searchData.query}」的结果：`,
              timestamp: message.timestamp || Date.now(),
              type: 'song_search' as const,
              songs: searchData.songs?.map((song: { id: number; name: string; artists: string[]; album: string; duration: number; coverUrl: string; hlsUrl: string; source: string }) => ({
                id: song.id,
                name: song.name,
                artists: song.artists,
                album: song.album,
                duration: song.duration,
                coverUrl: song.coverUrl,
                hlsUrl: song.hlsUrl,
                source: song.source,
              })),
            };
            window.dispatchEvent(new CustomEvent('room-chat-message', { detail: chatMessage }));
          }
          break;

        case 'role_update':
          // 角色更新
          if (message.data) {
            const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            const { userId, role } = data as { userId: number; role: string };
            setMembers(prev => prev.map(m =>
              m.userId === userId ? { ...m, role: role as 'owner' | 'admin' | 'member' } : m
            ));
          }
          break;

        case 'grant_control':
          // 控制权限更新
          if (message.data) {
            const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            const { userId, canControl } = data as { userId: number; canControl: boolean };
            setMembers(prev => prev.map(m =>
              m.userId === userId ? { ...m, canControl } : m
            ));
          }
          break;

        case 'pong':
          // 心跳响应
          break;

        case 'error':
          // 错误消息
          if (message.data) {
            const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            setError((data as { message: string }).message || '发生错误');
          }
          break;

        case 'master_sync':
          // 房主播放同步 - 通过自定义事件分发给播放器同步
          if (message.data) {
            const syncData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            window.dispatchEvent(new CustomEvent('room-master-sync', { detail: syncData }));
          }
          break;

        case 'master_request':
          // 收到请求房主播放状态的消息 - 通过自定义事件通知房主立即上报
          window.dispatchEvent(new CustomEvent('room-master-request'));
          break;

        case 'master_mode':
          // 房主模式变更通知 - 通过自定义事件通知
          if (message.data) {
            const modeData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            window.dispatchEvent(new CustomEvent('room-master-mode-change', { detail: modeData }));
          }
          break;

        case 'song_change':
          // 有权限用户切歌后的同步消息 - 通过自定义事件通知所有 listen 用户
          if (message.data) {
            const songChangeData = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
            console.log('[RoomContext] 收到切歌同步消息:', songChangeData);
            window.dispatchEvent(new CustomEvent('room-song-change', { detail: songChangeData }));
          }
          break;

        case 'room_disband':
          // 房间被解散 - 通知所有用户
          window.dispatchEvent(new CustomEvent('room-disbanded'));
          break;
      }
    } catch (err) {
      console.error('解析 WebSocket 消息失败:', err);
    }
  }, []);

  // 计算重连延迟（指数退避）
  const getReconnectDelay = useCallback((attempt: number): number => {
    // 指数退避: 1s, 2s, 4s, 8s, 16s, 最大30s
    const baseDelay = 1000;
    const maxDelay = 30000;
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    // 添加随机抖动 (±20%)
    const jitter = delay * 0.2 * (Math.random() - 0.5);
    return Math.floor(delay + jitter);
  }, []);

  // 尝试重连
  const attemptReconnect = useCallback((roomId: string) => {
    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      console.log('已达到最大重连次数，停止重连');
      setError('连接失败，请刷新页面重试');
      return;
    }

    // 检查网络状态
    if (!navigator.onLine) {
      console.log('网络离线，等待网络恢复...');
      setError('网络已断开，等待恢复...');
      return;
    }

    reconnectAttemptsRef.current += 1;
    setReconnectAttempt(reconnectAttemptsRef.current);

    const delay = getReconnectDelay(reconnectAttemptsRef.current - 1);
    console.log(`第 ${reconnectAttemptsRef.current} 次重连，${delay}ms 后尝试...`);
    setError(`连接断开，${Math.ceil(delay / 1000)}秒后重连 (${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);

    reconnectTimeoutRef.current = setTimeout(() => {
      if (currentRoomIdRef.current === roomId) {
        connectWebSocket(roomId);
      }
    }, delay);
  }, [getReconnectDelay]);

  // 连接 WebSocket
  const connectWebSocket = useCallback((roomId: string) => {
    if (!currentUser || !authToken) return;

    // 清理旧连接但保留重连计数
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    currentRoomIdRef.current = roomId;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/room/${roomId}?userId=${currentUser.id}&username=${encodeURIComponent(currentUser.username)}&token=${authToken}`;

    console.log('正在连接 WebSocket...', reconnectAttemptsRef.current > 0 ? `(重连 #${reconnectAttemptsRef.current})` : '');

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket 连接成功');
      setIsConnected(true);
      setError(null);
      // 重连成功后重置计数器
      reconnectAttemptsRef.current = 0;
      setReconnectAttempt(0);

      // 启动心跳
      pingIntervalRef.current = setInterval(() => {
        sendWSMessage('ping');
      }, 30000);
    };

    ws.onmessage = handleWSMessage;

    ws.onclose = (event) => {
      console.log('WebSocket 连接关闭:', event.code, event.reason);
      setIsConnected(false);

      // 清理心跳
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      // 非正常关闭且仍在当前房间时尝试重连
      // 1000 = 正常关闭, 1001 = 页面离开
      if (event.code !== 1000 && event.code !== 1001 && currentRoomIdRef.current === roomId) {
        attemptReconnect(roomId);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket 错误:', err);
      // 错误后会触发 onclose，在 onclose 中处理重连
    };
  }, [currentUser, authToken, handleWSMessage, sendWSMessage, attemptReconnect]);

  // 创建房间
  const createRoom = useCallback(async (name: string): Promise<Room | null> => {
    if (!authToken) {
      setError('请先登录');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(errorData || '创建房间失败');
      }

      const data = await response.json();
      return data.room;
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建房间失败');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [authToken]);

  // 加入房间
  const joinRoom = useCallback(async (roomId: string): Promise<boolean> => {
    if (!authToken) {
      setError('请先登录');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/rooms/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ roomId }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(errorData || '加入房间失败');
      }

      const data = await response.json();
      setMyMember(data.member);

      // 获取房间详情
      const roomResponse = await fetch(`/api/rooms/${roomId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (roomResponse.ok) {
        const roomData = await roomResponse.json();
        setCurrentRoom(roomData);
        setMembers(roomData.members || []);
      }

      // 获取歌单
      const playlistResponse = await fetch(`/api/rooms/${roomId}/playlist`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (playlistResponse.ok) {
        const playlistData = await playlistResponse.json();
        setPlaylist(playlistData || []);
      }

      // 获取播放状态
      const playbackResponse = await fetch(`/api/rooms/${roomId}/playback`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (playbackResponse.ok) {
        const playbackData = await playbackResponse.json();
        setPlaybackState(playbackData);
      }

      // 连接 WebSocket
      connectWebSocket(roomId);

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入房间失败');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [authToken, connectWebSocket]);

  // 离开房间（暂时离开，房间仍然存在）
  const leaveRoom = useCallback(async (): Promise<void> => {
    if (!authToken || !currentRoom) return;

    try {
      await fetch('/api/rooms/leave', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          roomId: currentRoom.id,
        }),
      });
    } catch (err) {
      console.error('离开房间失败:', err);
    } finally {
      cleanup();
      setCurrentRoom(null);
      setMembers([]);
      setPlaylist([]);
      setPlaybackState(null);
      setMyMember(null);
    }
  }, [authToken, currentRoom, cleanup]);

  // 解散房间（仅房主可操作，房间将被关闭）
  const disbandRoom = useCallback(async (): Promise<void> => {
    if (!authToken || !currentRoom) return;

    try {
      const response = await fetch('/api/rooms/disband', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          roomId: currentRoom.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(errorData || '解散房间失败');
      }
    } catch (err) {
      console.error('解散房间失败:', err);
      throw err;
    } finally {
      cleanup();
      setCurrentRoom(null);
      setMembers([]);
      setPlaylist([]);
      setPlaybackState(null);
      setMyMember(null);
    }
  }, [authToken, currentRoom, cleanup]);

  // 切换模式
  const switchMode = useCallback(async (mode: 'chat' | 'listen'): Promise<void> => {
    if (!authToken || !currentRoom) return;

    try {
      const response = await fetch('/api/rooms/mode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ roomId: currentRoom.id, mode }),
      });

      if (response.ok) {
        setMyMember(prev => prev ? { ...prev, mode } : null);
        sendWSMessage('mode_sync', { mode });
      }
    } catch (err) {
      console.error('切换模式失败:', err);
    }
  }, [authToken, currentRoom, sendWSMessage]);

  // 播放控制
  const play = useCallback(() => {
    sendWSMessage('play', {
      position: playbackState?.position || 0,
      isPlaying: true,
    });
  }, [sendWSMessage, playbackState]);

  const pause = useCallback(() => {
    sendWSMessage('pause', {
      position: playbackState?.position || 0,
      isPlaying: false,
    });
  }, [sendWSMessage, playbackState]);

  const seek = useCallback((position: number) => {
    sendWSMessage('seek', { position });
  }, [sendWSMessage]);

  const nextSong = useCallback(() => {
    sendWSMessage('next');
  }, [sendWSMessage]);

  const prevSong = useCallback(() => {
    sendWSMessage('prev');
  }, [sendWSMessage]);

  // 歌单操作
  const addSong = useCallback((song: Omit<RoomPlaylistItem, 'position' | 'addedBy' | 'addedAt'>) => {
    sendWSMessage('song_add', song);
  }, [sendWSMessage]);

  const removeSong = useCallback((position: number) => {
    sendWSMessage('song_del', { position });
  }, [sendWSMessage]);

  // 聊天
  const sendMessage = useCallback((content: string) => {
    sendWSMessage('chat', { content });
  }, [sendWSMessage]);

  // 权限管理
  const transferOwner = useCallback((targetUserId: number) => {
    sendWSMessage('transfer_owner', { targetUserId });
  }, [sendWSMessage]);

  const grantControl = useCallback((targetUserId: number, canControl: boolean) => {
    sendWSMessage('grant_control', { targetUserId, canControl });
  }, [sendWSMessage]);

  // 房主同步上报
  const reportMasterPlayback = useCallback((data: Omit<MasterSyncData, 'serverTime' | 'masterId' | 'masterName'>) => {
    sendWSMessage('master_report', data);
  }, [sendWSMessage]);

  // 请求房主播放状态
  const requestMasterPlayback = useCallback(() => {
    sendWSMessage('master_request');
  }, [sendWSMessage]);

  // 切歌同步（有权限用户切歌后发送）
  const sendSongChange = useCallback((data: Omit<SongChangeData, 'changedBy' | 'changedByName' | 'timestamp'>) => {
    sendWSMessage('song_change', data);
  }, [sendWSMessage]);

  // 计算是否是房主
  const isOwner = currentRoom?.ownerId === currentUser?.id;

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // 网络状态监听 - 网络恢复时自动重连
  useEffect(() => {
    const handleOnline = () => {
      console.log('网络已恢复');
      if (currentRoomIdRef.current && !isConnected) {
        setError('网络已恢复，正在重连...');
        // 重置重连计数，给予新的机会
        reconnectAttemptsRef.current = 0;
        setReconnectAttempt(0);
        connectWebSocket(currentRoomIdRef.current);
      }
    };

    const handleOffline = () => {
      console.log('网络已断开');
      setError('网络已断开，等待恢复...');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isConnected, connectWebSocket]);

  const value: RoomContextType = {
    currentRoom,
    members,
    playlist,
    playbackState,
    myMember,
    isConnected,
    isLoading,
    error,
    reconnectAttempt,
    isOwner,
    createRoom,
    joinRoom,
    leaveRoom,
    disbandRoom,
    switchMode,
    play,
    pause,
    seek,
    nextSong,
    prevSong,
    addSong,
    removeSong,
    sendMessage,
    transferOwner,
    grantControl,
    reportMasterPlayback,
    requestMasterPlayback,
    sendSongChange,
  };

  return (
    <RoomContext.Provider value={value}>
      {children}
    </RoomContext.Provider>
  );
};

export const useRoom = (): RoomContextType => {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error('useRoom must be used within a RoomProvider');
  }
  return context;
};
