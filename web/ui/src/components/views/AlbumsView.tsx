import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Album, CreateAlbumRequest } from '../../types';
import { Plus, Disc, Music2, Edit2, Trash2, UploadCloud, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const AlbumsView: React.FC = () => {
  const { currentUser, authToken } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAlbum, setNewAlbum] = useState<CreateAlbumRequest>({
    artist: '',
    name: '',
    genre: '',
    description: '',
    releaseTime: new Date().toISOString().split('T')[0],
  });
  const [selectedCover, setSelectedCover] = useState<File | null>(null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);

  useEffect(() => {
    if (currentUser) {
      fetchAlbums();
    }
  }, [currentUser]);

  const fetchAlbums = async () => {
    try {
      const response = await fetch('/api/albums', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch albums');
      }

      const data = await response.json();
      if (!data || !Array.isArray(data)) {
        console.error('Invalid response format:', data);
        throw new Error('Invalid response format');
      }
      
      setAlbums(data);
    } catch (error) {
      console.error('Error fetching albums:', error);
      addToast(error instanceof Error ? error.message : '获取专辑列表失败', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCoverUpload = async (file: File) => {
    if (!file) return null;
    
    setIsUploadingCover(true);
    try {
      const formData = new FormData();
      formData.append('cover', file);
      formData.append('artist', newAlbum.artist);
      formData.append('album', newAlbum.name);
      formData.append('targetDir', 'static/cover');

      const response = await fetch('/api/upload/cover', {
        method: 'POST',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error('Failed to upload cover');
      }

      const data = await response.json();
      return data.coverPath;
    } catch (error) {
      console.error('Error uploading cover:', error);
      addToast('封面上传失败', 'error');
      return null;
    } finally {
      setIsUploadingCover(false);
    }
  };

  const handleCreateAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let coverPath = '';
      if (selectedCover) {
        coverPath = await handleCoverUpload(selectedCover) || '';
      }

      const albumData = {
        ...newAlbum,
        coverPath,
        releaseTime: newAlbum.releaseTime ? new Date(newAlbum.releaseTime).toISOString() : new Date().toISOString()
      };

      const response = await fetch('/api/albums', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        },
        body: JSON.stringify(albumData)
      });

      if (!response.ok) {
        throw new Error('Failed to create album');
      }

      const data = await response.json();
      setAlbums(prev => [...prev, data.album || data]);
      setShowCreateForm(false);
      setNewAlbum({
        artist: '',
        name: '',
        genre: '',
        description: '',
        releaseTime: new Date().toISOString().split('T')[0],
      });
      setSelectedCover(null);
      addToast('专辑创建成功', 'success');
      const albumId = (data.album && data.album.id) || data.id;
      if (albumId) {
        navigate(`/album/${albumId}`);
      }
    } catch (error) {
      console.error('Error creating album:', error);
      addToast('创建专辑失败', 'error');
    }
  };

  const handleDeleteAlbum = async (albumId: number) => {
    if (!window.confirm('确定要删除这个专辑吗？')) return;

    try {
      const response = await fetch(`/api/albums/${albumId}`, {
        method: 'DELETE',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });

      if (!response.ok) {
        throw new Error('Failed to delete album');
      }

      setAlbums(prev => prev.filter(album => album.id !== albumId));
      addToast('专辑删除成功', 'success');
    } catch (error) {
      console.error('Error deleting album:', error);
      addToast('删除专辑失败', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-150px)] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyber-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 min-h-[calc(100vh-100px)] pb-32 max-w-7xl">
      <header className="my-8 text-center">
        <h1 className="text-5xl font-bold text-cyber-primary animate-pulse">专辑管理</h1>
        <p className="text-cyber-secondary mt-2">管理你的音乐专辑</p>
      </header>

      <div className="flex justify-end mb-6">
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center bg-cyber-primary text-cyber-bg-darker px-4 py-2 rounded-lg hover:bg-cyber-hover-primary transition-colors"
        >
          <Plus className="mr-2 h-5 w-5" /> 创建新专辑
        </button>
      </div>

      {showCreateForm && (
        <div className="mb-8 p-6 bg-cyber-bg-darker rounded-lg border-2 border-cyber-primary">
          <h2 className="text-2xl font-bold text-cyber-primary mb-4">创建新专辑</h2>
          <form onSubmit={handleCreateAlbum} className="space-y-4">
            <div>
              <label className="block text-cyber-secondary mb-2">艺术家</label>
              <input
                type="text"
                value={newAlbum.artist}
                onChange={(e) => setNewAlbum(prev => ({ ...prev, artist: e.target.value }))}
                className="w-full p-2 bg-cyber-bg border-2 border-cyber-secondary rounded text-cyber-text"
                required
              />
            </div>
            <div>
              <label className="block text-cyber-secondary mb-2">专辑名称</label>
              <input
                type="text"
                value={newAlbum.name}
                onChange={(e) => setNewAlbum(prev => ({ ...prev, name: e.target.value }))}
                className="w-full p-2 bg-cyber-bg border-2 border-cyber-secondary rounded text-cyber-text"
                required
              />
            </div>
            <div>
              <label className="block text-cyber-secondary mb-2">风格</label>
              <input
                type="text"
                value={newAlbum.genre}
                onChange={(e) => setNewAlbum(prev => ({ ...prev, genre: e.target.value }))}
                className="w-full p-2 bg-cyber-bg border-2 border-cyber-secondary rounded text-cyber-text"
              />
            </div>
            <div>
              <label className="block text-cyber-secondary mb-2">发行日期</label>
              <input
                type="date"
                value={newAlbum.releaseTime}
                onChange={(e) => setNewAlbum(prev => ({ ...prev, releaseTime: e.target.value }))}
                className="w-full p-2 bg-cyber-bg border-2 border-cyber-secondary rounded text-cyber-text"
                required
              />
            </div>
            <div>
              <label className="block text-cyber-secondary mb-2">封面图片</label>
              <div className="flex items-center space-x-4">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setSelectedCover(e.target.files?.[0] || null)}
                  className="hidden"
                  id="cover-upload"
                />
                <label
                  htmlFor="cover-upload"
                  className="flex items-center px-4 py-2 bg-cyber-secondary text-cyber-bg-darker rounded cursor-pointer hover:bg-cyber-hover-secondary transition-colors"
                >
                  <UploadCloud className="mr-2 h-5 w-5" />
                  {selectedCover ? '更换封面' : '选择封面'}
                </label>
                {selectedCover && (
                  <span className="text-cyber-text">
                    {selectedCover.name}
                  </span>
                )}
              </div>
            </div>
            <div>
              <label className="block text-cyber-secondary mb-2">描述</label>
              <textarea
                value={newAlbum.description}
                onChange={(e) => setNewAlbum(prev => ({ ...prev, description: e.target.value }))}
                className="w-full p-2 bg-cyber-bg border-2 border-cyber-secondary rounded text-cyber-text"
                rows={3}
              />
            </div>
            <div className="flex justify-end space-x-4">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 bg-cyber-bg text-cyber-secondary rounded hover:bg-cyber-hover-secondary transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isUploadingCover}
                className={`px-4 py-2 bg-cyber-primary text-cyber-bg-darker rounded hover:bg-cyber-hover-primary transition-colors ${isUploadingCover ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isUploadingCover ? '上传中...' : '创建'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {albums.map((album) => (
          <div
            key={album.id}
            className="bg-cyber-bg-darker border-2 border-cyber-secondary rounded-lg overflow-hidden shadow-lg transition-all duration-300 hover:shadow-xl hover:scale-[1.02]"
          >
            <div className="aspect-[4/5] bg-cyber-bg relative overflow-hidden">
              {album.coverPath ? (
                <img
                  src={album.coverPath}
                  alt={album.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-cyber-bg bg-opacity-60">
                  <Disc className="w-16 h-16 text-cyber-primary opacity-70" />
                </div>
              )}
            </div>
            <div className="p-4">
              <h3 className="text-lg font-semibold text-cyber-primary truncate">{album.name}</h3>
              <p className="text-sm text-cyber-secondary truncate">{album.artist}</p>
              <p className="text-xs text-cyber-muted truncate">{album.genre || '未分类'}</p>
              
                <div className="mt-4 flex justify-between items-center">
                  <button
                    onClick={() => navigate(`/album/${album.id}`)}
                    className="flex items-center px-3 py-1 rounded-full text-sm font-medium bg-[#2563eb] text-white hover:bg-[#1d4ed8] transition-colors"
                  >
                  <Music2 className="mr-1 h-4 w-4" /> 查看详情
                </button>
                <div className="flex space-x-2">
                    <button
                      onClick={() => navigate(`/album/${album.id}/edit`)}
                      className="p-1 rounded-full text-[#2563eb] hover:text-[#1d4ed8] transition-colors"
                    >
                    <Edit2 className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleDeleteAlbum(album.id)}
                    className="p-1 rounded-full text-cyber-secondary hover:text-cyber-red transition-colors"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AlbumsView; 