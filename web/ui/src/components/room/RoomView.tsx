import React, { useState, useEffect } from 'react';
import { useRoom } from '../../contexts/RoomContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import RoomChat from './RoomChat';
import RoomMembers from './RoomMembers';
import RoomPlaylist from './RoomPlaylist';
import RoomCreate from './RoomCreate';
import RoomJoin from './RoomJoin';
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
    switchMode,
    play,
    pause,
    nextSong,
    prevSong,
  } = useRoom();

  const [activeTab, setActiveTab] = useState<'chat' | 'playlist' | 'members'>('chat');
  const [copied, setCopied] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

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
    await leaveRoom();
    addToast({ type: 'info', message: '已离开房间', duration: 2000 });
  };

  // 切换模式
  const handleSwitchMode = async () => {
    const newMode = myMember?.mode === 'listen' ? 'chat' : 'listen';
    await switchMode(newMode);
    addToast({
      type: 'success',
      message: newMode === 'listen' ? '已切换到听歌模式' : '已切换到聊天模式',
      duration: 2000,
    });
  };

  // 检查是否可以控制播放
  const canControl = myMember?.role === 'owner' || myMember?.role === 'admin' || myMember?.canControl;

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
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 房间视图
  return (
    <div className="flex flex-col h-full bg-cyber-bg">
      {/* 顶部信息栏 */}
      <div className="bg-cyber-bg-darker/60 backdrop-blur-md border-b border-cyber-secondary/20 p-3">
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

        {/* 播放控制栏 */}
        {playbackState && (
          <div className="mt-3 pt-3 border-t border-cyber-secondary/10">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0 mr-4">
                <p className="text-sm font-medium text-cyber-text truncate">
                  {playbackState.currentSong?.name || '未播放'}
                </p>
                <p className="text-xs text-cyber-secondary/70 truncate">
                  {playbackState.currentSong?.artist || '-'}
                </p>
              </div>

              {canControl && (
                <div className="flex items-center space-x-2">
                  <button
                    onClick={prevSong}
                    className="p-2 rounded-full hover:bg-cyber-secondary/10 text-cyber-secondary hover:text-cyber-primary transition-colors"
                  >
                    <SkipBack className="w-5 h-5" />
                  </button>
                  <button
                    onClick={playbackState.isPlaying ? pause : play}
                    className="p-3 rounded-full bg-cyber-primary text-cyber-bg hover:bg-cyber-hover-primary transition-colors"
                  >
                    {playbackState.isPlaying ? (
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

      {/* 标签切换 */}
      <div className="flex border-b border-cyber-secondary/20 bg-cyber-bg-darker/30">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-3 flex items-center justify-center space-x-2 text-sm font-medium transition-colors ${
            activeTab === 'chat'
              ? 'text-cyber-primary border-b-2 border-cyber-primary'
              : 'text-cyber-secondary/70 hover:text-cyber-text'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>聊天</span>
        </button>
        <button
          onClick={() => setActiveTab('playlist')}
          className={`flex-1 py-3 flex items-center justify-center space-x-2 text-sm font-medium transition-colors ${
            activeTab === 'playlist'
              ? 'text-cyber-primary border-b-2 border-cyber-primary'
              : 'text-cyber-secondary/70 hover:text-cyber-text'
          }`}
        >
          <Music2 className="w-4 h-4" />
          <span>歌单 ({playlist.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('members')}
          className={`flex-1 py-3 flex items-center justify-center space-x-2 text-sm font-medium transition-colors ${
            activeTab === 'members'
              ? 'text-cyber-primary border-b-2 border-cyber-primary'
              : 'text-cyber-secondary/70 hover:text-cyber-text'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>成员 ({members.length})</span>
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'chat' && <RoomChat />}
        {activeTab === 'playlist' && <RoomPlaylist />}
        {activeTab === 'members' && <RoomMembers />}
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
            <h3 className="text-lg font-semibold text-cyber-text mb-2">离开房间</h3>
            <p className="text-sm text-cyber-secondary/70 mb-6">
              {myMember?.role === 'owner'
                ? '你是房主，离开后房间将转让给其他成员或关闭。确定要离开吗？'
                : '确定要离开房间吗？'}
            </p>
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
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomView;
