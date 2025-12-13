import React, { useState } from 'react';
import { useRoom } from '../../contexts/RoomContext';
import { useToast } from '../../contexts/ToastContext';
import { LogIn, Loader2 } from 'lucide-react';

const RoomJoin: React.FC = () => {
  const { joinRoom, isLoading } = useRoom();
  const { addToast } = useToast();
  const [roomId, setRoomId] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const handleJoin = async () => {
    const id = roomId.trim();
    if (!id) {
      addToast({ type: 'error', message: '请输入房间号', duration: 2000 });
      return;
    }

    // 验证房间号格式（6 位数字）
    if (!/^\d{6}$/.test(id)) {
      addToast({ type: 'error', message: '房间号格式不正确（应为 6 位数字）', duration: 2000 });
      return;
    }

    setIsJoining(true);
    try {
      const success = await joinRoom(id);
      if (success) {
        addToast({ type: 'success', message: '加入房间成功！', duration: 2000 });
      }
    } catch (error) {
      console.error('Join room error:', error);
    } finally {
      setIsJoining(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleJoin();
    }
  };

  // 只允许输入数字，最多 6 位
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setRoomId(value);
  };

  return (
    <div className="bg-cyber-bg-darker/30 rounded-xl p-4 border border-cyber-secondary/20">
      <h3 className="text-sm font-medium text-cyber-text mb-3">加入房间</h3>

      <div className="space-y-3">
        <input
          type="text"
          value={roomId}
          onChange={handleInputChange}
          onKeyPress={handleKeyPress}
          placeholder="输入 6 位房间号"
          disabled={isJoining || isLoading}
          className="w-full px-4 py-2.5 text-sm bg-cyber-bg-darker/40 text-cyber-text placeholder:text-cyber-secondary/50 rounded-lg border border-cyber-secondary/20 focus:outline-none focus:border-cyber-primary transition-colors text-center tracking-widest font-mono"
          style={{ letterSpacing: '0.5em' }}
        />

        <button
          onClick={handleJoin}
          disabled={isJoining || isLoading || roomId.length !== 6}
          className="w-full py-2.5 bg-cyber-secondary/20 text-cyber-text rounded-lg hover:bg-cyber-secondary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2 border border-cyber-secondary/30"
        >
          {isJoining || isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>加入中...</span>
            </>
          ) : (
            <>
              <LogIn className="w-4 h-4" />
              <span>加入房间</span>
            </>
          )}
        </button>
      </div>

      <p className="text-xs text-cyber-secondary/50 mt-3 text-center">
        向房主索要房间号即可加入
      </p>
    </div>
  );
};

export default RoomJoin;
