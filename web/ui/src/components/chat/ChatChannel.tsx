import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Bot, User, Send, Trash2, Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import SongCard, { SongCardData } from '../common/SongCard';

interface ChatMessage {
  id: number;
  sessionId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  songs?: SongCardData[]; // AI 推荐的歌曲
}

interface ChatSession {
  id: number;
  userId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface WebSocketMessage {
  type: 'start' | 'content' | 'end' | 'error' | 'slow' | 'timeout' | 'songs';
  content: string;
  songs?: SongCardData[];
}

// 获取后端 URL
const getBackendUrl = () => {
  if (typeof window !== 'undefined' && (window as any).__ENV__?.BACKEND_URL) {
    return (window as any).__ENV__.BACKEND_URL;
  }
  return import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';
};

// 获取WebSocket URL
const getWebSocketUrl = () => {
  const backendUrl = getBackendUrl();
  const wsProtocol = backendUrl.startsWith('https') ? 'wss' : 'ws';
  const wsHost = backendUrl.replace(/^https?:\/\//, '');
  return `${wsProtocol}://${wsHost}`;
};

interface ChatChannelProps {
  className?: string;
}

const ChatChannel: React.FC<ChatChannelProps> = ({ className = '' }) => {
  const { authToken, currentUser } = useAuth();
  const { addToast } = useToast();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [slowHint, setSlowHint] = useState('');      // 慢响应提示
  const [showRetry, setShowRetry] = useState(false); // 显示重试按钮
  const [lastMessage, setLastMessage] = useState(''); // 保存最后发送的消息用于重试
  const [pendingSongs, setPendingSongs] = useState<SongCardData[]>([]); // 待附加到消息的歌曲

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectingRef = useRef(false); // 防止重复连接

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // 加载聊天历史
  const loadChatHistory = useCallback(async () => {
    if (!authToken) return;

    try {
      const response = await fetch(`${getBackendUrl()}/api/chat/history`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.messages) {
          setMessages(data.messages);
        }
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
    }
  }, [authToken]);

  // 用 ref 保存累积的流式内容，避免闭包问题
  const streamingContentRef = useRef('');

  // 连接WebSocket
  const connectWebSocket = useCallback(() => {
    // 防止重复连接
    if (!authToken) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;
    if (isConnectingRef.current) return;

    isConnectingRef.current = true;
    const wsUrl = `${getWebSocketUrl()}/ws/chat?token=${authToken}`;
    console.log('Connecting to WebSocket:', wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      isConnectingRef.current = false;
      setIsConnected(true);
      addToast({
        type: 'success',
        message: '已连接到聊天助手',
        duration: 2000,
      });
    };

    ws.onmessage = (event) => {
      try {
        const msg: WebSocketMessage = JSON.parse(event.data);

        switch (msg.type) {
          case 'start':
            setIsStreaming(true);
            setStreamingContent('');
            streamingContentRef.current = '';
            setSlowHint('');      // 清除慢响应提示
            setShowRetry(false);  // 隐藏重试按钮
            setPendingSongs([]);  // 清除待附加的歌曲
            break;
          case 'content':
            setSlowHint('');      // 收到内容后清除慢响应提示
            setShowRetry(false);  // 隐藏重试按钮
            streamingContentRef.current += msg.content;
            setStreamingContent(streamingContentRef.current);
            break;
          case 'songs':
            // 收到歌曲卡片，暂存等待 end 消息
            if (msg.songs && msg.songs.length > 0) {
              setPendingSongs(msg.songs);
            }
            break;
          case 'end':
            // 将流式内容添加到消息列表（包含歌曲）
            const finalContent = streamingContentRef.current + (msg.content || '');
            setPendingSongs(currentSongs => {
              setMessages(prev => [...prev, {
                id: Date.now(),
                sessionId: 0,
                role: 'assistant',
                content: finalContent,
                createdAt: new Date().toISOString(),
                songs: currentSongs.length > 0 ? currentSongs : undefined,
              }]);
              return [];
            });
            setStreamingContent('');
            streamingContentRef.current = '';
            setIsStreaming(false);
            setIsLoading(false);
            setSlowHint('');
            setShowRetry(false);
            break;
          case 'slow':
            // 软超时：显示提示但继续等待
            setSlowHint(msg.content || 'AI正在思考中，请稍候...');
            break;
          case 'timeout':
            // 硬超时：显示重试按钮
            setSlowHint(msg.content || '响应时间较长');
            setShowRetry(true);
            break;
          case 'error':
            addToast({
              type: 'error',
              message: msg.content || '发生错误',
              duration: 4000,
            });
            setIsStreaming(false);
            setIsLoading(false);
            setSlowHint('');
            setShowRetry(false);
            break;
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      isConnectingRef.current = false;
      setIsConnected(false);
      wsRef.current = null;

      // 尝试重连，只有在有 authToken 且不在连接中时才重连
      if (authToken && !isConnectingRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('Attempting to reconnect...');
          connectWebSocket();
        }, 3000);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      isConnectingRef.current = false;
      setIsConnected(false);
    };
  }, [authToken, addToast]);

  // 初始化 - 只在 authToken 变化时执行一次
  useEffect(() => {
    if (authToken) {
      loadChatHistory();
      connectWebSocket();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      isConnectingRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  // 发送消息
  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || !wsRef.current || isLoading) return;

    const content = inputValue.trim();
    setInputValue('');
    setIsLoading(true);
    setLastMessage(content); // 保存消息用于重试
    setSlowHint('');
    setShowRetry(false);

    // 添加用户消息到列表
    const userMessage: ChatMessage = {
      id: Date.now(),
      sessionId: 0,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMessage]);

    // 通过WebSocket发送消息
    if (wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ content }));
    } else {
      addToast({
        type: 'error',
        message: '连接已断开，请稍后重试',
        duration: 3000,
      });
      setIsLoading(false);
    }
  }, [inputValue, isLoading, addToast]);

  // 重试发送
  const handleRetry = useCallback(() => {
    if (!lastMessage || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addToast({
        type: 'error',
        message: '无法重试，请重新发送消息',
        duration: 3000,
      });
      return;
    }

    setSlowHint('');
    setShowRetry(false);
    setIsLoading(true);
    setStreamingContent('');
    streamingContentRef.current = '';

    // 重新发送最后的消息
    wsRef.current.send(JSON.stringify({ content: lastMessage }));
  }, [lastMessage, addToast]);

  // 清除聊天历史
  const handleClearHistory = async () => {
    if (!authToken) return;

    try {
      const response = await fetch(`${getBackendUrl()}/api/chat/clear`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (response.ok) {
        setMessages([]);
        addToast({
          type: 'success',
          message: '聊天记录已清除',
          duration: 2000,
        });
      }
    } catch (error) {
      console.error('Failed to clear chat history:', error);
      addToast({
        type: 'error',
        message: '清除失败',
        duration: 3000,
      });
    }
  };

  // 处理回车发送
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 格式化时间
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 消息显示区域 */}
      <div className="flex-1 relative bg-cyber-bg">
        <div className="absolute inset-0 overflow-y-auto messages-scroll-area">
          <div className="p-2 md:p-4 space-y-3 md:space-y-4">
            {/* 欢迎消息 */}
            {messages.length === 0 && !isStreaming && (
              <div className="flex justify-center items-center h-full min-h-[200px]">
                <div className="text-center p-6 rounded-2xl bg-cyber-bg-darker/30 border border-cyber-secondary/20">
                  <MessageSquare className="w-12 h-12 text-cyber-primary mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-cyber-text mb-2">你好！我是小Q 🎵</h3>
                  <p className="text-sm text-cyber-secondary/70 max-w-md">
                    我是1QFM的AI音乐助手，可以和你聊聊音乐、推荐歌曲、分享音乐故事。
                    <br />
                    有什么想聊的吗？
                  </p>
                </div>
              </div>
            )}

            {/* 消息列表 */}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} items-start space-x-2 md:space-x-3 animate-fade-in`}
              >
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-cyber-primary/20 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 md:w-6 md:h-6 text-cyber-primary" />
                  </div>
                )}

                <div
                  className={`max-w-[90%] md:max-w-[80%] rounded-2xl p-3 md:p-4 shadow-lg ${
                    message.role === 'user'
                      ? 'bg-cyber-primary text-cyber-bg'
                      : 'bg-cyber-bg-darker/50 backdrop-blur-sm text-cyber-text border border-cyber-secondary/20'
                  }`}
                >
                  <p className="text-xs md:text-sm whitespace-pre-wrap">{message.content}</p>
                  {/* 歌曲卡片 */}
                  {message.songs && message.songs.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {message.songs.map((song) => (
                        <SongCard key={song.id} song={song} compact />
                      ))}
                    </div>
                  )}
                  <span className="text-xs opacity-50 mt-1 md:mt-2 block">
                    {formatTime(message.createdAt)}
                  </span>
                </div>

                {message.role === 'user' && (
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-cyber-secondary/20 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 md:w-6 md:h-6 text-cyber-secondary" />
                  </div>
                )}
              </div>
            ))}

            {/* 流式输出显示 */}
            {isStreaming && streamingContent && (
              <div className="flex justify-start items-start space-x-2 md:space-x-3 animate-fade-in">
                <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-cyber-primary/20 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 md:w-6 md:h-6 text-cyber-primary" />
                </div>
                <div className="max-w-[90%] md:max-w-[80%] rounded-2xl p-3 md:p-4 shadow-lg bg-cyber-bg-darker/50 backdrop-blur-sm text-cyber-text border border-cyber-secondary/20">
                  <p className="text-xs md:text-sm whitespace-pre-wrap">{streamingContent}</p>
                  <span className="inline-block w-2 h-4 bg-cyber-primary animate-pulse ml-1" />
                </div>
              </div>
            )}

            {/* 加载中指示器 - 包含慢响应提示和重试按钮 */}
            {isLoading && !isStreaming && (
              <div className="flex justify-start items-start space-x-2 md:space-x-3">
                <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-cyber-primary/20 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 md:w-6 md:h-6 text-cyber-primary" />
                </div>
                <div className="rounded-2xl p-3 md:p-4 bg-cyber-bg-darker/50 backdrop-blur-sm border border-cyber-secondary/20">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-5 h-5 text-cyber-primary animate-spin" />
                    {slowHint && (
                      <span className="text-xs text-cyber-secondary/70">{slowHint}</span>
                    )}
                  </div>
                  {showRetry && (
                    <button
                      onClick={handleRetry}
                      className="mt-2 flex items-center space-x-1 px-3 py-1.5 text-xs bg-cyber-primary/20 hover:bg-cyber-primary/30 text-cyber-primary rounded-md transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>重试</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {/* 输入区域 */}
      <div className="h-auto p-2 md:p-3 bg-cyber-bg-darker/60 backdrop-blur-md border-t border-cyber-secondary/20 flex-shrink-0">
        <div className="px-2 md:px-4">
          <div className="flex items-center space-x-2">
            {/* 清除历史按钮 */}
            <button
              onClick={handleClearHistory}
              className="p-2 rounded-lg hover:bg-cyber-secondary/20 transition-colors text-cyber-secondary hover:text-cyber-primary"
              title="清除聊天记录"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            {/* 输入框 */}
            <div className="flex-1 flex items-center space-x-2 bg-cyber-bg-darker/40 backdrop-blur-sm p-1.5 md:p-2 rounded-lg border border-cyber-secondary/20 shadow-sm">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="和小Q聊聊音乐吧..."
                className="flex-1 px-2.5 md:px-3 py-1.5 md:py-2 text-sm bg-transparent text-cyber-text placeholder:text-cyber-secondary/50 focus:outline-none resize-none max-h-24"
                rows={1}
                disabled={isLoading}
              />
              <button
                onClick={handleSendMessage}
                disabled={isLoading || !inputValue.trim()}
                className="px-2.5 md:px-3 py-1.5 md:py-2 bg-cyber-primary text-cyber-bg rounded-md hover:bg-cyber-hover-primary hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-cyber-primary shadow-sm"
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 md:h-4 md:w-4 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5 md:h-4 md:w-4" />
                )}
              </button>
            </div>

            {/* 连接状态指示 */}
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} title={isConnected ? '已连接' : '未连接'} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatChannel;
