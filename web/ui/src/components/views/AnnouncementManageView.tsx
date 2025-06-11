import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Calendar, Tag, AlertCircle, BarChart3, Edit3 } from 'lucide-react';
import type { Announcement, CreateAnnouncementRequest } from '../../types/announcement';
import { announcementApi } from '../../api/announcement';

const AnnouncementManageView: React.FC = () => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [form, setForm] = useState<CreateAnnouncementRequest>({
    title: '',
    content: '',
    version: '',
    type: 'info'
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    await Promise.all([
      loadAnnouncements(),
      loadStats()
    ]);
  };

  const loadAnnouncements = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await announcementApi.getAnnouncements();
      if (response.success) {
        setAnnouncements(response.data);
      } else {
        throw new Error(response.message || '加载公告失败');
      }
    } catch (error) {
      console.error('加载公告失败:', error);
      setError(error instanceof Error ? error.message : '加载公告失败');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await announcementApi.getStats();
      if (response.success) {
        setStats(response.data);
      }
    } catch (error) {
      console.error('加载统计信息失败:', error);
    }
  };

  const createAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!form.title.trim() || !form.content.trim() || !form.version.trim()) {
      setError('请填写所有必需字段');
      return;
    }

    setCreating(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await announcementApi.createAnnouncement(form);
      if (response.success) {
        setShowCreateForm(false);
        setForm({ title: '', content: '', version: '', type: 'info' });
        setSuccess('公告创建成功！');
        await loadData();
        
        // 3秒后清除成功消息
        setTimeout(() => setSuccess(null), 3000);
      } else {
        throw new Error(response.message || '创建公告失败');
      }
    } catch (error) {
      console.error('创建公告失败:', error);
      setError(error instanceof Error ? error.message : '创建公告失败');
    } finally {
      setCreating(false);
    }
  };

  const updateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!form.title.trim() || !form.content.trim() || !form.version.trim() || !editingAnnouncement) {
      setError('请填写所有必需字段');
      return;
    }

    setUpdating(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await announcementApi.updateAnnouncement(editingAnnouncement.id, form);
      if (response.success) {
        setShowEditForm(false);
        setEditingAnnouncement(null);
        setForm({ title: '', content: '', version: '', type: 'info' });
        setSuccess('公告更新成功！');
        await loadData();
        
        // 3秒后清除成功消息
        setTimeout(() => setSuccess(null), 3000);
      } else {
        throw new Error(response.message || '更新公告失败');
      }
    } catch (error) {
      console.error('更新公告失败:', error);
      setError(error instanceof Error ? error.message : '更新公告失败');
    } finally {
      setUpdating(false);
    }
  };

  const deleteAnnouncement = async (id: string, title: string) => {
    if (!window.confirm(`确定要删除公告 "${title}" 吗？`)) return;
    
    try {
      setError(null);
      setSuccess(null);
      const response = await announcementApi.deleteAnnouncement(id);
      if (response.success) {
        setSuccess('公告删除成功！');
        await loadData();
        
        // 3秒后清除成功消息
        setTimeout(() => setSuccess(null), 3000);
      } else {
        throw new Error(response.message || '删除公告失败');
      }
    } catch (error) {
      console.error('删除公告失败:', error);
      setError(error instanceof Error ? error.message : '删除公告失败');
    }
  };

  const startEdit = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    setForm({
      title: announcement.title,
      content: announcement.content,
      version: announcement.version,
      type: announcement.type
    });
    setShowEditForm(true);
    setError(null);
    setSuccess(null);
  };

  const cancelEdit = () => {
    setShowEditForm(false);
    setEditingAnnouncement(null);
    setForm({ title: '', content: '', version: '', type: 'info' });
    setError(null);
  };

  const getTypeText = (type: string) => {
    const typeMap = {
      info: '信息',
      success: '成功',
      warning: '警告',
      error: '错误'
    };
    return typeMap[type as keyof typeof typeMap] || type;
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

  const formatTime = (time: string) => {
    return new Date(time).toLocaleString('zh-CN');
  };

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex justify-center items-center py-16">
          <div className="animate-pulse text-cyber-secondary">正在加载公告数据...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto pb-32">
      {/* 统计信息卡片 */}
      {stats && (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-cyber-bg border-2 border-cyber-primary/30 rounded-lg p-4">
            <div className="flex items-center">
              <BarChart3 className="w-8 h-8 text-cyber-primary mr-3" />
              <div>
                <p className="text-cyber-secondary text-sm">总公告数</p>
                <p className="text-2xl font-bold text-cyber-text">{stats.total_announcements}</p>
              </div>
            </div>
          </div>
          <div className="bg-cyber-bg border-2 border-cyber-primary/30 rounded-lg p-4">
            <div className="flex items-center">
              <BarChart3 className="w-8 h-8 text-green-400 mr-3" />
              <div>
                <p className="text-cyber-secondary text-sm">活跃公告数</p>
                <p className="text-2xl font-bold text-cyber-text">{stats.active_announcements}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 成功提示 */}
      {success && (
        <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center">
          <div className="w-5 h-5 bg-green-400 rounded-full mr-3 flex-shrink-0"></div>
          <span className="text-green-400">{success}</span>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center">
          <AlertCircle className="w-5 h-5 text-red-400 mr-3 flex-shrink-0" />
          <span className="text-red-400">{error}</span>
          <button 
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex justify-between items-center mb-6 pb-4 border-b-2 border-cyber-primary/30">
        <h2 className="text-2xl font-bold text-cyber-text">公告管理</h2>
        <button
          onClick={() => setShowCreateForm(true)}
          className="bg-cyber-primary hover:bg-cyber-hover-primary text-cyber-bg-darker px-4 py-2 rounded-lg font-semibold flex items-center transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          发布公告
        </button>
      </div>

      <div className="space-y-4">
        {(announcements?.length || 0) === 0 ? (
          <div className="text-center py-16">
            <div className="text-cyber-secondary mb-4">暂无公告</div>
            <button
              onClick={() => setShowCreateForm(true)}
              className="bg-cyber-primary hover:bg-cyber-hover-primary text-cyber-bg-darker px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              创建第一个公告
            </button>
          </div>
        ) : (
          (announcements || []).map(announcement => (
            <div key={announcement.id} className="bg-cyber-bg border-2 border-cyber-primary/30 rounded-lg overflow-hidden hover:border-cyber-primary/50 transition-colors">
              <div className="p-4 bg-cyber-primary/5 border-b border-cyber-primary/30 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-cyber-text">{announcement.title}</h3>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-cyber-secondary bg-cyber-primary/10 px-2 py-1 rounded">
                    ID: {announcement.id.slice(0, 8)}...
                  </span>
                  <button
                    onClick={() => startEdit(announcement)}
                    className="text-cyber-primary hover:text-cyber-hover-primary p-2 rounded transition-colors"
                    title="编辑公告"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteAnnouncement(announcement.id, announcement.title)}
                    className="text-red-400 hover:text-red-300 p-2 rounded transition-colors"
                    title="删除公告"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap gap-3 mb-4 text-sm">
                  <div className="flex items-center text-cyber-primary">
                    <Tag className="w-4 h-4 mr-1" />
                    版本 {announcement.version}
                  </div>
                  <div className={`px-2 py-1 rounded border ${getTypeStyle(announcement.type)}`}>
                    {getTypeText(announcement.type)}
                  </div>
                  <div className="flex items-center text-cyber-secondary">
                    <Calendar className="w-4 h-4 mr-1" />
                    {formatTime(announcement.createdAt)}
                  </div>
                </div>
                <div className="text-cyber-text leading-relaxed whitespace-pre-wrap">
                  {announcement.content}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 创建公告表单 */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50" onClick={() => setShowCreateForm(false)}>
          <div className="bg-cyber-bg-darker border-2 border-cyber-primary rounded-lg w-[90%] max-w-2xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-cyber-primary/30">
              <h3 className="text-xl font-bold text-cyber-text">发布新公告</h3>
            </div>
            <form onSubmit={createAnnouncement} className="p-6 space-y-4 max-h-96 overflow-y-auto">
              <div>
                <label className="block text-cyber-text font-medium mb-2">标题 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  className="w-full p-3 bg-cyber-bg border-2 border-cyber-primary/30 rounded-lg text-cyber-text focus:border-cyber-primary outline-none"
                  placeholder="请输入公告标题"
                  required
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-cyber-text font-medium mb-2">版本号 *</label>
                  <input
                    type="text"
                    value={form.version}
                    onChange={e => setForm({ ...form, version: e.target.value })}
                    placeholder="例如: 1.2.0"
                    className="w-full p-3 bg-cyber-bg border-2 border-cyber-primary/30 rounded-lg text-cyber-text focus:border-cyber-primary outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-cyber-text font-medium mb-2">类型 *</label>
                  <select
                    value={form.type}
                    onChange={e => setForm({ ...form, type: e.target.value as any })}
                    className="w-full p-3 bg-cyber-bg border-2 border-cyber-primary/30 rounded-lg text-cyber-text focus:border-cyber-primary outline-none"
                    required
                  >
                    <option value="info">信息</option>
                    <option value="success">成功</option>
                    <option value="warning">警告</option>
                    <option value="error">错误</option>
                  </select>
                </div>
              </div>
              
              <div>
                <label className="block text-cyber-text font-medium mb-2">内容 *</label>
                <textarea
                  value={form.content}
                  onChange={e => setForm({ ...form, content: e.target.value })}
                  rows={6}
                  className="w-full p-3 bg-cyber-bg border-2 border-cyber-primary/30 rounded-lg text-cyber-text focus:border-cyber-primary outline-none resize-none"
                  placeholder="请输入公告内容..."
                  required
                />
              </div>
            </form>
            
            <div className="p-6 border-t border-cyber-primary/30 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setError(null);
                }}
                className="px-4 py-2 text-cyber-secondary hover:text-cyber-text transition-colors"
              >
                取消
              </button>
              <button
                onClick={createAnnouncement}
                disabled={creating}
                className="bg-cyber-primary hover:bg-cyber-hover-primary text-cyber-bg-darker px-6 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? '发布中...' : '发布公告'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑公告表单 */}
      {showEditForm && editingAnnouncement && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50" onClick={cancelEdit}>
          <div className="bg-cyber-bg-darker border-2 border-cyber-primary rounded-lg w-[90%] max-w-2xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-cyber-primary/30">
              <h3 className="text-xl font-bold text-cyber-text">编辑公告</h3>
              <p className="text-sm text-cyber-secondary mt-1">ID: {editingAnnouncement.id}</p>
            </div>
            <form onSubmit={updateAnnouncement} className="p-6 space-y-4 max-h-96 overflow-y-auto">
              <div>
                <label className="block text-cyber-text font-medium mb-2">标题 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  className="w-full p-3 bg-cyber-bg border-2 border-cyber-primary/30 rounded-lg text-cyber-text focus:border-cyber-primary outline-none"
                  placeholder="请输入公告标题"
                  required
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-cyber-text font-medium mb-2">版本号 *</label>
                  <input
                    type="text"
                    value={form.version}
                    onChange={e => setForm({ ...form, version: e.target.value })}
                    placeholder="例如: 1.2.0"
                    className="w-full p-3 bg-cyber-bg border-2 border-cyber-primary/30 rounded-lg text-cyber-text focus:border-cyber-primary outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-cyber-text font-medium mb-2">类型 *</label>
                  <select
                    value={form.type}
                    onChange={e => setForm({ ...form, type: e.target.value as any })}
                    className="w-full p-3 bg-cyber-bg border-2 border-cyber-primary/30 rounded-lg text-cyber-text focus:border-cyber-primary outline-none"
                    required
                  >
                    <option value="info">信息</option>
                    <option value="success">成功</option>
                    <option value="warning">警告</option>
                    <option value="error">错误</option>
                  </select>
                </div>
              </div>
              
              <div>
                <label className="block text-cyber-text font-medium mb-2">内容 *</label>
                <textarea
                  value={form.content}
                  onChange={e => setForm({ ...form, content: e.target.value })}
                  rows={6}
                  className="w-full p-3 bg-cyber-bg border-2 border-cyber-primary/30 rounded-lg text-cyber-text focus:border-cyber-primary outline-none resize-none"
                  placeholder="请输入公告内容..."
                  required
                />
              </div>
            </form>
            
            <div className="p-6 border-t border-cyber-primary/30 flex justify-end space-x-3">
              <button
                type="button"
                onClick={cancelEdit}
                className="px-4 py-2 text-cyber-secondary hover:text-cyber-text transition-colors"
              >
                取消
              </button>
              <button
                onClick={updateAnnouncement}
                disabled={updating}
                className="bg-cyber-primary hover:bg-cyber-hover-primary text-cyber-bg-darker px-6 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updating ? '更新中...' : '更新公告'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnnouncementManageView;
