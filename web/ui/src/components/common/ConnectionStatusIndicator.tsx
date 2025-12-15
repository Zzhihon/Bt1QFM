import React, { useEffect, useState } from 'react';
import { useRoom } from '../../contexts/RoomContext';
import {
  Wifi,
  WifiOff,
  Loader2,
  AlertTriangle,
  RefreshCw,
  X,
} from 'lucide-react';

interface ConnectionStatusIndicatorProps {
  /** 是否显示详细信息 */
  detailed?: boolean;
  /** 是否在连接正常时隐藏 */
  hideWhenConnected?: boolean;
  /** 自定义样式类名 */
  className?: string;
}

/**
 * 连接状态指示器组件
 * 显示 WebSocket 连接状态、断线原因和重连进度
 */
const ConnectionStatusIndicator: React.FC<ConnectionStatusIndicatorProps> = ({
  detailed = false,
  hideWhenConnected = false,
  className = '',
}) => {
  const {
    connectionStatus,
    disconnectReason,
    reconnectAttempt,
    reconnectCountdown,
    error,
    lastHeartbeat,
  } = useRoom();

  const [dismissed, setDismissed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // 当状态变化时，重新显示指示器
  useEffect(() => {
    if (connectionStatus !== 'connected') {
      setDismissed(false);
    }
  }, [connectionStatus]);

  // 如果连接正常且设置了隐藏，则不显示
  if (hideWhenConnected && connectionStatus === 'connected') {
    return null;
  }

  // 如果用户关闭了提示且连接正常，不显示
  if (dismissed && connectionStatus === 'connected') {
    return null;
  }

  // 获取状态配置
  const getStatusConfig = () => {
    switch (connectionStatus) {
      case 'connected':
        return {
          icon: <Wifi className="w-4 h-4" />,
          bgColor: 'bg-green-500/20',
          textColor: 'text-green-400',
          borderColor: 'border-green-500/30',
          label: '已连接',
          description: '连接正常',
        };
      case 'connecting':
        return {
          icon: <Loader2 className="w-4 h-4 animate-spin" />,
          bgColor: 'bg-blue-500/20',
          textColor: 'text-blue-400',
          borderColor: 'border-blue-500/30',
          label: '连接中',
          description: '正在建立连接...',
        };
      case 'reconnecting':
        return {
          icon: <RefreshCw className="w-4 h-4 animate-spin" />,
          bgColor: 'bg-yellow-500/20',
          textColor: 'text-yellow-400',
          borderColor: 'border-yellow-500/30',
          label: '重连中',
          description: reconnectCountdown
            ? `${reconnectCountdown}秒后重试 (${reconnectAttempt}/10)`
            : `第${reconnectAttempt}次重连...`,
        };
      case 'disconnected':
        return {
          icon: <WifiOff className="w-4 h-4" />,
          bgColor: 'bg-red-500/20',
          textColor: 'text-red-400',
          borderColor: 'border-red-500/30',
          label: '已断开',
          description: getDisconnectReasonText(),
        };
      case 'failed':
        return {
          icon: <AlertTriangle className="w-4 h-4" />,
          bgColor: 'bg-red-500/20',
          textColor: 'text-red-400',
          borderColor: 'border-red-500/30',
          label: '连接失败',
          description: '请刷新页面重试',
        };
      default:
        return {
          icon: <WifiOff className="w-4 h-4" />,
          bgColor: 'bg-gray-500/20',
          textColor: 'text-gray-400',
          borderColor: 'border-gray-500/30',
          label: '未知状态',
          description: '',
        };
    }
  };

  // 获取断线原因文本
  const getDisconnectReasonText = () => {
    switch (disconnectReason) {
      case 'heartbeat_timeout':
        return '心跳超时，连接已断开';
      case 'replaced_by_new_connection':
        return '您在其他地方登录';
      case 'network_error':
        return '网络连接异常';
      case 'server_error':
        return '服务器错误';
      case 'manual_disconnect':
        return '已主动断开';
      case 'page_hidden':
        return '页面不可见';
      default:
        return error || '连接已断开';
    }
  };

  const config = getStatusConfig();

  // 简洁模式：仅图标
  if (!detailed) {
    return (
      <div
        className={`relative ${className}`}
        onMouseEnter={() => setShowDetails(true)}
        onMouseLeave={() => setShowDetails(false)}
      >
        <div
          className={`p-1.5 rounded-full ${config.bgColor} ${config.textColor} cursor-pointer transition-all`}
          title={`${config.label}: ${config.description}`}
        >
          {config.icon}
        </div>

        {/* 悬浮详情 */}
        {showDetails && connectionStatus !== 'connected' && (
          <div
            className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50
              min-w-48 p-3 rounded-lg border ${config.bgColor} ${config.borderColor}
              backdrop-blur-sm shadow-lg`}
          >
            <div className="flex items-center space-x-2 mb-1">
              {config.icon}
              <span className={`font-medium ${config.textColor}`}>{config.label}</span>
            </div>
            <p className="text-xs text-cyber-secondary/80">{config.description}</p>
            {lastHeartbeat && (
              <p className="text-xs text-cyber-secondary/60 mt-1">
                最后心跳: {new Date(lastHeartbeat).toLocaleTimeString()}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // 详细模式：完整横幅
  return (
    <div
      className={`flex items-center justify-between px-3 py-2 rounded-lg border
        ${config.bgColor} ${config.borderColor} ${className}`}
    >
      <div className="flex items-center space-x-3">
        <div className={`${config.textColor}`}>{config.icon}</div>
        <div>
          <div className={`text-sm font-medium ${config.textColor}`}>
            {config.label}
          </div>
          <div className="text-xs text-cyber-secondary/70">{config.description}</div>
        </div>
      </div>

      {/* 重连进度条 */}
      {connectionStatus === 'reconnecting' && reconnectCountdown && (
        <div className="flex-shrink-0 ml-4">
          <div className="w-16 h-1.5 bg-cyber-secondary/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-yellow-400 transition-all duration-1000 ease-linear"
              style={{
                width: `${(reconnectCountdown / 30) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* 关闭按钮（仅连接正常时可关闭） */}
      {connectionStatus === 'connected' && (
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded hover:bg-cyber-secondary/20 transition-colors ml-2"
        >
          <X className="w-4 h-4 text-cyber-secondary/70" />
        </button>
      )}
    </div>
  );
};

export default ConnectionStatusIndicator;
