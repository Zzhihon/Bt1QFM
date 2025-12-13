import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useRoom } from '../../contexts/RoomContext';
import { useToast } from '../../contexts/ToastContext';
import {
  Users,
  Crown,
  RefreshCw,
  Loader2,
  ChevronRight,
  Clock
} from 'lucide-react';

interface UserRoomInfo {
  id: string;
  name: string;
  ownerId: number;
  ownerName: string;
  memberCount: number;
  isOwner: boolean;
  joinedAt: string;
  status: string;
}

const MyRoomList: React.FC = () => {
  const { authToken } = useAuth();
  const { joinRoom, isLoading: isJoining } = useRoom();
  const { addToast } = useToast();

  const [rooms, setRooms] = useState<UserRoomInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);

  // 加载房间列表
  const loadMyRooms = useCallback(async () => {
    if (!authToken) return;

    setIsLoading(true);
    try {
      const response = await fetch('/api/rooms/my', {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setRooms(Array.isArray(data) ? data : []);
      } else {
        console.error('Failed to load rooms:', response.statusText);
      }
    } catch (err) {
      console.error('Load rooms error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [authToken]);

  // 初始加载
  useEffect(() => {
    loadMyRooms();
  }, [loadMyRooms]);

  // 快速加入房间
  const handleQuickJoin = async (roomId: string, roomName: string) => {
    setJoiningRoomId(roomId);
    try {
      const success = await joinRoom(roomId);
      if (success) {
        addToast({ type: 'success', message: `已加入 "${roomName}"`, duration: 2000 });
      }
    } catch (error) {
      console.error('Quick join error:', error);
      addToast({ type: 'error', message: '加入失败，请重试', duration: 2000 });
    } finally {
      setJoiningRoomId(null);
    }
  };

  // 格式化时间
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  // 无房间时不显示
  if (!isLoading && rooms.length === 0) {
    return null;
  }

  return (
    <div className="bg-cyber-bg-darker/30 rounded-xl p-4 border border-cyber-secondary/20">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-cyber-text flex items-center gap-2">
          <Clock className="w-4 h-4 text-cyber-secondary" />
          我的房间
        </h3>
        <button
          onClick={loadMyRooms}
          disabled={isLoading}
          className="p-1.5 rounded-lg text-cyber-secondary hover:text-cyber-primary hover:bg-cyber-secondary/10 transition-colors disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isLoading && rooms.length === 0 ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 text-cyber-primary animate-spin" />
        </div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-cyber-secondary/20">
          {rooms.map((room) => (
            <button
              key={room.id}
              onClick={() => handleQuickJoin(room.id, room.name)}
              disabled={isJoining || joiningRoomId === room.id}
              className="w-full flex items-center justify-between p-3 rounded-lg bg-cyber-bg/50 hover:bg-cyber-bg border border-cyber-secondary/10 hover:border-cyber-primary/30 transition-all group disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* 房间图标 */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                  room.isOwner
                    ? 'bg-gradient-to-br from-yellow-500/20 to-orange-500/20'
                    : 'bg-cyber-secondary/10'
                }`}>
                  {room.isOwner ? (
                    <Crown className="w-4 h-4 text-yellow-500" />
                  ) : (
                    <Users className="w-4 h-4 text-cyber-secondary" />
                  )}
                </div>

                {/* 房间信息 */}
                <div className="min-w-0 text-left">
                  <p className="text-sm font-medium text-cyber-text truncate">
                    {room.name}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-cyber-secondary/60">
                    <span>#{room.id}</span>
                    <span>·</span>
                    <span>{room.memberCount}人</span>
                    {room.isOwner && (
                      <>
                        <span>·</span>
                        <span className="text-yellow-500/80">房主</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* 右侧箭头/加载 */}
              <div className="flex-shrink-0 ml-2">
                {joiningRoomId === room.id ? (
                  <Loader2 className="w-4 h-4 text-cyber-primary animate-spin" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-cyber-secondary/40 group-hover:text-cyber-primary transition-colors" />
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-cyber-secondary/50 mt-3 text-center">
        点击快速进入房间
      </p>
    </div>
  );
};

export default MyRoomList;
