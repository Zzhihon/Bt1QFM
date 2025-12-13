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
  const { currentUser } = useAuth();
  const { sendMessage, isConnected } = useRoom();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

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
              className={`flex ${isMe ? 'justify-end' : 'justify-start'} items-end space-x-2`}
            >
              {!isMe && (
                <div className="w-8 h-8 rounded-full bg-cyber-secondary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-medium text-cyber-secondary">
                    {msg.username.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}

              <div
                className={`max-w-[75%] rounded-2xl p-3 ${
                  isMe
                    ? 'bg-cyber-primary text-cyber-bg'
                    : 'bg-cyber-bg-darker/50 text-cyber-text border border-cyber-secondary/20'
                }`}
              >
                {!isMe && (
                  <p className="text-xs text-cyber-secondary/70 mb-1">{msg.username}</p>
                )}
                <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                <span className={`text-xs mt-1 block ${isMe ? 'opacity-70' : 'text-cyber-secondary/50'}`}>
                  {formatTime(msg.timestamp)}
                </span>
              </div>

              {isMe && (
                <div className="w-8 h-8 rounded-full bg-cyber-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-medium text-cyber-primary">
                    {currentUser?.username?.charAt(0).toUpperCase() || 'U'}
                  </span>
                </div>
              )}
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="p-3 bg-cyber-bg-darker/60 backdrop-blur-md border-t border-cyber-secondary/20">
        <div className="flex items-center space-x-2">
          <div className="flex-1 flex items-center bg-cyber-bg-darker/40 rounded-lg border border-cyber-secondary/20">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="发送消息..."
              className="flex-1 px-3 py-2 text-sm bg-transparent text-cyber-text placeholder:text-cyber-secondary/50 focus:outline-none resize-none max-h-24"
              rows={1}
              disabled={!isConnected}
            />
            <button
              onClick={handleSend}
              disabled={!inputValue.trim() || !isConnected}
              className="px-3 py-2 text-cyber-primary hover:text-cyber-hover-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>

        {!isConnected && (
          <p className="text-xs text-red-400 mt-2 text-center">连接已断开，正在重连...</p>
        )}
      </div>
    </div>
  );
};

export default RoomChat;
