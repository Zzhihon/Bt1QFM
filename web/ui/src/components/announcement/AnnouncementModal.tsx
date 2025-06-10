import React from 'react';
import { X } from 'lucide-react';
import type { Announcement } from '../../types/announcement';
import { announcementApi } from '../../api/announcement';

interface Props {
  visible: boolean;
  announcement: Announcement;
  onClose: () => void;
  onRead: (id: string) => void;
}

const AnnouncementModal: React.FC<Props> = ({ visible, announcement, onClose, onRead }) => {
  if (!visible) return null;

  const markAsReadAndClose = async () => {
    try {
      await announcementApi.markAsRead(announcement.id);
      onRead(announcement.id);
      onClose();
    } catch (error) {
      console.error('标记已读失败:', error);
      onClose();
    }
  };

  const formatTime = (time: string) => {
    return new Date(time).toLocaleString('zh-CN');
  };

  const getTypeStyle = (type: string) => {
    switch (type) {
      case 'info': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'success': return 'bg-green-100 text-green-800 border-green-200';
      case 'warning': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'error': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50" onClick={onClose}>
      <div className="bg-cyber-bg-darker border-2 border-cyber-primary rounded-lg max-w-lg w-[90%] max-h-[80vh] overflow-hidden shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-6 border-b border-cyber-primary/30">
          <h3 className="text-xl font-bold text-cyber-text">{announcement.title}</h3>
          <button 
            onClick={onClose}
            className="text-cyber-secondary hover:text-cyber-primary transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="p-6 max-h-96 overflow-y-auto">
          <div className={`inline-block px-3 py-1 rounded-full text-sm font-medium mb-4 border ${getTypeStyle(announcement.type)}`}>
            版本 {announcement.version}
          </div>
          
          <div className="text-cyber-text mb-4 leading-relaxed whitespace-pre-wrap">
            {announcement.content}
          </div>
          
          <div className="text-cyber-secondary text-sm">
            发布时间: {formatTime(announcement.createdAt)}
          </div>
        </div>
        
        <div className="p-6 border-t border-cyber-primary/30 text-right">
          <button 
            onClick={markAsReadAndClose}
            className="bg-cyber-primary hover:bg-cyber-hover-primary text-cyber-bg-darker px-6 py-2 rounded-lg font-semibold transition-colors"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnnouncementModal;
