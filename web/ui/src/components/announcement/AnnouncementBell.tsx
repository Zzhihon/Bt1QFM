import React, { useState, useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';
import type { Announcement } from '../../types/announcement';
import { announcementApi } from '../../api/announcement';

interface Props {
  onShowAnnouncement: (announcement: Announcement) => void;
}

const AnnouncementBell: React.FC<Props> = ({ onShowAnnouncement }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = announcements?.filter(a => !a.isRead).length || 0;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    // 初始加载数据
    loadAnnouncements();
  }, []);

  const toggleDropdown = () => {
    setShowDropdown(!showDropdown);
    if (!showDropdown) {
      loadAnnouncements();
    }
  };

  const loadAnnouncements = async () => {
    try {
      setLoading(true);
      const response = await announcementApi.getAnnouncements();
      if (response.success) {
        setAnnouncements(response.data);
      }
    } catch (error) {
      console.error('加载公告失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const markAllAsRead = async () => {
    try {
      const unreadAnnouncements = announcements?.filter(a => !a.isRead) || [];
      await Promise.all(unreadAnnouncements.map(a => announcementApi.markAsRead(a.id)));
      
      // 更新本地状态
      setAnnouncements(prev => prev?.map(a => ({ ...a, isRead: true })) || []);
    } catch (error) {
      console.error('标记全部已读失败:', error);
    }
  };

  const showAnnouncement = (announcement: Announcement) => {
    setShowDropdown(false);
    onShowAnnouncement(announcement);
  };

  const formatTime = (time: string) => {
    const date = new Date(time);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 30) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        className={`relative p-2 rounded-lg transition-all duration-300 border-2 ${
          showDropdown 
            ? 'bg-cyber-primary/10 text-cyber-primary border-cyber-primary/50' 
            : 'text-cyber-secondary hover:text-cyber-primary hover:bg-cyber-primary/10 border-transparent hover:border-cyber-primary/50'
        }`}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      
      {showDropdown && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-cyber-bg-darker border-2 border-cyber-primary rounded-lg shadow-xl z-50 max-h-96 overflow-hidden">
          <div className="p-4 border-b border-cyber-primary/30 flex justify-between items-center">
            <span className="text-cyber-text font-semibold">版本公告</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-cyber-primary hover:text-cyber-hover-primary text-sm transition-colors"
              >
                全部已读
              </button>
            )}
          </div>
          
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-cyber-secondary">
                正在加载...
              </div>
            ) : announcements?.length === 0 ? (
              <div className="p-8 text-center text-cyber-secondary">
                暂无公告
              </div>
            ) : (
              (announcements || []).map(announcement => (
                <div
                  key={announcement.id}
                  className={`p-4 border-b border-cyber-primary/20 cursor-pointer transition-colors relative ${
                    announcement.isRead 
                      ? 'hover:bg-cyber-primary/5' 
                      : 'bg-cyber-primary/10 hover:bg-cyber-primary/15'
                  }`}
                  onClick={() => showAnnouncement(announcement)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-cyber-text font-medium text-sm flex-1 pr-2">
                      {announcement.title}
                    </span>
                    <span className="bg-cyber-primary/20 text-cyber-primary px-2 py-1 rounded text-xs whitespace-nowrap">
                      v{announcement.version}
                    </span>
                  </div>
                  <div className="text-cyber-secondary text-xs">
                    {formatTime(announcement.createdAt)}
                  </div>
                  {!announcement.isRead && (
                    <div className="absolute top-4 right-3 w-2 h-2 bg-red-500 rounded-full"></div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AnnouncementBell;
