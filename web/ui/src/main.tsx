import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { AuthProvider } from './contexts/AuthContext.tsx';
import { PlayerProvider } from './contexts/PlayerContext.tsx';
import { ToastProvider } from './contexts/ToastContext.tsx';
import { RoomProvider } from './contexts/RoomContext.tsx';

// 初始化主题
const initializeTheme = () => {
  const savedTheme = localStorage.getItem('selectedTheme');
  const root = document.documentElement;

  // 移除所有主题类
  root.classList.remove('theme-cyberpunk', 'theme-minimal', 'theme-dark', 'theme-retro');

  if (savedTheme) {
    const theme = JSON.parse(savedTheme);

    // 添加存储的主题类
    root.classList.add(theme.className);

    // 设置 CSS 变量
    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(`--${key}`, value);
    });
  } else {
    // 默认使用极简主题
    root.classList.add('theme-minimal');
  }
};

// 在应用启动时初始化主题
initializeTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <ToastProvider>
        <PlayerProvider>
          <RoomProvider>
            <App />
          </RoomProvider>
        </PlayerProvider>
      </ToastProvider>
    </AuthProvider>
  </React.StrictMode>,
) 