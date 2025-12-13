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

  // 房间操作
  createRoom: (name: string) => Promise<Room | null>;
  joinRoom: (roomId: string) => Promise<boolean>;
  leaveRoom: (transferTo?: number) => Promise<void>;

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

  // WebSocket 引用
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          // 聊天消息 - 可以通过事件分发或状态管理处理
          // 这里暂时不处理，由组件自己监听
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
      }
    } catch (err) {
      console.error('解析 WebSocket 消息失败:', err);
    }
  }, []);

  // 连接 WebSocket
  const connectWebSocket = useCallback((roomId: string) => {
    if (!currentUser || !authToken) return;

    cleanup();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/room/${roomId}?userId=${currentUser.id}&username=${encodeURIComponent(currentUser.username)}&token=${authToken}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket 连接成功');
      setIsConnected(true);
      setError(null);

      // 启动心跳
      pingIntervalRef.current = setInterval(() => {
        sendWSMessage('ping');
      }, 30000);
    };

    ws.onmessage = handleWSMessage;

    ws.onclose = (event) => {
      console.log('WebSocket 连接关闭:', event.code, event.reason);
      setIsConnected(false);

      // 非正常关闭时尝试重连
      if (event.code !== 1000 && currentRoom) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket(roomId);
        }, 3000);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket 错误:', err);
      setError('连接失败');
    };
  }, [currentUser, authToken, cleanup, handleWSMessage, sendWSMessage, currentRoom]);

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

  // 离开房间
  const leaveRoom = useCallback(async (transferTo?: number): Promise<void> => {
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
          transferTo,
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

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const value: RoomContextType = {
    currentRoom,
    members,
    playlist,
    playbackState,
    myMember,
    isConnected,
    isLoading,
    error,
    createRoom,
    joinRoom,
    leaveRoom,
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
