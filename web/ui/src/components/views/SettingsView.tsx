import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { UserCircle, Mail, Phone, CalendarDays, Palette, Moon, Sun, Monitor } from 'lucide-react';

interface Theme {
  name: string;
  className: string;
  colors: {
    'cyber-bg': string;
    'cyber-bg-darker': string;
    'cyber-text': string;
    'cyber-primary': string;
    'cyber-secondary': string;
    'cyber-hover-primary': string;
    'cyber-hover-secondary': string;
  };
}

const themes: Theme[] = [
  {
    name: '赛博朋克',
    className: 'theme-cyberpunk',
    colors: {
      'cyber-bg': '#0A0F37',
      'cyber-bg-darker': '#05081E',
      'cyber-text': '#F0F0F0',
      'cyber-primary': '#FF00D6',
      'cyber-secondary': '#372963',
      'cyber-hover-primary': '#E000E0',
      'cyber-hover-secondary': '#00E0E0',
    }
  },
  {
    name: '极简主义',
    className: 'theme-minimal',
    colors: {
      'cyber-bg': '#FFFFFF',
      'cyber-bg-darker': '#F5F5F5',
      'cyber-text': '#333333',
      'cyber-primary': '#2563EB',
      'cyber-secondary': '#64748B',
      'cyber-hover-primary': '#1D4ED8',
      'cyber-hover-secondary': '#475569',
    }
  },
  {
    name: '暗夜模式',
    className: 'theme-dark',
    colors: {
      'cyber-bg': '#1A1A1A',
      'cyber-bg-darker': '#000000',
      'cyber-text': '#E5E5E5',
      'cyber-primary': '#10B981',
      'cyber-secondary': '#4B5563',
      'cyber-hover-primary': '#059669',
      'cyber-hover-secondary': '#374151',
    }
  },
  {
    name: '复古风格',
    className: 'theme-retro',
    colors: {
      'cyber-bg': '#2C1810',
      'cyber-bg-darker': '#1A0F0A',
      'cyber-text': '#F5E6D3',
      'cyber-primary': '#D4AF37',
      'cyber-secondary': '#8B4513',
      'cyber-hover-primary': '#B8860B',
      'cyber-hover-secondary': '#654321',
    }
  }
];

// 初始化主题
const initializeTheme = () => {
  const savedTheme = localStorage.getItem('selectedTheme');
  // 默认使用极简主题，避免首次进入时切换为赛博朋克
  const defaultTheme = themes.find((t) => t.className === 'theme-minimal')!;
  const theme = savedTheme ? JSON.parse(savedTheme) : defaultTheme;
  applyTheme(theme);
  return theme;
};

// 应用主题
const applyTheme = (theme: Theme) => {
  const root = document.documentElement;
  
  // 移除所有主题类
  themes.forEach(t => root.classList.remove(t.className));
  
  // 添加新主题类
  root.classList.add(theme.className);
  
  // 设置 CSS 变量
  Object.entries(theme.colors).forEach(([key, value]) => {
    root.style.setProperty(`--${key}`, value);
  });
  
  // 保存主题设置
  localStorage.setItem('selectedTheme', JSON.stringify(theme));
};

const SettingsView: React.FC = () => {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'theme'>('profile');
  const [selectedTheme, setSelectedTheme] = useState<Theme>(initializeTheme);

  const getStringValue = (value: any): string => {
    if (value === null || value === undefined) return 'N/A';
    if (typeof value === 'object' && 'String' in value) {
      return value.String || 'N/A';
    }
    return String(value);
  };

  const formatDate = (dateString: string): string => {
    if (!dateString || dateString === 'N/A') return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const handleThemeChange = (theme: Theme) => {
    setSelectedTheme(theme);
    applyTheme(theme);
  };

  return (
    <div className="min-h-[calc(100vh-150px)] flex flex-col items-center justify-center bg-cyber-bg p-4">
      <div className="w-full max-w-4xl p-8 space-y-6 bg-cyber-bg-darker shadow-2xl rounded-lg border-2 border-cyber-primary">
        <div className="flex space-x-4 mb-8">
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-4 py-2 rounded-md transition-colors duration-300 ${
              activeTab === 'profile'
                ? 'bg-cyber-primary text-cyber-bg-darker'
                : 'text-cyber-text hover:bg-cyber-bg'
            }`}
          >
            <UserCircle className="inline-block mr-2" />
            个人档案
          </button>
          <button
            onClick={() => setActiveTab('theme')}
            className={`px-4 py-2 rounded-md transition-colors duration-300 ${
              activeTab === 'theme'
                ? 'bg-cyber-primary text-cyber-bg-darker'
                : 'text-cyber-text hover:bg-cyber-bg'
            }`}
          >
            <Palette className="inline-block mr-2" />
            界面样式
          </button>
        </div>

        {activeTab === 'profile' ? (
          <div className="space-y-4 text-cyber-text">
            <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
              <UserCircle className="h-6 w-6 text-cyber-secondary" />
              <p><strong className="text-cyber-accent">用户名:</strong> {getStringValue(currentUser?.username)}</p>
            </div>
            <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
              <Mail className="h-6 w-6 text-cyber-secondary" />
              <p><strong className="text-cyber-accent">邮箱:</strong> {getStringValue(currentUser?.email)}</p>
            </div>
            <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
              <Phone className="h-6 w-6 text-cyber-secondary" />
              <p><strong className="text-cyber-accent">电话:</strong> {getStringValue(currentUser?.phone)}</p>
            </div>
            <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
              <CalendarDays className="h-6 w-6 text-cyber-secondary" />
              <p><strong className="text-cyber-accent">注册时间:</strong> {formatDate(getStringValue(currentUser?.createdAt))}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {themes.map((theme) => (
              <div
                key={theme.name}
                className={`p-4 rounded-lg cursor-pointer transition-all duration-300 ${
                  selectedTheme.name === theme.name
                    ? 'border-2 border-cyber-primary bg-cyber-bg'
                    : 'border border-cyber-secondary hover:border-cyber-primary'
                }`}
                onClick={() => handleThemeChange(theme)}
              >
                <h3 className="text-lg font-semibold mb-2 text-cyber-text">{theme.name}</h3>
                <div className="flex space-x-2">
                  {Object.entries(theme.colors).map(([key, value]) => (
                    <div
                      key={key}
                      className="w-6 h-6 rounded-full"
                      style={{ backgroundColor: value }}
                      title={`${key}: ${value}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsView; 