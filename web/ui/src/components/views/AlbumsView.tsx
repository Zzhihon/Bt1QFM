import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Album, CreateAlbumRequest } from '../../types';
import { Plus, Disc, Music2, Edit2, Trash2 } from 'lucide-react';

const AlbumsView: React.FC = () => {
  const { currentUser, authToken } = useAuth();
  const { addToast } = useToast();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAlbum, setNewAlbum] = useState<CreateAlbumRequest>({
    artist: '',
    name: '',
    genre: '',
    description: '',
  });

  useEffect(() => {
    if (currentUser) {
      fetchAlbums();
    }
  }, [currentUser]);

  const fetchAlbums = async () => {
    try {
      const response = await fetch('/api/albums', {
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch albums');
      }

      const data = await response.json();
      setAlbums(data.albums);
    } catch (error) {
      console.error('Error fetching albums:', error);
      addToast('获取专辑列表失败', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/albums', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        },
        body: JSON.stringify(newAlbum)
      });

      if (!response.ok) {
        throw new Error('Failed to create album');
      }

      const data = await response.json();
      setAlbums(prev => [...prev, data.album]);
      setShowCreateForm(false);
      setNewAlbum({
        artist: '',
        name: '',
        genre: '',
        description: '',
      });
      addToast('专辑创建成功', 'success');
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
    <div className="container mx-auto p-4 min-h-[calc(100vh-100px)] pb-32">
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
                className="px-4 py-2 bg-cyber-primary text-cyber-bg-darker rounded hover:bg-cyber-hover-primary transition-colors"
              >
                创建
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {albums.map((album) => (
          <div
            key={album.id}
            className="bg-cyber-bg-darker border-2 border-cyber-secondary rounded-lg overflow-hidden shadow-lg transition-all duration-300 hover:shadow-xl hover:scale-[1.02]"
          >
            <div className="aspect-square bg-cyber-bg relative overflow-hidden">
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
                  onClick={() => window.location.href = `/album/${album.id}`}
                  className="flex items-center px-3 py-1 rounded-full text-sm font-medium bg-cyber-primary text-cyber-bg-darker hover:bg-cyber-hover-primary transition-colors"
                >
                  <Music2 className="mr-1 h-4 w-4" /> 查看详情
                </button>
                <div className="flex space-x-2">
                  <button
                    onClick={() => window.location.href = `/album/${album.id}/edit`}
                    className="p-1 rounded-full text-cyber-secondary hover:text-cyber-primary transition-colors"
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