import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePlayer } from '../../contexts/PlayerContext';
import { useToast } from '../../contexts/ToastContext';
import { Music2, Search, PlayCircle, Send, Bot, User, Hash, Plus, Settings, Headphones, Minus, Clock, X } from 'lucide-react';

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
  artists: string[];
  album: string;
  duration: number;
  picUrl: string;
  videoUrl?: string;
  addedToPlaylist: boolean;
  coverUrl?: string;
}

// 获取后端 URL，提供默认值
const getBackendUrl = () => {
  if (typeof window !== 'undefined' && (window as any).__ENV__?.BACKEND_URL) {
    return (window as any).__ENV__.BACKEND_URL;
  }
  return import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';
};

const BotView: React.FC = () => {
  const { currentUser, authToken } = useAuth();
  const { 
    playTrack, 
    playerState, 
    addToPlaylist,
    updatePlaylist,
    showPlaylist,
    setShowPlaylist 
  } = usePlayer();
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
  const [showMobileUserList, setShowMobileUserList] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 获取后端 URL
  const backendUrl = getBackendUrl();

  // 添加调试信息，打印后端URL配置
  useEffect(() => {
    console.log('🔧 BotView 后端URL配置信息:');
    console.log('  - VITE_BACKEND_URL 环境变量:', import.meta.env.VITE_BACKEND_URL);
    console.log('  - window.__ENV__ 全局变量:', (window as any).__ENV__);
    console.log('  - 最终使用的后端URL:', backendUrl);
    console.log('  - 当前页面URL:', window.location.href);
  }, [backendUrl]);

  // 修改页面挂载时的滚动控制，确保不影响导航栏
  useEffect(() => {
    // 只禁用body的滚动，但保持导航栏可见
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // 自动滚动到底部
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
        // 获取搜索结果
        const searchResults = data.data.slice(0, 1);
        
        // 获取歌曲详情
        const songIds = searchResults.map((item: any) => item.id).join(',');
        const detailResponse = await fetch(`/api/netease/song/detail?ids=${songIds}`);
        const detailData = await detailResponse.json();
        
        // 创建ID到详情的映射
        const detailsMap = new Map();
        if (detailData.success && detailData.data) {
          const detail = detailData.data;
          if (detail && detail.id) {
            detailsMap.set(detail.id, detail);
          }
        }

        // 转换数据格式
        const songs = searchResults.map((item: any) => {
          const detail = detailsMap.get(item.id);
          return {
            id: item.id,
            name: item.name,
            artists: item.artists || [],
            album: item.album || '',
            duration: detail?.dt || item.duration || 0,
            picUrl: item.picUrl || '',
            videoUrl: item.videoUrl || '',
            coverUrl: detail?.al?.picUrl || '',
            addedToPlaylist: false,
            source: 'netease'
          };
        });
        
        // 为每首歌创建单独的消息
        for (let i = 0; i < songs.length; i++) {
          const botMessage: Message = {
            id: (Date.now() + i + 1).toString(),
            type: 'bot',
            content: i === 0 ? `找到以下歌曲：` : '',
            timestamp: new Date(),
            song: songs[i],
          };
          setMessages(prev => [...prev, botMessage]);
        }
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
    console.log('🎵 开始处理歌曲播放:', {
      songId: song.id,
      songName: song.name,
      artists: song.artists,
      currentTime: new Date().toISOString()
    });

    // 检查是否是当前正在播放的歌曲
    if (playerState.currentTrack && playerState.currentTrack.id === song.id) {
      console.log('⚠️ 歌曲已在播放中:', song.id);
      addToast({
        type: 'info',
        message: '播放中...',
        duration: 2000,
      });
      return;
    }

    // 检查歌曲是否正在处理中
    if (processingSongs.has(song.id)) {
      console.log('⚠️ 歌曲正在处理中:', song.id);
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
      console.log('📝 已添加到处理队列:', song.id);

      // 确保艺术家是数组格式，正确处理
      const artistStr = Array.isArray(song.artists) ? song.artists.join(', ') : (song.artists || '未知艺术家');
      console.log('👨‍🎤 艺术家信息处理:', { original: song.artists, processed: artistStr });

      // 构建HLS流地址 - 使用动态后端URL
      const hlsUrl = `${backendUrl}/streams/netease/${song.id}/playlist.m3u8`;
      const hlsPlaylistUrl = `/streams/netease/${song.id}/playlist.m3u8`;
      
      console.log('🔗 构建HLS URL:', {
        backendUrl: backendUrl,
        fullUrl: hlsUrl,
        playlistUrl: hlsPlaylistUrl,
        songId: song.id
      });

      // 检查HLS流是否可用，带重试机制
      console.log('🔍 检查HLS流可用性...');
      
      const checkStreamWithRetry = async (maxRetries = 3, retryDelay = 8888): Promise<string> => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            console.log(`🔄 第 ${attempt}/${maxRetries} 次尝试获取HLS流...`);
            console.log(`📡 请求URL: ${hlsUrl}`);
            
            // 只使用 cache: 'no-cache' 避免缓存，不设置自定义头以避免 OPTIONS 预检请求
            const streamCheck = await fetch(hlsUrl, {
              cache: 'no-cache'
            });
            
            console.log('📊 HLS流检查结果:', {
              attempt,
              requestUrl: hlsUrl,
              status: streamCheck.status,
              statusText: streamCheck.statusText,
              headers: Object.fromEntries(streamCheck.headers.entries())
            });
            
            if (streamCheck.ok) {
              const content = await streamCheck.text();
              console.log('📄 playlist.m3u8 内容长度:', content.length);
              
              if (content.length === 0) {
                console.warn(`⚠️ 第 ${attempt} 次尝试: playlist.m3u8 文件为空`);
                
                if (attempt < maxRetries) {
                  // 显示重试提示
                  addToast({
                    type: 'info',
                    message: `正在准备播放流... (${attempt}/${maxRetries})`,
                    duration: 1500,
                  });
                  
                  console.log(`⏳ 等待 ${retryDelay}ms 后重试...`);
                  await new Promise(resolve => setTimeout(resolve, retryDelay));
                  continue;
                } else {
                  throw new Error('播放列表文件为空，音频流可能还在准备中，请稍后再试');
                }
              }
              
              if (!content.includes('#EXTM3U')) {
                console.error('❌ playlist.m3u8 格式无效:', content.substring(0, 100));
                throw new Error('播放列表格式无效');
              }
              
              console.log('✅ HLS流验证成功');
              console.log('📄 playlist.m3u8 前100字符:', content.substring(0, 100));
              return content;
            } else {
              console.error(`❌ 第 ${attempt} 次尝试失败:`, streamCheck.status, streamCheck.statusText);
              
              if (attempt < maxRetries) {
                // 显示重试提示
                addToast({
                  type: 'info',
                  message: `正在准备播放流... (${attempt}/${maxRetries})`,
                  duration: 5000,
                });
                
                console.log(`⏳ 等待 ${retryDelay}ms 后重试...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
              } else {
                throw new Error(`正在处理播放流，请稍后再试 (${streamCheck.status})`);
              }
            }
          } catch (error) {
            console.error(`❌ 第 ${attempt} 次尝试出错:`, {
              requestUrl: hlsUrl,
              error: error instanceof Error ? error.message : error,
              attempt
            });
            
            if (attempt < maxRetries) {
              // 显示重试提示
              addToast({
                type: 'info',
                message: `正在准备播放流... (${attempt}/${maxRetries})`,
                duration: 1500,
              });
              
              console.log(`⏳ 等待 ${retryDelay}ms 后重试...`);
              await new Promise(resolve => setTimeout(resolve, retryDelay));
              continue;
            } else {
              throw error;
            }
          }
        }
        
        throw new Error('所有重试尝试都失败了');
      };

      // 执行带重试的流检查
      await checkStreamWithRetry();

      // 构建播放轨道数据
      const trackData = {
        id: song.id,
        neteaseId: song.id,
        title: song.name,
        artist: artistStr,
        album: song.album || '未知专辑',
        coverArtPath: song.coverUrl || song.picUrl || '',
        url: hlsUrl,
        hlsPlaylistUrl: hlsPlaylistUrl,
        position: 0,
        source: 'netease'
      };
      
      console.log('🎵 播放轨道数据:', trackData);

      // 开始播放
      console.log('▶️ 调用 playTrack...');
      playTrack(trackData);
      console.log('✅ playTrack 调用完成');

      const botMessage: Message = {
        id: Date.now().toString(),
        type: 'bot',
        content: `正在播放: ${song.name}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMessage]);
      console.log('💬 已添加播放消息到聊天');

    } catch (error: any) {
      console.error('❌ 播放失败:', {
        error: error.message,
        stack: error.stack,
        songId: song.id,
        songName: song.name,
        backendUrl: backendUrl,
        hlsUrl: `${backendUrl}/streams/netease/${song.id}/playlist.m3u8`
      });
      
      addToast({
        type: 'error',
        message: error.message || '播放失败',
        duration: 3000,
      });
      
      // 添加错误消息到聊天
      const errorMessage: Message = {
        id: Date.now().toString(),
        type: 'bot',
        content: `播放失败: ${error.message || '未知错误'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      // 从处理中集合中移除
      setProcessingSongs(prev => {
        const newSet = new Set(prev);
        newSet.delete(song.id);
        console.log('🔄 已从处理队列移除:', song.id);
        return newSet;
      });
    }
  };

  const handleAddToPlaylist = async (song: NeteaseSong) => {
    try {
        // 检查歌曲是否已经在播放列表中
        const isInPlaylist = playerState.playlist.some(track => track.id === song.id);
        
        if (isInPlaylist) {
            // 如果歌曲已在播放列表中，则移除它
            const updatedPlaylist = playerState.playlist.filter(track => track.id !== song.id);
            updatePlaylist(updatedPlaylist);
            
            addToast({
                type: 'success',
                message: '已从播放列表移除',
                duration: 2000,
            });
            return;
        }

        // 确保艺术家是数组格式，正确处理
        const artistStr = Array.isArray(song.artists) ? song.artists.join(', ') : (song.artists || '未知艺术家');

        const requestData = {
            neteaseId: song.id,
            title: song.name,
            artist: artistStr,
            album: song.album || '未知专辑',
        };
        
        console.log('Adding to playlist:', requestData);

        const response = await fetch('/api/playlist', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify(requestData),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            console.error('Server response:', errorData);
            throw new Error(errorData.error || `HTTP error ${response.status}`);
        }

        // 更新前端状态 - 添加 neteaseId 字段和更完整的封面信息
        const trackData = {
            id: song.id,
            neteaseId: song.id, // 关键：添加 neteaseId 字段
            title: song.name,
            artist: artistStr,
            album: song.album || '未知专辑',
            coverArtPath: song.coverUrl || song.picUrl || '', // 优先使用 coverUrl
            hlsPlaylistUrl: `/streams/netease/${song.id}/playlist.m3u8`,
            position: playerState.playlist.length,
        };
        
        // 添加到播放列表并立即更新状态
        const newPlaylist = [...playerState.playlist, trackData];
        updatePlaylist(newPlaylist);
        
        // 如果播放列表是隐藏的，显示它
        if (!showPlaylist) {
            setShowPlaylist(true);
        }

        addToast({
            type: 'success',
            message: '已添加到播放列表',
            duration: 2000,
        });
    } catch (error) {
        console.error('Error adding to playlist:', error);
        addToast({
            type: 'error',
            message: error instanceof Error ? error.message : '添加到播放列表失败',
            duration: 3000,
        });
    }
  };

  const handleRemoveFromPlaylist = async (song: NeteaseSong) => {
    try {
        // 检查歌曲是否在播放列表中
        const isInPlaylist = playerState.playlist.some(track => track.id === song.id);
        if (!isInPlaylist) {
            addToast({
                type: 'info',
                message: '歌曲不在播放列表中',
                duration: 2000,
            });
            return;
        }

        // 从播放列表中移除
        const updatedPlaylist = playerState.playlist.filter(track => track.id !== song.id);
        updatePlaylist(updatedPlaylist);

        // 调用后端 API 移除歌曲，使用 neteaseId
        const response = await fetch(`/api/playlist?neteaseId=${song.id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`,
            },
        });

        if (!response.ok) {
            throw new Error('从播放列表移除失败');
        }

        addToast({
            type: 'success',
            message: '已从播放列表移除',
            duration: 2000,
        });
    } catch (error) {
        console.error('Error removing from playlist:', error);
        addToast({
            type: 'error',
            message: error instanceof Error ? error.message : '从播放列表移除失败',
            duration: 3000,
        });
    }
  };

  // 格式化时长（毫秒转分:秒）
  const formatDuration = (milliseconds: number): string => {
    const seconds = Math.floor(milliseconds / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 显示所有消息，不再限制数量
  const displayMessages = messages;

  return (
    <div className="bg-cyber-bg">
      {/* 调整高度计算 - 64px导航栏 + 手机端播放栏约130px，桌面端84px */}
      <div className="h-[calc(100vh-64px-114px)] md:h-[calc(100vh-64px-84px)] grid grid-cols-12 gap-0">
        
        {/* 左侧频道栏 - 在手机端隐藏 */}
        <div className="hidden lg:flex lg:col-span-3 bg-cyber-bg-darker/50 backdrop-blur-sm border-r border-cyber-secondary/30 flex-col h-full">
          {/* 服务器信息 */}
          <div className="p-4 border-b border-cyber-secondary/30 flex-shrink-0">
            <h2 className="text-xl font-bold text-cyber-primary flex items-center">
              <Headphones className="w-6 h-6 mr-2" />
              音乐频道
            </h2>
          </div>

          {/* 频道列表 */}
          <div className="flex-1 p-3">
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
        </div>

        {/* 中间对话区域 - 手机端占满整个宽度 */}
        <div className="col-span-12 lg:col-span-6 flex flex-col h-full">
          {/* 频道标题 - 手机端优化 */}
          <div className="h-12 md:h-14 border-b border-cyber-secondary/30 flex items-center px-3 md:px-6 bg-cyber-bg-darker/30 backdrop-blur-sm flex-shrink-0">
            <Hash className="w-4 h-4 md:w-5 md:h-5 text-cyber-primary mr-2" />
            <span className="font-semibold text-cyber-text text-sm md:text-base">音乐助手</span>
            {/* 手机端显示在线用户按钮 */}
            <button 
              className="ml-auto lg:hidden text-cyber-secondary hover:text-cyber-primary transition-colors p-2 rounded-lg"
              onClick={() => setShowMobileUserList(!showMobileUserList)}
            >
              <User className="w-5 h-5" />
            </button>
          </div>

          {/* 消息显示区域 - 手机端优化间距 */}
          <div className="flex-1 relative bg-cyber-bg">
            <div className="absolute inset-0 overflow-y-auto messages-scroll-area">
              <div className="p-2 md:p-4 space-y-3 md:space-y-4">
                {displayMessages.map((message, index) => (
                  <div
                    key={message.id}
                    className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'} items-start space-x-2 md:space-x-3 animate-fade-in`}
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    {message.type === 'bot' && (
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-cyber-primary/20 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-4 h-4 md:w-6 md:h-6 text-cyber-primary" />
                      </div>
                    )}
                    
                    <div
                      className={`max-w-[85%] md:max-w-[75%] rounded-2xl p-3 md:p-4 shadow-lg ${
                        message.type === 'user'
                          ? 'bg-cyber-primary text-cyber-bg'
                          : 'bg-cyber-bg-darker/50 backdrop-blur-sm text-cyber-text border border-cyber-secondary/20'
                      }`}
                    >
                      <p className="text-xs md:text-sm mb-2">{message.content}</p>
                      
                      {message.song && (
                        <div className="mt-2 md:mt-3 p-2 md:p-3 bg-cyber-bg/50 rounded-lg border border-cyber-secondary/30">
                          <div className="flex items-center space-x-2 md:space-x-3">
                            {/* 封面 - 手机端稍小 */}
                            <div className="w-12 h-12 md:w-14 md:h-14 flex-shrink-0 rounded-lg overflow-hidden bg-cyber-bg">
                              {message.song.coverUrl || message.song.picUrl ? (
                                <img
                                  src={message.song.coverUrl || message.song.picUrl}
                                  alt={message.song.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Music2 className="h-6 w-6 md:h-7 md:w-7 text-cyber-primary" />
                                </div>
                              )}
                            </div>
                            
                            {/* 歌曲信息 - 手机端字体调整 */}
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-cyber-text truncate text-xs md:text-sm">{message.song.name}</h4>
                              <p className="text-xs text-cyber-primary truncate">
                                {Array.isArray(message.song.artists) ? message.song.artists.join(', ') : message.song.artists}
                              </p>
                              <p className="text-xs text-cyber-secondary/70 truncate">{message.song.album}</p>
                              <span className="text-xs text-cyber-secondary/70">{formatDuration(message.song.duration)}</span>
                            </div>
                            
                            {/* 操作按钮 - 手机端垂直布局 */}
                            <div className="flex flex-col space-y-1">
                              <button
                                onClick={() => handlePlay(message.song!)}
                                className="p-1.5 md:p-2 rounded-full bg-cyber-primary hover:bg-cyber-hover-primary transition-all duration-200 hover:scale-105"
                                title="播放"
                              >
                                <PlayCircle className="h-3 w-3 md:h-4 md:w-4 text-cyber-bg" />
                              </button>
                              <button
                                onClick={() => handleAddToPlaylist(message.song!)}
                                className="p-1.5 md:p-2 rounded-full bg-cyber-primary/20 hover:bg-cyber-primary/40 transition-all duration-200"
                                title="添加到播放列表"
                              >
                                <Plus className="h-3 w-3 md:h-4 md:w-4 text-cyber-primary" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      <span className="text-xs opacity-50 mt-1 md:mt-2 block">
                        {message.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    
                    {message.type === 'user' && (
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-cyber-secondary/20 flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4 md:w-6 md:h-6 text-cyber-secondary" />
                      </div>
                    )}
                  </div>
                ))}
                {/* 用于自动滚动到底部的参考元素 */}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </div>

          {/* 输入区域 - 手机端优化 */}
          <div className="h-auto p-2 md:p-4 bg-cyber-bg-darker/80 backdrop-blur-md border-t border-cyber-secondary/20 flex-shrink-0">
            <form onSubmit={handleCommand} className="w-full">
              <div className="flex items-center space-x-2 md:space-x-3 bg-cyber-bg-darker/50 backdrop-blur-md p-2 md:p-3 rounded-xl border border-cyber-secondary/30 shadow-lg">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="输入 /netease [歌曲名称]..."
                    className="w-full px-3 md:px-4 py-2 md:py-2.5 text-sm bg-transparent text-cyber-text placeholder:text-cyber-secondary/50 focus:outline-none focus:ring-2 focus:ring-cyber-primary/30 rounded-lg transition-all duration-300"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-3 md:px-5 py-2 md:py-2.5 bg-cyber-primary text-cyber-bg rounded-lg hover:bg-cyber-hover-primary hover:scale-105 active:scale-95 transition-all duration-300 disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-cyber-primary shadow-lg"
                >
                  {isLoading ? (
                    <div className="animate-spin rounded-full h-4 w-4 md:h-5 md:w-5 border-2 border-cyber-bg border-t-transparent" />
                  ) : (
                    <Send className="h-4 w-4 md:h-5 md:w-5" />
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* 右侧用户列表 - 在手机端隐藏 */}
        <div className="hidden lg:flex lg:col-span-3 bg-cyber-bg-darker/50 backdrop-blur-sm border-l border-cyber-secondary/30 p-4 h-full overflow-hidden flex-col">
          <div className="text-xs font-semibold text-cyber-secondary/70 mb-3 px-2">在线用户</div>
          <div className="space-y-2">
            <div className="flex items-center p-3 rounded-lg hover:bg-cyber-bg/50 cursor-pointer transition-colors">
              <div className="w-10 h-10 rounded-full bg-cyber-primary/20 flex items-center justify-center mr-3">
                <Bot className="w-6 h-6 text-cyber-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-cyber-text truncate">音乐助手</div>
                <div className="text-xs text-cyber-secondary/70">机器人</div>
              </div>
            </div>
            <div className="flex items-center p-3 rounded-lg hover:bg-cyber-bg/50 cursor-pointer transition-colors">
              <div className="w-10 h-10 rounded-full bg-cyber-secondary/20 flex items-center justify-center mr-3">
                <User className="w-6 h-6 text-cyber-secondary" />
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

      {/* 移动端在线用户列表弹窗 */}
      {showMobileUserList && (
        <>
          {/* 遮罩层 */}
          <div 
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setShowMobileUserList(false)}
          />
          
          {/* 右侧滑出用户列表 */}
          <div className={`fixed top-0 right-0 h-full w-80 max-w-[85vw] bg-cyber-bg-darker border-l-2 border-cyber-primary shadow-xl z-50 lg:hidden transform transition-transform duration-300 ease-in-out ${
            showMobileUserList ? 'translate-x-0' : 'translate-x-full'
          }`}>
            {/* 头部 */}
            <div className="flex items-center justify-between p-4 border-b border-cyber-secondary/30 bg-cyber-bg-darker/80 backdrop-blur-sm">
              <h3 className="text-lg font-semibold text-cyber-primary flex items-center">
                <Headphones className="w-5 h-5 mr-2" />
                在线用户
              </h3>
              <button 
                onClick={() => setShowMobileUserList(false)}
                className="text-cyber-secondary hover:text-cyber-primary transition-colors p-2 rounded-lg hover:bg-cyber-bg/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* 用户列表内容 */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                {/* 音乐助手 */}
                <div className="flex items-center p-4 rounded-xl bg-cyber-bg/30 border border-cyber-primary/20 hover:bg-cyber-bg/50 transition-all duration-200">
                  <div className="w-12 h-12 rounded-full bg-cyber-primary/20 flex items-center justify-center mr-3 border-2 border-cyber-primary/30">
                    <Bot className="w-7 h-7 text-cyber-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-cyber-text">音乐助手</div>
                    <div className="text-xs text-cyber-secondary/70">AI 机器人</div>
                  </div>
                  <div className="flex flex-col items-end">
                    <div className="w-3 h-3 bg-green-500 rounded-full shadow-lg shadow-green-500/50"></div>
                    <span className="text-xs text-green-500 mt-1">在线</span>
                  </div>
                </div>
                
                {/* 当前用户 */}
                <div className="flex items-center p-4 rounded-xl bg-cyber-bg/30 border border-cyber-secondary/20 hover:bg-cyber-bg/50 transition-all duration-200">
                  <div className="w-12 h-12 rounded-full bg-cyber-secondary/20 flex items-center justify-center mr-3 border-2 border-cyber-secondary/30">
                    <User className="w-7 h-7 text-cyber-secondary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-cyber-text truncate">
                      {currentUser?.username || '游客'}
                    </div>
                    <div className="text-xs text-cyber-secondary/70">用户</div>
                  </div>
                  <div className="flex flex-col items-end">
                    <div className="w-3 h-3 bg-green-500 rounded-full shadow-lg shadow-green-500/50"></div>
                    <span className="text-xs text-green-500 mt-1">在线</span>
                  </div>
                </div>
                
                {/* 频道信息 */}
                <div className="mt-6 p-4 rounded-xl bg-cyber-primary/5 border border-cyber-primary/20">
                  <div className="text-xs font-semibold text-cyber-primary mb-2 flex items-center">
                    <Hash className="w-4 h-4 mr-1" />
                    频道信息
                  </div>
                  <div className="space-y-2 text-xs text-cyber-secondary/70">
                    <div className="flex justify-between">
                      <span>在线用户:</span>
                      <span className="text-cyber-primary font-medium">2</span>
                    </div>
                    <div className="flex justify-between">
                      <span>活跃频道:</span>
                      <span className="text-cyber-primary font-medium">音乐助手</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default BotView;