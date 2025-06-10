import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { UserCircle, Mail, Phone, CalendarDays, Palette, Moon, Sun, Monitor, ExternalLink, Music, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'profile' | 'theme'>('profile');
  const [selectedTheme, setSelectedTheme] = useState<Theme>(initializeTheme);
  const [profileData, setProfileData] = useState<any>(null);

  // 获取用户完整资料信息
  const fetchUserProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await fetch('/api/user/profile', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          setProfileData(result.data);
        }
      }
    } catch (error) {
      console.error('获取用户资料失败:', error);
    }
  };

  useEffect(() => {
    if (currentUser && activeTab === 'profile') {
      fetchUserProfile();
    }
  }, [currentUser, activeTab]);

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
          <div className="space-y-6">
            {/* 添加跳转按钮 */}
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-semibold text-cyber-primary">个人信息预览</h3>
              <button
                onClick={() => navigate('/profile')}
                className="flex items-center px-4 py-2 bg-cyber-primary text-cyber-bg-darker rounded-lg hover:bg-cyber-hover-primary transition-colors font-medium shadow-lg"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                查看完整档案
              </button>
            </div>

            {/* 基本信息 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 用户基本信息卡片 */}
              <div className="bg-cyber-bg p-4 rounded-lg border border-cyber-secondary/30">
                <h4 className="text-lg font-medium text-cyber-accent mb-4 flex items-center">
                  <UserCircle className="h-5 w-5 mr-2" />
                  基本信息
                </h4>
                <div className="space-y-3">
                  <div className="flex items-center space-x-3 p-2 bg-cyber-bg-darker rounded-md">
                    <UserCircle className="h-5 w-5 text-cyber-secondary" />
                    <div className="flex-1">
                      <span className="text-cyber-accent text-sm">用户名:</span>
                      <span className="ml-2 text-cyber-text">{getStringValue(profileData?.username || currentUser?.username)}</span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 p-2 bg-cyber-bg-darker rounded-md">
                    <Mail className="h-5 w-5 text-cyber-secondary" />
                    <div className="flex-1">
                      <span className="text-cyber-accent text-sm">邮箱:</span>
                      <span className="ml-2 text-cyber-text">{getStringValue(profileData?.email || currentUser?.email)}</span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 p-2 bg-cyber-bg-darker rounded-md">
                    <Phone className="h-5 w-5 text-cyber-secondary" />
                    <div className="flex-1">
                      <span className="text-cyber-accent text-sm">电话:</span>
                      <span className="ml-2 text-cyber-text">{getStringValue(profileData?.phone || currentUser?.phone)}</span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 p-2 bg-cyber-bg-darker rounded-md">
                    <CalendarDays className="h-5 w-5 text-cyber-secondary" />
                    <div className="flex-1">
                      <span className="text-cyber-accent text-sm">注册时间:</span>
                      <span className="ml-2 text-cyber-text">{formatDate(getStringValue(profileData?.createdAt || currentUser?.createdAt))}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 网易云音乐信息卡片 */}
              <div className="bg-cyber-bg p-4 rounded-lg border border-cyber-secondary/30">
                <h4 className="text-lg font-medium text-cyber-accent mb-4 flex items-center">
                  <Music className="h-5 w-5 mr-2" />
                  网易云音乐
                </h4>
                <div className="space-y-3">
                  <div className="p-3 bg-cyber-bg-darker rounded-md">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-cyber-accent text-sm">用户名:</span>
                      {profileData?.neteaseUsername && (
                        <div className="flex items-center text-xs text-green-400">
                          <Check className="h-3 w-3 mr-1" />
                          已绑定
                        </div>
                      )}
                    </div>
                    <div className="text-cyber-text">
                      {profileData?.neteaseUsername || '未设置'}
                    </div>
                  </div>
                  
                  <div className="p-3 bg-cyber-bg-darker rounded-md">
                    <div className="mb-2">
                      <span className="text-cyber-accent text-sm">UID:</span>
                    </div>
                    <div className="text-cyber-text">
                      {profileData?.neteaseUID || '未设置'}
                    </div>
                  </div>

                  {profileData?.neteaseUsername ? (
                    <div className="bg-gradient-to-r from-green-900/30 to-green-800/30 p-3 rounded-md border border-green-500/30">
                      <div className="text-sm text-green-300 flex items-center">
                        <Check className="h-4 w-4 mr-2" />
                        网易云账号已绑定，可以在收藏页面查看您的歌单
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gradient-to-r from-cyber-primary/10 to-cyber-accent/10 p-3 rounded-md border border-cyber-primary/20">
                      <div className="text-sm text-cyber-text">
                        <p>还未绑定网易云账号</p>
                        <p className="mt-1 text-cyber-secondary">点击"查看完整档案"进行绑定</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 功能说明 */}
            <div className="bg-gradient-to-r from-cyber-primary/10 to-cyber-accent/10 p-4 rounded-lg border border-cyber-primary/20 mt-4">
              <div className="space-y-2">
                <div className="text-sm text-cyber-text">
                  <p className="flex items-center font-medium mb-2">
                    <ExternalLink className="h-4 w-4 mr-2 text-cyber-primary" />
                    在完整档案页面您可以：
                  </p>
                  <ul className="ml-6 space-y-1 text-cyber-secondary">
                    <li>• 编辑用户名、邮箱地址和手机号码</li>
                    <li>• 绑定或更新网易云音乐账号信息</li>
                    <li>• 查看详细的账户统计信息</li>
                    <li>• 管理账户安全设置</li>
                  </ul>
                </div>
              </div>
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