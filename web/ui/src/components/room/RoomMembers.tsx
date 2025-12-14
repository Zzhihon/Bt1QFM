import React, { useState } from 'react';
import { useRoom } from '../../contexts/RoomContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  Crown,
  Shield,
  User,
  Headphones,
  MessageCircle,
  MoreVertical,
  UserCheck,
  UserX,
  ArrowRightLeft,
} from 'lucide-react';
import { RoomMemberOnline } from '../../types';

const RoomMembers: React.FC = () => {
  const { currentUser } = useAuth();
  const { addToast } = useToast();
  const { members, myMember, transferOwner, grantControl } = useRoom();
  const [menuOpen, setMenuOpen] = useState<number | null>(null);

  // 检查是否是房主
  const isOwner = myMember?.role === 'owner';

  // 获取角色图标
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner':
        return <Crown className="w-4 h-4 text-yellow-500" />;
      case 'admin':
        return <Shield className="w-4 h-4 text-blue-500" />;
      default:
        return null;
    }
  };

  // 获取模式图标
  const getModeIcon = (mode: string) => {
    return mode === 'listen' ? (
      <Headphones className="w-3 h-3 text-cyber-primary" />
    ) : (
      <MessageCircle className="w-3 h-3 text-cyber-secondary" />
    );
  };

  // 处理转让房主
  const handleTransferOwner = (targetUserId: number, username: string) => {
    transferOwner(targetUserId);
    setMenuOpen(null);
    addToast({
      type: 'success',
      message: `已将房主转让给 ${username}`,
      duration: 3000,
    });
  };

  // 处理授权/取消授权控制
  const handleToggleControl = (member: RoomMemberOnline) => {
    grantControl(member.userId, !member.canControl);
    setMenuOpen(null);
    addToast({
      type: 'success',
      message: member.canControl
        ? `已取消 ${member.username} 的控制权限`
        : `已授权 ${member.username} 控制播放`,
      duration: 3000,
    });
  };

  // 格式化时间
  const formatJoinTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return '刚刚加入';
    if (minutes < 60) return `${minutes} 分钟前加入`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前加入`;

    return '超过一天';
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {members.map((member) => {
            const isMe = member.userId === currentUser?.id;
            const canManage = isOwner && !isMe && member.role !== 'owner';

            return (
              <div
                key={member.userId}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  isMe
                    ? 'bg-cyber-primary/10 border border-cyber-primary/30'
                    : 'bg-cyber-bg-darker/30 hover:bg-cyber-bg-darker/50'
                } transition-colors`}
              >
                <div className="flex items-center space-x-3">
                  {/* 头像 */}
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      member.role === 'owner'
                        ? 'bg-yellow-500/20'
                        : member.role === 'admin'
                        ? 'bg-blue-500/20'
                        : 'bg-cyber-secondary/20'
                    }`}
                  >
                    {member.avatar ? (
                      <img
                        src={member.avatar}
                        alt={member.username}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      <span
                        className={`text-sm font-medium ${
                          member.role === 'owner'
                            ? 'text-yellow-500'
                            : member.role === 'admin'
                            ? 'text-blue-500'
                            : 'text-cyber-secondary'
                        }`}
                      >
                        {member.username.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* 信息 */}
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-cyber-text">
                        {member.username}
                        {isMe && (
                          <span className="ml-1 text-xs text-cyber-primary">(我)</span>
                        )}
                      </span>
                      {getRoleIcon(member.role)}
                      {member.canControl && member.role === 'member' && (
                        <span className="text-xs text-green-500" title="有控制权限">
                          ⚡
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 text-xs text-cyber-secondary/70">
                      {getModeIcon(member.mode)}
                      <span>{formatJoinTime(member.joinedAt)}</span>
                    </div>
                  </div>
                </div>

                {/* 管理菜单 */}
                {canManage && (
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen(menuOpen === member.userId ? null : member.userId)}
                      className="p-2 rounded-lg hover:bg-cyber-secondary/10 text-cyber-secondary hover:text-cyber-text transition-colors"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {menuOpen === member.userId && (
                      <>
                        {/* 点击遮罩关闭菜单 */}
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setMenuOpen(null)}
                        />

                        {/* 菜单 */}
                        <div className="absolute right-0 top-full mt-1 w-48 bg-cyber-bg-darker border border-cyber-secondary/20 rounded-lg shadow-xl z-20 py-1">
                          <button
                            onClick={() => handleToggleControl(member)}
                            className="w-full px-4 py-2 text-left text-sm text-cyber-text hover:bg-cyber-secondary/10 flex items-center space-x-2 transition-colors"
                          >
                            {member.canControl ? (
                              <>
                                <UserX className="w-4 h-4 text-red-400" />
                                <span>取消控制权限</span>
                              </>
                            ) : (
                              <>
                                <UserCheck className="w-4 h-4 text-green-400" />
                                <span>授权控制播放</span>
                              </>
                            )}
                          </button>

{/* 转让房主按钮已隐藏，功能保留供后续使用
                          <button
                            onClick={() => handleTransferOwner(member.userId, member.username)}
                            className="w-full px-4 py-2 text-left text-sm text-cyber-text hover:bg-cyber-secondary/10 flex items-center space-x-2 transition-colors"
                          >
                            <ArrowRightLeft className="w-4 h-4 text-yellow-400" />
                            <span>转让房主</span>
                          </button>
                          */}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {members.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-cyber-secondary/50">
              <User className="w-12 h-12 mb-2" />
              <p className="text-sm">暂无成员</p>
            </div>
          )}
        </div>
      </div>

      {/* 底部说明 */}
      <div className="p-4 bg-cyber-bg-darker/30 border-t border-cyber-secondary/10">
        <div className="flex items-center justify-center space-x-4 text-xs text-cyber-secondary/50">
          <div className="flex items-center space-x-1">
            <Crown className="w-3 h-3 text-yellow-500" />
            <span>房主</span>
          </div>
          <div className="flex items-center space-x-1">
            <Shield className="w-3 h-3 text-blue-500" />
            <span>管理员</span>
          </div>
          <div className="flex items-center space-x-1">
            <Headphones className="w-3 h-3 text-cyber-primary" />
            <span>听歌模式</span>
          </div>
          <div className="flex items-center space-x-1">
            <MessageCircle className="w-3 h-3 text-cyber-secondary" />
            <span>聊天模式</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoomMembers;
