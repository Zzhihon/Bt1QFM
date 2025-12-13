import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRoom } from '../../contexts/RoomContext';
import { useAuth } from '../../contexts/AuthContext';
import { Send, User } from 'lucide-react';

interface ChatMessage {
  id: number;
  userId: number;
  username: string;
  content: string;
  timestamp: number;
  type: 'chat' | 'system';
}

const RoomChat: React.FC = () => {
  const { currentUser, authToken } = useAuth();
  const { sendMessage, isConnected, currentRoom } = useRoom();
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
              messageType: string
            }) => ({
              id: msg.id,
              userId: msg.userId,
              username: msg.username || '未知用户',
              content: msg.content,
              timestamp: new Date(msg.createdAt).getTime(),
              type: msg.messageType === 'system' ? 'system' : 'chat',
            }));
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
      // 过滤掉自己发送的消息（已通过乐观更新显示）
      if (newMessage.userId === currentUser?.id) {
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
  const handleSend = () => {
    if (!inputValue.trim() || !isConnected) return;

    const content = inputValue.trim();
    setInputValue('');

    // 发送到服务器
    sendMessage(content);

    // 本地显示（乐观更新）
    const localMessage: ChatMessage = {
      id: Date.now(),
      userId: currentUser?.id as number,
      username: currentUser?.username || '我',
      content,
      timestamp: Date.now(),
      type: 'chat',
    };
    setMessages((prev) => [...prev, localMessage]);
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

  return (
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-cyber-secondary/50">
            <User className="w-12 h-12 mb-2" />
            <p className="text-sm">还没有消息，发一条吧～</p>
          </div>
        )}

        {messages.map((msg) => {
          const isMe = msg.userId === currentUser?.id;
          const isSystem = msg.type === 'system';

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
              <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[70%]`}>
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
              placeholder="发送消息..."
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
