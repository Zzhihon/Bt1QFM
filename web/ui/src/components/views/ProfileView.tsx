import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { UserCircle, Mail, Phone, CalendarDays, Music, Save, Loader2, Edit3, X, Check, User } from 'lucide-react';

interface NullString {
  String: string;
  Valid: boolean;
}

// 获取后端 URL，提供默认值
const getBackendUrl = () => {
  if (typeof window !== 'undefined' && (window as any).__ENV__?.BACKEND_URL) {
    return (window as any).__ENV__.BACKEND_URL;
  }
  return import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';
};

const ProfileView: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const [profileData, setProfileData] = useState<any>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState<{[key: string]: string}>({});
  
  // 编辑模式状态
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    username: '',
    email: '',
    phone: '',
    neteaseUsername: '',
    neteaseUID: ''
  });

  // 完整档案模式状态
  const [showFullProfile, setShowFullProfile] = useState(false);

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

  useEffect(() => {
    console.log('🔄 ProfileView useEffect 触发:', {
      currentUser: currentUser,
      hasCurrentUser: !!currentUser,
      userAgent: navigator.userAgent,
      location: window.location.href
    });
    fetchUserProfile();
  }, [currentUser]);

  const fetchUserProfile = async () => {
    console.log('🚀 fetchUserProfile 开始执行');
    
    try {
      // 添加详细的 localStorage 调试信息
      console.log('🔍 localStorage 调试信息:', {
        allKeys: Object.keys(localStorage),
        localStorage_length: localStorage.length,
        token: localStorage.getItem('token'),
        auth_token: localStorage.getItem('auth_token'),
        authToken: localStorage.getItem('authToken'),
        user_token: localStorage.getItem('user_token'),
        jwt_token: localStorage.getItem('jwt_token'),
        storage_entries: Object.entries(localStorage),
        window_location: window.location,
        document_domain: document.domain,
        document_cookie: document.cookie
      });

      // 优先使用 authToken，然后是 token，最后尝试其他可能的键
      let token = localStorage.getItem('authToken') || localStorage.getItem('token');
      
      if (!token) {
        // 尝试从其他可能的 key 获取 token
        const possibleTokenKeys = ['auth_token', 'user_token', 'jwt_token', 'access_token'];
        for (const key of possibleTokenKeys) {
          const altToken = localStorage.getItem(key);
          if (altToken) {
            console.log(`🔍 在 ${key} 中找到 token:`, altToken.substring(0, 20) + '...');
            token = altToken;
            break;
          }
        }
      }

      console.log('🔑 获取到的 token:', token ? `${token.substring(0, 20)}...` : 'null');
      
      if (!token) {
        console.log('❌ 没有找到 token，退出函数');
        return;
      }

      console.log('📡 准备发起用户资料请求:', {
        endpoint: '/api/user/profile',
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token.substring(0, 20) + '...' },
        fullUrl: window.location.origin + '/api/user/profile',
        timestamp: new Date().toISOString()
      });

      // 直接请求统一的 API 路径，避免在正式环境下出现 " /1qfm/profile " 的错误端点
      const response = await fetch('/api/user/profile', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      console.log('📡 用户资料响应状态:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        url: response.url,
        headers: Object.fromEntries(response.headers.entries()),
        timestamp: new Date().toISOString()
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ 用户资料响应数据:', result);
        
        if (result.success && result.data) {
          const data = result.data;
          setProfileData(data);
          
          // 确保正确初始化编辑表单，处理所有可能的数据格式
          const initializeFormData = {
            username: data.username || '',
            email: data.email || '',
            phone: data.phone || '',
            neteaseUsername: data.neteaseUsername || '',
            neteaseUID: data.neteaseUID || ''
          };
          
          console.log('🔄 初始化表单数据:', initializeFormData);
          setEditForm(initializeFormData);
        } else {
          console.warn('⚠️ 响应成功但数据格式异常:', result);
        }
      } else {
        const errorText = await response.text();
        console.error('❌ 用户资料请求失败:', {
          status: response.status,
          statusText: response.statusText,
          errorText: errorText,
          url: response.url
        });
      }
    } catch (error) {
      console.error('❌ 获取用户资料失败 - 网络错误:', {
        error: error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
    }
  };

  // 表单验证函数
  const validateForm = () => {
    const errors: {[key: string]: string} = {};
    
    if (!editForm.username.trim()) {
      errors.username = '用户名不能为空';
    }
    
    if (!editForm.email.trim()) {
      errors.email = '邮箱地址不能为空';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email)) {
      errors.email = '请输入有效的邮箱地址';
    }
    
    // 网易云UID为必填项
    if (editForm.neteaseUsername.trim() && !editForm.neteaseUID.trim()) {
      errors.neteaseUID = '绑定网易云账号时UID为必填项';
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleUpdateProfile = async () => {
    // 验证表单
    if (!validateForm()) {
      setUpdateMessage('请检查表单信息并修正错误');
      return;
    }

    setIsUpdating(true);
    setUpdateMessage('');

    try {
      // 使用统一的 token 获取逻辑
      let token = localStorage.getItem('authToken') || localStorage.getItem('token');
      if (!token) {
        setUpdateMessage('请先登录');
        return;
      }

      // 确保空值被正确处理为空字符串
      const submitData = {
        username: editForm.username.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim(),
        neteaseUsername: editForm.neteaseUsername.trim() || '', // 允许为空字符串
        neteaseUID: editForm.neteaseUID.trim() || ''
      };

      console.log('📡 准备发起更新用户资料请求:', {
        endpoint: '/api/user/profile',
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token.substring(0, 20) + '...'
        },
        body: submitData,
        fullUrl: window.location.origin + '/api/user/profile',
        timestamp: new Date().toISOString()
      });

      // 使用绝对 API 路径，确保生产环境不受 BASE 路径影响
      const response = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(submitData)
      });

      console.log('📡 更新用户资料响应状态:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        url: response.url,
        headers: Object.fromEntries(response.headers.entries()),
        timestamp: new Date().toISOString()
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ 更新用户资料响应数据:', result);
        
        if (result.success) {
          setUpdateMessage('资料更新成功！');
          setIsEditing(false);
          // 重新获取用户资料
          await fetchUserProfile();
          // 3秒后清除成功消息
          setTimeout(() => setUpdateMessage(''), 3000);
        } else {
          console.error('❌ 更新失败 - 服务器返回错误:', result);
          setUpdateMessage('更新失败，请重试');
        }
      } else {
        const errorText = await response.text();
        console.error('❌ 更新用户资料请求失败:', {
          status: response.status,
          statusText: response.statusText,
          errorText: errorText,
          url: response.url
        });
        setUpdateMessage('更新失败，请检查网络连接');
      }
    } catch (error) {
      console.error('❌ 更新用户资料失败 - 网络错误:', {
        error: error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      setUpdateMessage('更新失败，请重试');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    // 重置表单数据 - 确保使用最新的 profileData
    if (profileData) {
      setEditForm({
        username: profileData.username || '',
        email: profileData.email || '',
        phone: profileData.phone || '',
        neteaseUsername: profileData.neteaseUsername || '',
        neteaseUID: profileData.neteaseUID || ''
      });
    }
    setUpdateMessage('');
  };

  // 只更新网易云信息的函数（保持向后兼容）
  const handleUpdateNeteaseInfo = async () => {
    // 网易云UID为必填项
    if (editForm.neteaseUsername.trim() && !editForm.neteaseUID.trim()) {
      setValidationErrors({neteaseUID: '绑定网易云账号时UID为必填项'});
      setUpdateMessage('请填写网易云UID');
      return;
    }

    setIsUpdating(true);
    setUpdateMessage('');

    try {
      // 使用统一的 token 获取逻辑
      let token = localStorage.getItem('authToken') || localStorage.getItem('token');
      if (!token) {
        setUpdateMessage('请先登录');
        return;
      }

      const neteaseData = {
        neteaseUsername: editForm.neteaseUsername.trim() || '', // 允许为空字符串
        neteaseUID: editForm.neteaseUID.trim() || ''
      };

      console.log('📡 准备发起更新网易云信息请求:', {
        endpoint: '/api/user/netease/update',
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token.substring(0, 20) + '...'
        },
        body: neteaseData,
        fullUrl: window.location.origin + '/api/user/netease/update',
        timestamp: new Date().toISOString()
      });

      // 使用绝对 API 路径，避免构建后的基路径影响
      const response = await fetch('/api/user/netease/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(neteaseData)
      });

      console.log('📡 更新网易云信息响应状态:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        url: response.url,
        headers: Object.fromEntries(response.headers.entries()),
        timestamp: new Date().toISOString()
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ 更新网易云信息响应数据:', result);
        
        if (result.success) {
          setUpdateMessage('网易云信息更新成功！');
          await fetchUserProfile();
          setTimeout(() => setUpdateMessage(''), 3000);
        } else {
          console.error('❌ 网易云信息更新失败 - 服务器返回错误:', result);
          setUpdateMessage('更新失败，请重试');
        }
      } else {
        const errorText = await response.text();
        console.error('❌ 更新网易云信息请求失败:', {
          status: response.status,
          statusText: response.statusText,
          errorText: errorText,
          url: response.url
        });
        setUpdateMessage('更新失败，请检查网络连接');
      }
    } catch (error) {
      console.error('❌ 更新网易云信息失败 - 网络错误:', {
        error: error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
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

  if (!showFullProfile) {
    // 简化的个人资料视图
    return (
      <div className="min-h-[calc(100vh-150px)] flex flex-col items-center justify-center bg-cyber-bg p-4 pb-32">
        {/* 查看完整档案按钮 - 右上角 */}
        <div className="fixed top-4 right-4 z-50">
          <button
            onClick={() => setShowFullProfile(true)}
            className="flex items-center px-4 py-2 bg-cyber-primary text-cyber-bg-darker rounded-lg hover:bg-cyber-hover-primary transition-colors font-medium shadow-lg"
          >
            <User className="h-5 w-5 mr-2" />
            查看完整档案
          </button>
        </div>

        <div className="w-full max-w-lg p-8 space-y-6 bg-cyber-bg-darker shadow-2xl rounded-lg border-2 border-cyber-primary">
          {/* 标题和编辑按钮 */}
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold text-cyber-primary animate-pulse">用户资料</h2>
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center px-3 py-2 bg-cyber-secondary text-cyber-text rounded-md hover:bg-cyber-accent transition-colors"
              >
                <Edit3 className="h-4 w-4 mr-1" />
                编辑
              </button>
            ) : (
              <div className="flex space-x-2">
                <button
                  onClick={handleUpdateProfile}
                  disabled={isUpdating}
                  className="flex items-center px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {isUpdating ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Check className="h-4 w-4 mr-1" />
                  )}
                  保存
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="flex items-center px-3 py-2 bg-cyber-red text-white rounded-md hover:bg-red-600 transition-colors"
                >
                  <X className="h-4 w-4 mr-1" />
                  取消
                </button>
              </div>
            )}
          </div>

          {/* 状态消息 */}
          {updateMessage && (
            <div className={`text-sm text-center mb-4 p-3 rounded-lg ${
              updateMessage.includes('成功') 
                ? 'bg-green-900/30 border border-green-500/50 text-green-300' 
                : 'bg-red-900/30 border border-red-500/50 text-red-300'
            }`}>
              <div className="flex items-center justify-center">
                {updateMessage.includes('成功') ? (
                  <Check className="h-4 w-4 mr-2" />
                ) : (
                  <X className="h-4 w-4 mr-2" />
                )}
                {updateMessage}
              </div>
            </div>
          )}
          
          {/* 基本信息 */}
          <div className="space-y-4 text-cyber-text">
            {/* 用户名 */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-cyber-accent">用户名</label>
              {isEditing ? (
                <input
                  type="text"
                  value={editForm.username}
                  onChange={(e) => setEditForm({...editForm, username: e.target.value})}
                  className="w-full px-3 py-2 bg-cyber-bg border border-cyber-secondary rounded-md text-cyber-text focus:outline-none focus:border-cyber-primary focus:ring-1 focus:ring-cyber-primary"
                  placeholder="输入用户名"
                />
              ) : (
                <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
                  <UserCircle className="h-6 w-6 text-cyber-secondary" />
                  <span>{profileData?.username || '未设置'}</span>
                </div>
              )}
            </div>

            {/* 邮箱 */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-cyber-accent">邮箱地址</label>
              {isEditing ? (
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                  className="w-full px-3 py-2 bg-cyber-bg border border-cyber-secondary rounded-md text-cyber-text focus:outline-none focus:border-cyber-primary focus:ring-1 focus:ring-cyber-primary"
                  placeholder="输入邮箱地址"
                />
              ) : (
                <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
                  <Mail className="h-6 w-6 text-cyber-secondary" />
                  <span>{profileData?.email || '未设置'}</span>
                </div>
              )}
            </div>

            {/* 手机号 */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-cyber-accent">手机号码</label>
              {isEditing ? (
                <input
                  type="tel"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({...editForm, phone: e.target.value})}
                  className="w-full px-3 py-2 bg-cyber-bg border border-cyber-secondary rounded-md text-cyber-text focus:outline-none focus:border-cyber-primary focus:ring-1 focus:ring-cyber-primary"
                  placeholder="输入手机号码"
                />
              ) : (
                <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
                  <Phone className="h-6 w-6 text-cyber-secondary" />
                  <span>{profileData?.phone || '未设置'}</span>
                </div>
              )}
            </div>

            {/* 注册时间 */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-cyber-accent">注册时间</label>
              <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
                <CalendarDays className="h-6 w-6 text-cyber-secondary" />
                <span>{formatDate(profileData?.createdAt)}</span>
              </div>
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
                  网易云用户名 <span className="text-cyber-secondary">(可选)</span>
                </label>
                <input
                  type="text"
                  value={editForm.neteaseUsername}
                  onChange={(e) => {
                    setEditForm({...editForm, neteaseUsername: e.target.value});
                    setValidationErrors({...validationErrors, neteaseUsername: ''});
                  }}
                  placeholder="输入您的网易云用户名"
                  disabled={!isEditing}
                  className={`w-full px-3 py-2 bg-cyber-bg border rounded-md text-cyber-text placeholder-cyber-secondary/50 focus:outline-none focus:ring-1 disabled:opacity-60 disabled:cursor-not-allowed ${
                    validationErrors.neteaseUsername 
                      ? 'border-cyber-red focus:border-cyber-red focus:ring-cyber-red' 
                      : 'border-cyber-secondary focus:border-cyber-primary focus:ring-cyber-primary'
                  }`}
                />
                {validationErrors.neteaseUsername && (
                  <p className="mt-1 text-xs text-cyber-red">{validationErrors.neteaseUsername}</p>
                )}
              </div>
              
              <div>
                <label className="block text-sm font-medium text-cyber-accent mb-2">
                  网易云UID <span className="text-cyber-red">*</span>
                </label>
                <input
                  type="text"
                  value={editForm.neteaseUID}
                  onChange={(e) => {
                    setEditForm({...editForm, neteaseUID: e.target.value});
                    setValidationErrors({...validationErrors, neteaseUID: ''});
                  }}
                  placeholder="输入您的网易云UID（绑定时必填）"
                  disabled={!isEditing}
                  className={`w-full px-3 py-2 bg-cyber-bg border rounded-md text-cyber-text placeholder-cyber-secondary/50 focus:outline-none focus:ring-1 disabled:opacity-60 disabled:cursor-not-allowed ${
                    validationErrors.neteaseUID 
                      ? 'border-cyber-red focus:border-cyber-red focus:ring-cyber-red' 
                      : 'border-cyber-secondary focus:border-cyber-primary focus:ring-cyber-primary'
                  }`}
                />
                {validationErrors.neteaseUID && (
                  <p className="mt-1 text-xs text-cyber-red">{validationErrors.neteaseUID}</p>
                )}
              </div>
            </div>
            
            <div className="mt-4 text-xs text-cyber-secondary">
              <p className="text-cyber-accent font-medium mb-2">温馨提示:</p>
              <p>• 网易云用户名为可选项，可以不填写</p>
              <p className="mt-1">• 此uid只用于获取你的歌单信息，不做其他用途，请放心</p>
              <p className="mt-1">• UID可在网易云个人设置的账户与安全中心查找</p>
              <p className="mt-1">• 绑定后可在"收藏"页面查看您的网易云歌单</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 完整档案视图
  return (
    <div className="min-h-screen bg-cyber-bg pb-32">
      {/* 顶部导航条 */}
      <div className="bg-cyber-bg-darker border-b border-cyber-secondary/30 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-cyber-primary">FM Music</h1>
            </div>

            {/* 用户信息和操作按钮 */}
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-cyber-text font-medium text-sm">
                  {profileData ? getStringValue(profileData.username) || getStringValue(profileData.email) : '用户'}
                </div>
                <div className="text-cyber-secondary text-xs">
                  完整档案页面
                </div>
              </div>
              <div className="w-10 h-10 bg-gradient-to-br from-cyber-primary to-cyber-accent rounded-full flex items-center justify-center">
                <UserCircle className="w-6 h-6 text-white" />
              </div>
              <button
                onClick={() => setShowFullProfile(false)}
                className="text-cyber-accent hover:text-cyber-primary transition-colors text-sm px-3 py-1 border border-cyber-accent/30 rounded hover:border-cyber-primary/50"
              >
                返回简化版
              </button>
              <button
                onClick={() => {
                  logout();
                  window.location.href = '/login';
                }}
                className="text-cyber-red hover:text-red-400 transition-colors text-sm px-3 py-1 border border-cyber-red/30 rounded hover:border-cyber-red/50"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 主要内容 */}
      <div className="p-4 pb-32">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* 页面标题和操作栏 */}
          <div className="bg-cyber-bg-darker p-6 rounded-lg border border-cyber-primary/30">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-cyber-primary">完整个人资料</h1>
                <p className="text-cyber-secondary mt-2">管理您的账户信息和网易云音乐设置</p>
              </div>
              <div className="flex items-center gap-3">
                {!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center px-6 py-3 bg-cyber-primary text-cyber-bg-darker rounded-lg hover:bg-cyber-hover-primary transition-colors font-medium shadow-lg"
                  >
                    <Edit3 className="h-5 w-5 mr-2" />
                    编辑资料
                  </button>
                ) : (
                  <div className="flex gap-3">
                    <button
                      onClick={handleUpdateProfile}
                      disabled={isUpdating}
                      className="flex items-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                    >
                      {isUpdating ? (
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      ) : (
                        <Check className="h-5 w-5 mr-2" />
                      )}
                      {isUpdating ? '保存中...' : '保存更改'}
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="flex items-center px-6 py-3 bg-cyber-red text-white rounded-lg hover:bg-red-600 transition-colors font-medium shadow-lg"
                    >
                      <X className="h-5 w-5 mr-2" />
                      取消
                    </button>
                  </div>
                )}
              </div>
            </div>
            
            {/* 状态消息 */}
            {updateMessage && (
              <div className={`mt-6 p-4 rounded-lg ${
                updateMessage.includes('成功') 
                  ? 'bg-green-900/30 border border-green-500/50 text-green-300' 
                  : 'bg-red-900/30 border border-red-500/50 text-red-300'
              }`}>
                <div className="flex items-center">
                  {updateMessage.includes('成功') ? (
                    <Check className="h-5 w-5 mr-3 flex-shrink-0" />
                  ) : (
                    <X className="h-5 w-5 mr-3 flex-shrink-0" />
                  )}
                  <span className="font-medium">{updateMessage}</span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 基本信息卡片 */}
            <div className="bg-cyber-bg-darker p-6 rounded-lg border border-cyber-secondary/30">
              <h2 className="text-xl font-semibold text-cyber-primary mb-6 flex items-center">
                <UserCircle className="h-6 w-6 mr-2" />
                基本信息
              </h2>
              
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-cyber-accent mb-2">用户名</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editForm.username}
                      onChange={(e) => setEditForm({...editForm, username: e.target.value})}
                      className="w-full px-4 py-3 bg-cyber-bg border border-cyber-secondary rounded-lg text-cyber-text focus:outline-none focus:border-cyber-primary focus:ring-2 focus:ring-cyber-primary/20 transition-all"
                      placeholder="输入用户名"
                    />
                  ) : (
                    <div className="px-4 py-3 bg-cyber-bg/50 border border-cyber-secondary/50 rounded-lg text-cyber-text">
                      {profileData?.username || '未设置'}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-cyber-accent mb-2">邮箱地址</label>
                  {isEditing ? (
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                      className="w-full px-4 py-3 bg-cyber-bg border border-cyber-secondary rounded-lg text-cyber-text focus:outline-none focus:border-cyber-primary focus:ring-2 focus:ring-cyber-primary/20 transition-all"
                      placeholder="输入邮箱地址"
                    />
                  ) : (
                    <div className="px-4 py-3 bg-cyber-bg/50 border border-cyber-secondary/50 rounded-lg text-cyber-text">
                      {profileData?.email || '未设置'}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-cyber-accent mb-2">手机号码</label>
                  {isEditing ? (
                    <input
                      type="tel"
                      value={editForm.phone}
                      onChange={(e) => setEditForm({...editForm, phone: e.target.value})}
                      className="w-full px-4 py-3 bg-cyber-bg border border-cyber-secondary rounded-lg text-cyber-text focus:outline-none focus:border-cyber-primary focus:ring-2 focus:ring-cyber-primary/20 transition-all"
                      placeholder="输入手机号码"
                    />
                  ) : (
                    <div className="px-4 py-3 bg-cyber-bg/50 border border-cyber-secondary/50 rounded-lg text-cyber-text">
                      {profileData?.phone || '未设置'}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-cyber-accent mb-2">注册时间</label>
                  <div className="px-4 py-3 bg-cyber-bg/50 border border-cyber-secondary/50 rounded-lg text-cyber-text flex items-center">
                    <CalendarDays className="h-5 w-5 mr-3 text-cyber-secondary" />
                    {profileData ? formatDate(profileData.createdAt) : '加载中...'}
                  </div>
                </div>
              </div>
            </div>

            {/* 网易云音乐卡片 */}
            <div className="bg-cyber-bg-darker p-6 rounded-lg border border-cyber-secondary/30">
              <h2 className="text-xl font-semibold text-cyber-primary mb-6 flex items-center">
                <Music className="h-6 w-6 mr-2" />
                网易云音乐
              </h2>
              
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-cyber-accent mb-2">
                    网易云用户名
                    <span className="text-cyber-secondary ml-1">(可选)</span>
                  </label>
                  <input
                    type="text"
                    value={isEditing ? editForm.neteaseUsername : (profileData?.neteaseUsername || '')}
                    onChange={(e) => {
                      if (isEditing) {
                        setEditForm({...editForm, neteaseUsername: e.target.value});
                        setValidationErrors({...validationErrors, neteaseUsername: ''});
                      }
                    }}
                    placeholder="输入您的网易云用户名（可留空）"
                    disabled={!isEditing}
                    className={`w-full px-4 py-3 bg-cyber-bg border rounded-lg text-cyber-text placeholder-cyber-secondary/50 focus:outline-none focus:ring-2 disabled:opacity-60 disabled:cursor-not-allowed transition-all ${
                      validationErrors.neteaseUsername 
                        ? 'border-cyber-red focus:border-cyber-red focus:ring-cyber-red/20' 
                        : 'border-cyber-secondary focus:border-cyber-primary focus:ring-cyber-primary/20'
                    }`}
                  />
                  {validationErrors.neteaseUsername && (
                    <p className="mt-2 text-sm text-cyber-red flex items-center">
                      <X className="h-4 w-4 mr-1" />
                      {validationErrors.neteaseUsername}
                    </p>
                  )}
                  {!isEditing && profileData?.neteaseUsername && (
                    <div className="mt-2 text-xs text-green-400 flex items-center">
                      <Check className="h-3 w-3 mr-1" />
                      已绑定网易云账号
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-cyber-accent mb-2">
                    网易云UID
                    <span className="text-cyber-red ml-1">*</span>
                  </label>
                  <input
                    type="text"
                    value={isEditing ? editForm.neteaseUID : (profileData?.neteaseUID || '')}
                    onChange={(e) => {
                      if (isEditing) {
                        setEditForm({...editForm, neteaseUID: e.target.value});
                        setValidationErrors({...validationErrors, neteaseUID: ''});
                      }
                    }}
                    placeholder="输入您的网易云UID（绑定时必填）"
                    disabled={!isEditing}
                    className={`w-full px-4 py-3 bg-cyber-bg border rounded-lg text-cyber-text placeholder-cyber-secondary/50 focus:outline-none focus:ring-2 disabled:opacity-60 disabled:cursor-not-allowed transition-all ${
                      validationErrors.neteaseUID 
                        ? 'border-cyber-red focus:border-cyber-red focus:ring-cyber-red/20' 
                        : 'border-cyber-secondary focus:border-cyber-primary focus:ring-cyber-primary/20'
                    }`}
                  />
                  {validationErrors.neteaseUID && (
                    <p className="mt-2 text-sm text-cyber-red flex items-center">
                      <X className="h-4 w-4 mr-1" />
                      {validationErrors.neteaseUID}
                    </p>
                  )}
                </div>

                <div className="bg-gradient-to-r from-cyber-red/10 to-cyber-accent/10 p-4 rounded-lg border border-cyber-red/20">
                  <div className="text-sm text-cyber-text space-y-2">
                    <div className="flex items-center mb-2">
                      <div className="w-4 h-4 bg-cyber-red rounded-full mr-2 flex items-center justify-center">
                        <span className="text-white text-xs font-bold">!</span>
                      </div>
                      <p className="font-medium text-cyber-red">绑定说明</p>
                    </div>
                    <div className="flex items-start">
                      <div className="w-2 h-2 bg-cyber-accent rounded-full mt-2 mr-3 flex-shrink-0"></div>
                      <p>网易云用户名为可选项，可以不填写</p>
                    </div>
                    <div className="flex items-start">
                      <div className="w-2 h-2 bg-cyber-red rounded-full mt-2 mr-3 flex-shrink-0"></div>
                      <p>如填写用户名，则UID为必填项以确保账户准确性</p>
                    </div>
                    <div className="flex items-start">
                      <div className="w-2 h-2 bg-cyber-primary rounded-full mt-2 mr-3 flex-shrink-0"></div>
                      <p>UID可在网易云个人设置的账户与安全中心查找</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileView;