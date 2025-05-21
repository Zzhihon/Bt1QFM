import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number; // 自动消失的时间（毫秒）
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (message: string, type?: Toast['type'], duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info', duration = 3000) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type, duration }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

// Toast容器组件
const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToast();

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
};

// 单个Toast组件
const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    if (toast.duration) {
      const timer = setTimeout(() => {
        onDismiss(toast.id);
      }, toast.duration);

      return () => clearTimeout(timer);
    }
  }, [toast, onDismiss]);

  // 根据类型确定颜色样式
  const getTypeStyles = () => {
    switch (toast.type) {
      case 'success':
        return 'bg-cyber-green text-black';
      case 'error':
        return 'bg-cyber-red text-white';
      case 'warning':
        return 'bg-yellow-500 text-black';
      case 'info':
      default:
        return 'bg-cyber-primary text-cyber-bg-darker';
    }
  };

  // 获取边框颜色
  const getBorderColor = () => {
    switch (toast.type) {
      case 'success':
        return 'rgb(0, 255, 0)';
      case 'error':
        return 'rgb(255, 0, 0)';
      case 'warning':
        return 'rgb(255, 193, 7)';
      case 'info':
      default:
        return 'rgb(255, 0, 214)';
    }
  };

  return (
    <div 
      className={`min-w-[300px] max-w-md p-3 rounded-md shadow-xl flex items-center justify-between toast-item ${getTypeStyles()} border`}
      style={{ borderColor: getBorderColor() }}
    >
      <div className="mr-3">{toast.message}</div>
      <button 
        onClick={() => onDismiss(toast.id)} 
        className="p-1 rounded-full hover:bg-black hover:bg-opacity-20 transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}; 