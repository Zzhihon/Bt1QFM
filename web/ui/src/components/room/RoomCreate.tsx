import React, { useState } from 'react';
import { useRoom } from '../../contexts/RoomContext';
import { useToast } from '../../contexts/ToastContext';
import { Plus, Loader2 } from 'lucide-react';

const RoomCreate: React.FC = () => {
  const { createRoom, joinRoom, isLoading } = useRoom();
  const { addToast } = useToast();
  const [roomName, setRoomName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!roomName.trim()) {
      addToast({ type: 'error', message: '请输入房间名称', duration: 2000 });
      return;
    }

    setIsCreating(true);
    try {
      const room = await createRoom(roomName.trim());
      if (room) {
        // 创建成功后自动加入
        const joined = await joinRoom(room.id);
        if (joined) {
          addToast({ type: 'success', message: `房间 "${room.name}" 创建成功！`, duration: 3000 });
        }
      }
    } catch (error) {
      console.error('Create room error:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreate();
    }
  };

  return (
    <div className="bg-cyber-bg-darker/30 rounded-xl p-4 border border-cyber-secondary/20">
      <h3 className="text-sm font-medium text-cyber-text mb-3">创建房间</h3>

      <div className="space-y-3">
        <input
          type="text"
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="输入房间名称"
          maxLength={20}
          disabled={isCreating || isLoading}
          className="w-full px-4 py-2.5 text-sm bg-cyber-bg-darker/40 text-cyber-text placeholder:text-cyber-secondary/50 rounded-lg border border-cyber-secondary/20 focus:outline-none focus:border-cyber-primary transition-colors"
        />

        <button
          onClick={handleCreate}
          disabled={isCreating || isLoading || !roomName.trim()}
          className="w-full py-2.5 bg-cyber-primary text-cyber-bg rounded-lg hover:bg-cyber-hover-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2"
        >
          {isCreating || isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>创建中...</span>
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              <span>创建房间</span>
            </>
          )}
        </button>
      </div>

      <p className="text-xs text-cyber-secondary/50 mt-3 text-center">
        创建后可分享 6 位房间号邀请好友
      </p>
    </div>
  );
};

export default RoomCreate;
