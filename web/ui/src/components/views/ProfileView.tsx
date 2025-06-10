import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { UserCircle, Mail, Phone, CalendarDays, Music, Save, Loader2 } from 'lucide-react';

interface NullString {
  String: string;
  Valid: boolean;
}

const ProfileView: React.FC = () => {
  const { currentUser } = useAuth();
  const [neteaseUsername, setNeteaseUsername] = useState('');
  const [neteaseUID, setNeteaseUID] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');

  useEffect(() => {
    // 添加调试日志
    console.log('ProfileView - currentUser:', currentUser);
    
    // 获取用户的网易云信息
    fetchUserProfile();
  }, [currentUser]);

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
          setNeteaseUsername(result.data.neteaseUsername || '');
          setNeteaseUID(result.data.neteaseUID || '');
        }
      }
    } catch (error) {
      console.error('获取用户资料失败:', error);
    }
  };

  const handleUpdateNeteaseInfo = async () => {
    setIsUpdating(true);
    setUpdateMessage('');

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setUpdateMessage('请先登录');
        return;
      }

      const response = await fetch('/api/user/netease/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          neteaseUsername,
          neteaseUID
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setUpdateMessage('网易云信息更新成功！');
        } else {
          setUpdateMessage('更新失败，请重试');
        }
      } else {
        setUpdateMessage('更新失败，请检查网络连接');
      }
    } catch (error) {
      console.error('更新网易云信息失败:', error);
      setUpdateMessage('更新失败，请重试');
    } finally {
      setIsUpdating(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="min-h-[calc(100vh-150px)] flex items-center justify-center p-4 text-cyber-accent">
        <div className="text-center">
          <p className="text-xl mb-2">Loading profile...</p>
          <p className="text-sm text-cyber-secondary">Please wait while we fetch your profile information.</p>
        </div>
      </div>
    );
  }

  // 格式化日期
  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Invalid Date';
    }
  };

  // 处理 NullString 类型
  const getStringValue = (value: string | NullString | undefined): string => {
    if (!value) return 'N/A';
    if (typeof value === 'string') return value;
    if (value.Valid) return value.String;
    return 'N/A';
  };

  return (
    <div className="min-h-[calc(100vh-150px)] flex flex-col items-center justify-center bg-cyber-bg p-4">
      <div className="w-full max-w-lg p-8 space-y-6 bg-cyber-bg-darker shadow-2xl rounded-lg border-2 border-cyber-primary">
        <h2 className="text-3xl font-bold text-center text-cyber-primary animate-pulse mb-8">用户资料</h2>
        
        {/* 基本信息 */}
        <div className="space-y-4 text-cyber-text">
          <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
            <UserCircle className="h-6 w-6 text-cyber-secondary" />
            <p><strong className="text-cyber-accent">用户名:</strong> {getStringValue(currentUser.username)}</p>
          </div>
          <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
            <Mail className="h-6 w-6 text-cyber-secondary" />
            <p><strong className="text-cyber-accent">邮箱:</strong> {getStringValue(currentUser.email)}</p>
          </div>
          <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
            <Phone className="h-6 w-6 text-cyber-secondary" />
            <p><strong className="text-cyber-accent">手机:</strong> {getStringValue(currentUser.phone)}</p>
          </div>
          <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
            <CalendarDays className="h-6 w-6 text-cyber-secondary" />
            <p><strong className="text-cyber-accent">注册时间:</strong> {formatDate(getStringValue(currentUser.createdAt))}</p>
          </div>
        </div>

        {/* 网易云音乐绑定 */}
        <div className="border-t border-cyber-secondary/30 pt-6">
          <div className="flex items-center space-x-2 mb-4">
            <Music className="h-6 w-6 text-cyber-primary" />
            <h3 className="text-lg font-semibold text-cyber-primary">网易云音乐账号</h3>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-cyber-accent mb-2">
                网易云用户名
              </label>
              <input
                type="text"
                value={neteaseUsername}
                onChange={(e) => setNeteaseUsername(e.target.value)}
                placeholder="输入您的网易云用户名"
                className="w-full px-3 py-2 bg-cyber-bg border border-cyber-secondary rounded-md text-cyber-text placeholder-cyber-secondary/50 focus:outline-none focus:border-cyber-primary focus:ring-1 focus:ring-cyber-primary"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-cyber-accent mb-2">
                网易云UID
              </label>
              <input
                type="text"
                value={neteaseUID}
                onChange={(e) => setNeteaseUID(e.target.value)}
                placeholder="输入您的网易云UID（可选）"
                className="w-full px-3 py-2 bg-cyber-bg border border-cyber-secondary rounded-md text-cyber-text placeholder-cyber-secondary/50 focus:outline-none focus:border-cyber-primary focus:ring-1 focus:ring-cyber-primary"
              />
            </div>
            
            <button
              onClick={handleUpdateNeteaseInfo}
              disabled={isUpdating}
              className="w-full flex items-center justify-center px-4 py-2 bg-cyber-primary text-cyber-bg-darker rounded-md hover:bg-cyber-hover-primary focus:outline-none focus:ring-2 focus:ring-cyber-primary focus:ring-offset-2 focus:ring-offset-cyber-bg-darker transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUpdating ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <Save className="h-5 w-5 mr-2" />
              )}
              {isUpdating ? '更新中...' : '保存网易云信息'}
            </button>
            
            {updateMessage && (
              <div className={`text-sm text-center ${updateMessage.includes('成功') ? 'text-green-400' : 'text-cyber-red'}`}>
                {updateMessage}
              </div>
            )}
          </div>
          
          <div className="mt-4 text-xs text-cyber-secondary">
            <p>绑定网易云账号后，您可以在"收藏"页面查看您的网易云歌单。</p>
            <p className="mt-1">如果不知道UID，只填写用户名即可，系统会自动获取。</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileView;