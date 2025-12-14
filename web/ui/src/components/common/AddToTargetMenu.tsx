import React, { useEffect, useRef, useState } from 'react';
import { ListMusic, Radio, ChevronRight, X, Users } from 'lucide-react';
import { useRoom } from '../../contexts/RoomContext';
import { useAuth } from '../../contexts/AuthContext';
import { Track, RoomInfo } from '../../types';

interface AddToTargetMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToPersonal: () => void;
  onAddToRoom: (roomId: string) => void;
  position?: { x: number; y: number };
  anchorEl?: HTMLElement | null;
  track?: Track;
  tracks?: Track[]; // 批量添加时使用
}

interface RoomListItem {
  id: string;
  name: string;
  memberCount?: number;
}

const AddToTargetMenu: React.FC<AddToTargetMenuProps> = ({
  isOpen,
  onClose,
  onAddToPersonal,
  onAddToRoom,
  position,
  anchorEl,
  track,
  tracks,
}) => {
  const { currentRoom } = useRoom();
  const { authToken } = useAuth();
  const [userRooms, setUserRooms] = useState<RoomListItem[]>([]);
  const [showRoomList, setShowRoomList] = useState(false);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 获取用户参与的房间列表
  useEffect(() => {
    if (isOpen && authToken) {
      fetchUserRooms();
    }
  }, [isOpen, authToken]);

  const fetchUserRooms = async () => {
    if (!authToken) return;

    setIsLoadingRooms(true);
    try {
      const response = await fetch('/api/rooms/my', {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (response.ok) {
        const rooms: RoomInfo[] = await response.json();
        setUserRooms(rooms.map(room => ({
          id: room.id,
          name: room.name,
          memberCount: room.members?.length || 0,
        })));
      }
    } catch (error) {
      console.error('获取房间列表失败:', error);
    } finally {
      setIsLoadingRooms(false);
    }
  };

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose]);

  // 计算菜单位置
  const getMenuStyle = (): React.CSSProperties => {
    if (position) {
      return {
        position: 'fixed',
        left: Math.min(position.x, window.innerWidth - 240),
        top: Math.min(position.y, window.innerHeight - 200),
      };
    }

    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      return {
        position: 'fixed',
        left: Math.min(rect.left, window.innerWidth - 240),
        top: Math.min(rect.bottom + 4, window.innerHeight - 200),
      };
    }

    return {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    };
  };

  const handleAddToPersonal = () => {
    onAddToPersonal();
    onClose();
  };

  const handleAddToRoom = (roomId: string) => {
    onAddToRoom(roomId);
    onClose();
    setShowRoomList(false);
  };

  if (!isOpen) return null;

  const trackCount = tracks?.length || (track ? 1 : 0);
  const title = trackCount > 1 ? `添加 ${trackCount} 首歌曲到...` : '添加到...';

  return (
    <>
      {/* 遮罩层 */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* 菜单 */}
      <div
        ref={menuRef}
        className="z-50 bg-cyber-bg-darker border border-cyber-primary/30 rounded-lg shadow-xl overflow-hidden min-w-[200px]"
        style={getMenuStyle()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-cyber-primary/20 bg-cyber-bg">
          <span className="text-sm font-medium text-cyber-primary">{title}</span>
          <button
            onClick={onClose}
            className="text-cyber-secondary hover:text-cyber-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!showRoomList ? (
          <div className="py-2">
            {/* 添加到个人播放列表 */}
            <button
              onClick={handleAddToPersonal}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-cyber-bg transition-colors text-left"
            >
              <ListMusic className="h-5 w-5 text-cyber-secondary" />
              <span className="text-cyber-text">个人播放列表</span>
            </button>

            {/* 添加到聊天室 */}
            <button
              onClick={() => setShowRoomList(true)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-cyber-bg transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <Radio className="h-5 w-5 text-cyber-secondary" />
                <span className="text-cyber-text">多人聊天室</span>
              </div>
              <ChevronRight className="h-4 w-4 text-cyber-secondary" />
            </button>
          </div>
        ) : (
          <div className="py-2">
            {/* 返回按钮 */}
            <button
              onClick={() => setShowRoomList(false)}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-cyber-secondary hover:text-cyber-primary transition-colors border-b border-cyber-primary/10"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
              <span>返回</span>
            </button>

            {isLoadingRooms ? (
              <div className="px-4 py-6 text-center text-cyber-secondary text-sm">
                加载中...
              </div>
            ) : userRooms.length === 0 ? (
              <div className="px-4 py-6 text-center text-cyber-secondary text-sm">
                暂无可用的聊天室
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto">
                {/* 当前房间优先显示 */}
                {currentRoom && (
                  <button
                    onClick={() => handleAddToRoom(currentRoom.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-cyber-bg transition-colors text-left bg-cyber-primary/10"
                  >
                    <Users className="h-5 w-5 text-cyber-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="text-cyber-primary truncate">{currentRoom.name}</div>
                      <div className="text-xs text-cyber-secondary">当前房间</div>
                    </div>
                  </button>
                )}

                {/* 其他房间 */}
                {userRooms
                  .filter(room => room.id !== currentRoom?.id)
                  .map(room => (
                    <button
                      key={room.id}
                      onClick={() => handleAddToRoom(room.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-cyber-bg transition-colors text-left"
                    >
                      <Radio className="h-5 w-5 text-cyber-secondary" />
                      <div className="flex-1 min-w-0">
                        <div className="text-cyber-text truncate">{room.name}</div>
                        {room.memberCount !== undefined && (
                          <div className="text-xs text-cyber-secondary">
                            {room.memberCount} 人在线
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default AddToTargetMenu;
