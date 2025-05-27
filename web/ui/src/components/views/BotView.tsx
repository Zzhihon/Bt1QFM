import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePlayer } from '../../contexts/PlayerContext';
import { useToast } from '../../contexts/ToastContext';
import { Music2, Search, PlayCircle, Send, Bot, User, Hash, Plus, Settings, Headphones } from 'lucide-react';

interface Message {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: Date;
  song?: NeteaseSong;
}

interface NeteaseSong {
  id: number;
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string; picUrl: string };
  duration: number;
  url: string;
  videoUrl?: string; // 动态封面视频URL
}

const BotView: React.FC = () => {
  const { currentUser } = useAuth();
  const { playTrack, playerState } = usePlayer();
  const { addToast } = useToast();
  const [command, setCommand] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'bot',
      content: '你好！我是音乐助手，输入 /netease [歌曲名称] 来搜索音乐吧！',
      timestamp: new Date(),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [processingSongs, setProcessingSongs] = useState<Set<number>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    // 添加用户消息
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: command,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    // 检查是否是网易云音乐命令
    if (!command.startsWith('/netease ')) {
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'bot',
        content: '请输入正确的命令格式: /netease [歌曲名称]',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMessage]);
      setCommand('');
      return;
    }

    const keyword = command.replace('/netease ', '').trim();
    if (!keyword) {
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'bot',
        content: '请输入要搜索的歌曲名称',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMessage]);
      setCommand('');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/netease/search?q=${encodeURIComponent(keyword)}`);
      if (!response.ok) {
        throw new Error('搜索失败');
      }
      const data = await response.json();
      if (data.success && data.data) {
        const songs = data.data.slice(0, 3);
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          type: 'bot',
          content: `找到以下歌曲：`,
          timestamp: new Date(),
          song: songs[0],
        };
        setMessages(prev => [...prev, botMessage]);
      } else {
        throw new Error(data.error || '搜索失败');
      }
    } catch (error: any) {
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'bot',
        content: error.message || '搜索失败',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMessage]);
    } finally {
      setIsLoading(false);
      setCommand('');
    }
  };

  const handlePlay = async (song: NeteaseSong) => {
    // 检查是否是当前正在播放的歌曲
    if (playerState.currentTrack && playerState.currentTrack.id === song.id) {
      addToast({
        type: 'info',
        message: '播放中...',
        duration: 2000,
      });
      return;
    }

    // 检查歌曲是否正在处理中
    if (processingSongs.has(song.id)) {
      addToast({
        type: 'info',
        message: '歌曲正在处理中，请稍后再试...',
        duration: 3000,
      });
      return;
    }

    try {
      // 添加到处理中集合
      setProcessingSongs(prev => new Set([...prev, song.id]));

      const response = await fetch(`/api/netease/command?command=/netease ${song.id}`);
      if (!response.ok) {
        throw new Error('获取播放地址失败');
      }
      
      const data = await response.json();
      if (!data.success) {
        // 检查是否是处理中的状态
        if (data.error === '歌曲正在处理中，请稍后再试') {
          addToast({
            type: 'info',
            message: '正在处理中...',
            duration: 3000,
          });
          return;
        }
        throw new Error(data.error || '获取播放地址失败');
      }

      if (!Array.isArray(data.data) || data.data.length === 0) {
        throw new Error('获取播放地址失败');
      }

      const songData = data.data[0];
      if (!songData || !songData.url) {
        throw new Error('获取播放地址失败');
      }

      playTrack({
        id: song.id,
        title: song.name,
        artist: song.artists.map(a => a.name).join(', '),
        album: song.album.name,
        coverArtPath: song.album.picUrl,
        url: songData.url,
        position: 0
      });

      const botMessage: Message = {
        id: Date.now().toString(),
        type: 'bot',
        content: `正在播放: ${song.name}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMessage]);
    } catch (error: any) {
      addToast({
        type: 'error',
        message: error.message || '播放失败',
        duration: 3000,
      });
    } finally {
      // 从处理中集合中移除
      setProcessingSongs(prev => {
        const newSet = new Set(prev);
        newSet.delete(song.id);
        return newSet;
      });
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)] bg-cyber-bg">
      {/* 左侧频道栏 */}
      <div className="w-64 bg-cyber-bg-darker/50 backdrop-blur-sm border-r border-cyber-secondary/30 flex flex-col">
        {/* 服务器信息 */}
        <div className="p-4 border-b border-cyber-secondary/30">
          <h2 className="text-xl font-bold text-cyber-primary flex items-center">
            <Headphones className="w-6 h-6 mr-2" />
            音乐频道
          </h2>
        </div>

        {/* 频道列表 */}
        <div className="flex-1 overflow-y-auto p-3 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-cyber-bg/20 [&::-webkit-scrollbar-thumb]:bg-cyber-secondary/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-cyber-primary/50">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-cyber-secondary/70 px-2 py-1 flex items-center justify-between">
              <span>音乐频道</span>
              <Plus className="w-4 h-4 cursor-pointer hover:text-cyber-primary transition-colors" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center px-2 py-2 rounded-lg bg-cyber-primary/10 text-cyber-primary cursor-pointer hover:bg-cyber-primary/20 transition-colors">
                <Hash className="w-4 h-4 mr-2" />
                <span className="text-sm font-medium">音乐助手</span>
              </div>
              <div className="flex items-center px-2 py-2 rounded-lg hover:bg-cyber-bg/50 cursor-pointer text-cyber-secondary/70 transition-colors">
                <Hash className="w-4 h-4 mr-2" />
                <span className="text-sm">流行音乐</span>
              </div>
              <div className="flex items-center px-2 py-2 rounded-lg hover:bg-cyber-bg/50 cursor-pointer text-cyber-secondary/70 transition-colors">
                <Hash className="w-4 h-4 mr-2" />
                <span className="text-sm">经典老歌</span>
              </div>
            </div>
          </div>
        </div>

        {/* 用户信息 */}
        {/* <div className="p-3 border-t border-cyber-secondary/30">
          <div className="flex items-center p-2 rounded-lg bg-cyber-bg/30 hover:bg-cyber-bg/50 transition-colors">
            <div className="w-9 h-9 rounded-full bg-cyber-primary flex items-center justify-center mr-2">
              <User className="w-5 h-5 text-cyber-bg" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-cyber-text truncate">
                {currentUser?.username || '游客'}
              </div>
            </div>
            <Settings className="w-4 h-4 text-cyber-secondary/70 cursor-pointer hover:text-cyber-primary transition-colors" />
          </div>
        </div> */}
      </div>

      {/* 中间聊天区域 */}
      <div className="flex-1 flex flex-col">
        {/* 频道标题 */}
        <div className="h-14 border-b border-cyber-secondary/30 flex items-center px-6 bg-cyber-bg-darker/30 backdrop-blur-sm">
          <Hash className="w-5 h-5 text-cyber-primary mr-2" />
          <span className="font-semibold text-cyber-text">音乐助手</span>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 pb-36 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-cyber-bg/20 [&::-webkit-scrollbar-thumb]:bg-cyber-secondary/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-cyber-primary/50">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'} items-end space-x-3`}
            >
              {message.type === 'bot' && (
                <div className="w-10 h-10 rounded-full bg-cyber-primary/20 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-6 h-6 text-cyber-primary" />
                </div>
              )}
              <div
                className={`max-w-[70%] rounded-2xl p-4 ${
                  message.type === 'user'
                    ? 'bg-cyber-primary text-cyber-bg'
                    : 'bg-cyber-bg-darker/50 backdrop-blur-sm text-cyber-text'
                }`}
              >
                <p className="text-sm">{message.content}</p>
                {message.song && (
                  <div
                    className="mt-3 bg-cyber-bg/30 rounded-xl p-3 cursor-pointer hover:bg-cyber-bg/50 transition-colors"
                    onClick={() => handlePlay(message.song!)}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 bg-cyber-bg rounded-lg overflow-hidden flex-shrink-0">
                        {message.song.videoUrl ? (
                          <video
                            src={message.song.videoUrl}
                            className="w-full h-full object-cover"
                            autoPlay
                            loop
                            muted
                            playsInline
                          />
                        ) : message.song.album.picUrl ? (
                          <img
                            src={message.song.album.picUrl}
                            alt={message.song.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music2 className="h-6 w-6 text-cyber-primary" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium truncate">{message.song.name}</h4>
                        <p className="text-xs text-cyber-secondary/70 truncate">
                          {message.song.artists.map(a => a.name).join(', ')}
                        </p>
                      </div>
                      <PlayCircle className="h-6 w-6 text-cyber-primary flex-shrink-0" />
                    </div>
                  </div>
                )}
                <span className="text-xs opacity-50 mt-2 block">
                  {message.timestamp.toLocaleTimeString()}
                </span>
              </div>
              {message.type === 'user' && (
                <div className="w-10 h-10 rounded-full bg-cyber-secondary/20 flex items-center justify-center flex-shrink-0">
                  <User className="w-6 h-6 text-cyber-secondary" />
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <div className="fixed bottom-[84px] left-0 right-0 px-4">
          <form onSubmit={handleCommand} className="max-w-4xl mx-auto">
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="输入 /netease [歌曲名称] 搜索音乐..."
                className="flex-1 p-2 bg-cyber-bg/20 border-2 border-cyber-secondary/20 rounded-xl text-cyber-text text-sm focus:outline-none focus:border-cyber-primary/50 focus:bg-cyber-bg/30 transition-all duration-300"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="p-2 bg-cyber-primary/60 text-cyber-bg rounded-xl hover:bg-cyber-primary/80 transition-all duration-300 disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-cyber-bg border-t-transparent" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* 右侧用户列表 */}
      <div className="w-64 bg-cyber-bg-darker/50 backdrop-blur-sm border-l border-cyber-secondary/30 p-4 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-cyber-bg/20 [&::-webkit-scrollbar-thumb]:bg-cyber-secondary/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-cyber-primary/50">
        <div className="text-xs font-semibold text-cyber-secondary/70 mb-3 px-2">在线用户</div>
        <div className="space-y-2">
          <div className="flex items-center p-2 rounded-lg hover:bg-cyber-bg/50 cursor-pointer transition-colors">
            <div className="w-9 h-9 rounded-full bg-cyber-primary/20 flex items-center justify-center mr-2">
              <Bot className="w-5 h-5 text-cyber-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-cyber-text truncate">音乐助手</div>
              <div className="text-xs text-cyber-secondary/70">机器人</div>
            </div>
          </div>
          <div className="flex items-center p-2 rounded-lg hover:bg-cyber-bg/50 cursor-pointer transition-colors">
            <div className="w-9 h-9 rounded-full bg-cyber-secondary/20 flex items-center justify-center mr-2">
              <User className="w-5 h-5 text-cyber-secondary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-cyber-text truncate">
                {currentUser?.username || '游客'}
              </div>
              <div className="text-xs text-cyber-secondary/70">在线</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BotView; 