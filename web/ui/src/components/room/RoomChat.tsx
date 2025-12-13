import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRoom } from '../../contexts/RoomContext';
import { useAuth } from '../../contexts/AuthContext';
import { usePlayer } from '../../contexts/PlayerContext';
import { useToast } from '../../contexts/ToastContext';
import { Send, User, Music2, PlayCircle, Plus } from 'lucide-react';

interface SongCard {
  id: number | string;
  name: string;
  artists: string[];
  album: string;
  duration: number;
  picUrl?: string;
  coverUrl?: string;
  hlsUrl?: string;
  source?: string;
}

interface ChatMessage {
  id: number;
  userId: number;
  username: string;
  content: string;
  timestamp: number;
  type: 'chat' | 'system' | 'song' | 'song_search';
  songs?: SongCard[];
}

const RoomChat: React.FC = () => {
  const { currentUser, authToken } = useAuth();
  const { sendMessage, isConnected, currentRoom, addSong } = useRoom();
  const { playTrack } = usePlayer();
  const { addToast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasLoadedHistory = useRef(false);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 加载历史消息
  useEffect(() => {
    const loadHistoryMessages = async () => {
      if (!currentRoom?.id || !authToken || hasLoadedHistory.current) return;

      try {
        const response = await fetch(`/api/rooms/${currentRoom.id}/messages?limit=50`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        });

        if (response.ok) {
          const historyMessages = await response.json();
          if (Array.isArray(historyMessages) && historyMessages.length > 0) {
            const formattedMessages: ChatMessage[] = historyMessages.map((msg: {
              id: number;
              userId: number;
              username: string;
              content: string;
              createdAt: string;
              messageType: string;
              songs?: SongCard[];
            }) => {
              // 判断消息类型
              let msgType: 'chat' | 'system' | 'song' | 'song_search' = 'chat';
              if (msg.messageType === 'system') {
                msgType = 'system';
              } else if (msg.messageType === 'song_search') {
                msgType = 'song_search';
              } else if (msg.messageType === 'song_add') {
                msgType = 'song';
              }

              return {
                id: msg.id,
                userId: msg.userId,
                username: msg.username || '未知用户',
                content: msg.content,
                timestamp: new Date(msg.createdAt).getTime(),
                type: msgType,
                songs: msg.songs,
              };
            });
            setMessages(formattedMessages);
            hasLoadedHistory.current = true;
          }
        }
      } catch (err) {
        console.error('加载历史消息失败:', err);
      }
    };

    loadHistoryMessages();
  }, [currentRoom?.id, authToken]);

  // 房间切换时重置
  useEffect(() => {
    hasLoadedHistory.current = false;
    setMessages([]);
  }, [currentRoom?.id]);

  // 监听 WebSocket 消息（通过全局事件）
  useEffect(() => {
    const handleRoomMessage = (event: CustomEvent<ChatMessage>) => {
      const newMessage = event.detail;
      // 过滤掉自己发送的普通聊天消息（已通过乐观更新显示）
      // 但 song_search 类型需要显示（包含歌曲卡片数据）
      if (newMessage.userId === currentUser?.id && newMessage.type !== 'song_search') {
        return;
      }
      setMessages((prev) => [...prev, newMessage]);
    };

    window.addEventListener('room-chat-message', handleRoomMessage as EventListener);
    return () => {
      window.removeEventListener('room-chat-message', handleRoomMessage as EventListener);
    };
  }, [currentUser?.id]);

  // 发送消息
  const handleSend = async () => {
    if (!inputValue.trim() || !isConnected) return;

    const content = inputValue.trim();
    setInputValue('');

    // 所有消息都发送到服务器（包括 /netease 命令）
    sendMessage(content);

    // 本地显示（乐观更新）- 只对非命令消息显示
    // /netease 命令的结果会通过 WebSocket 广播回来
    if (!content.startsWith('/')) {
      const localMessage: ChatMessage = {
        id: Date.now(),
        userId: currentUser?.id as number,
        username: currentUser?.username || '我',
        content,
        timestamp: Date.now(),
        type: 'chat',
      };
      setMessages((prev) => [...prev, localMessage]);
    }
  };

  // 播放歌曲
  const handlePlay = async (song: SongCard) => {
    try {
      const artistStr = Array.isArray(song.artists) ? song.artists.join(', ') : (song.artists || '未知艺术家');
      const hlsUrl = `/streams/netease/${song.id}/playlist.m3u8`;

      addToast({
        type: 'info',
        message: `正在准备播放: ${song.name}`,
        duration: 2000,
      });

      const trackData = {
        id: song.id,
        neteaseId: song.id,
        title: song.name,
        artist: artistStr,
        album: song.album || '未知专辑',
        coverArtPath: song.coverUrl || song.picUrl || '',
        url: hlsUrl,
        hlsPlaylistUrl: hlsUrl,
        position: 0,
        source: 'netease',
      };

      playTrack(trackData);

      addToast({
        type: 'success',
        message: `开始播放: ${song.name}`,
        duration: 2000,
      });
    } catch (error) {
      console.error('播放失败:', error);
      addToast({
        type: 'error',
        message: '播放失败',
        duration: 3000,
      });
    }
  };

  // 添加到播放列表（仅添加到房间歌单，不影响个人播放列表）
  const handleAddToPlaylist = async (song: SongCard) => {
    try {
      const artistStr = Array.isArray(song.artists) ? song.artists.join(', ') : (song.artists || '未知艺术家');

      // 添加到房间歌单（通过 WebSocket 广播给所有人）
      addSong({
        songId: String(song.id),
        name: song.name,
        artist: artistStr,
        cover: song.coverUrl || song.picUrl || '',
        duration: song.duration,
        source: 'netease',
      });

      addToast({
        type: 'success',
        message: '已添加到房间歌单',
        duration: 2000,
      });
    } catch (error) {
      console.error('添加失败:', error);
      addToast({
        type: 'error',
        message: '添加失败',
        duration: 3000,
      });
    }
  };

  // 处理回车发送
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  // 格式化歌曲时长
  const formatDuration = (milliseconds: number): string => {
    const seconds = Math.floor(milliseconds / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 渲染歌曲卡片
  const renderSongCard = (song: SongCard) => (
    <div key={song.id} className="mt-2 p-2 bg-cyber-bg/50 rounded-lg border border-cyber-secondary/30">
      <div className="flex items-center gap-2">
        {/* 封面 */}
        <div className="w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-cyber-bg">
          {song.coverUrl || song.picUrl ? (
            <img
              src={song.coverUrl || song.picUrl}
              alt={song.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music2 className="h-6 w-6 text-cyber-primary" />
            </div>
          )}
        </div>

        {/* 歌曲信息 */}
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-cyber-text truncate text-xs">{song.name}</h4>
          <p className="text-xs text-cyber-primary truncate">
            {Array.isArray(song.artists) ? song.artists.join(', ') : song.artists}
          </p>
          <p className="text-xs text-cyber-secondary/70 truncate">{song.album}</p>
          {song.duration > 0 && (
            <span className="text-xs text-cyber-secondary/70">{formatDuration(song.duration)}</span>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col gap-1">
          <button
            onClick={() => handlePlay(song)}
            className="p-1.5 rounded-full bg-cyber-primary hover:bg-cyber-hover-primary transition-all"
            title="播放"
          >
            <PlayCircle className="h-3 w-3 text-cyber-bg" />
          </button>
          <button
            onClick={() => handleAddToPlaylist(song)}
            className="p-1.5 rounded-full bg-cyber-primary/20 hover:bg-cyber-primary/40 transition-all"
            title="添加到播放列表"
          >
            <Plus className="h-3 w-3 text-cyber-primary" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full pb-[100px] md:pb-[84px]">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-cyber-secondary/50">
            <User className="w-12 h-12 mb-2" />
            <p className="text-sm">还没有消息，发一条吧～</p>
            <p className="text-xs mt-1">输入 /netease 歌曲名 搜索音乐</p>
          </div>
        )}

        {messages.map((msg) => {
          const isMe = msg.userId === currentUser?.id;
          const isSystem = msg.type === 'system';
          const hasSongs = (msg.type === 'song' || msg.type === 'song_search') && msg.songs && msg.songs.length > 0;

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center">
                <span className="text-xs text-cyber-secondary/50 bg-cyber-bg-darker/30 px-3 py-1 rounded-full">
                  {msg.content}
                </span>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex ${isMe ? 'flex-row-reverse' : 'flex-row'} items-start gap-2 group`}
            >
              {/* 头像 */}
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${
                  isMe
                    ? 'bg-gradient-to-br from-cyber-primary to-cyber-primary/70'
                    : 'bg-gradient-to-br from-cyber-secondary/30 to-cyber-secondary/10'
                }`}
              >
                <span className={`text-xs font-semibold ${isMe ? 'text-white' : 'text-cyber-secondary'}`}>
                  {isMe
                    ? (currentUser?.username?.charAt(0).toUpperCase() || 'U')
                    : (msg.username?.charAt(0)?.toUpperCase() || '?')
                  }
                </span>
              </div>

              {/* 消息气泡 */}
              <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%]`}>
                {/* 用户名 */}
                {!isMe && msg.username && (
                  <span className="text-xs text-cyber-secondary/60 mb-1 ml-1">{msg.username}</span>
                )}

                {/* 气泡主体 */}
                <div
                  className={`relative px-3 py-2 shadow-sm ${
                    isMe
                      ? 'bg-gradient-to-br from-cyber-primary to-cyber-primary/90 text-white rounded-2xl rounded-tr-md'
                      : 'bg-cyber-bg-darker/70 text-cyber-text border border-cyber-secondary/10 rounded-2xl rounded-tl-md backdrop-blur-sm'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>

                  {/* 歌曲卡片 */}
                  {hasSongs && msg.songs && msg.songs.map(song => renderSongCard(song))}
                </div>

                {/* 时间戳 */}
                <span
                  className={`text-[10px] mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${
                    isMe ? 'text-cyber-secondary/50 mr-1' : 'text-cyber-secondary/50 ml-1'
                  }`}
                >
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 - 更紧凑的设计 */}
      <div className="px-3 py-2 bg-cyber-bg-darker/80 backdrop-blur-md border-t border-cyber-secondary/10">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center bg-cyber-bg/60 rounded-full border border-cyber-secondary/15 focus-within:border-cyber-primary/50 transition-colors">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="发送消息或 /netease 歌曲名..."
              className="flex-1 px-4 py-1.5 text-sm bg-transparent text-cyber-text placeholder:text-cyber-secondary/40 focus:outline-none resize-none"
              rows={1}
              disabled={!isConnected}
            />
            <button
              onClick={handleSend}
              disabled={!inputValue.trim() || !isConnected}
              className="p-2 mr-1 text-cyber-primary hover:bg-cyber-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all rounded-full"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!isConnected && (
          <p className="text-[10px] text-red-400/80 mt-1 text-center">连接已断开，正在重连...</p>
        )}
      </div>
    </div>
  );
};

export default RoomChat;
