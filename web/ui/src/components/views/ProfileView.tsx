import React, { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { UserCircle, Mail, Phone, CalendarDays } from 'lucide-react';

interface NullString {
  String: string;
  Valid: boolean;
}

const ProfileView: React.FC = () => {
  const { currentUser } = useAuth();

  useEffect(() => {
    // 添加调试日志
    console.log('ProfileView - currentUser:', currentUser);
  }, [currentUser]);

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
        <h2 className="text-3xl font-bold text-center text-cyber-primary animate-pulse mb-8">User Profile</h2>
        <div className="space-y-4 text-cyber-text">
          <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
            <UserCircle className="h-6 w-6 text-cyber-secondary" />
            <p><strong className="text-cyber-accent">Username:</strong> {getStringValue(currentUser.username)}</p>
          </div>
          <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
            <Mail className="h-6 w-6 text-cyber-secondary" />
            <p><strong className="text-cyber-accent">Email:</strong> {getStringValue(currentUser.email)}</p>
          </div>
          <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
            <Phone className="h-6 w-6 text-cyber-secondary" />
            <p><strong className="text-cyber-accent">Phone:</strong> {getStringValue(currentUser.phone)}</p>
          </div>
          <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
            <CalendarDays className="h-6 w-6 text-cyber-secondary" />
            <p><strong className="text-cyber-accent">Joined:</strong> {formatDate(getStringValue(currentUser.createdAt))}</p>
          </div>
        </div>
        <div className="mt-8 flex justify-center">
          <button 
            onClick={() => alert('Edit profile functionality coming soon!')}
            className="px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-cyber-bg-darker bg-cyber-accent hover:bg-yellow-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-cyber-bg focus:ring-cyber-accent transition-colors duration-300"
          >
            Edit Profile (Coming Soon)
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfileView; 