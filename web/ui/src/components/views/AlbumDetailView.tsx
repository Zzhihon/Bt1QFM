import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { usePlayer } from '../../contexts/PlayerContext';
import { Album, Track } from '../../types';
import { UploadCloud, Music2, PlayCircle, PauseCircle, Plus, Trash2, ArrowLeft } from 'lucide-react';
import UploadForm from '../upload/UploadForm';

const AlbumDetailView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser, authToken } = useAuth();
  const { addToast } = useToast();
  const { playTrack, playerState } = usePlayer();
  
  const [album, setAlbum] = useState<Album | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showUploadForm, setShowUploadForm] = useState(false);

  useEffect(() => {
    if (currentUser && id) {
      fetchAlbumDetails();
    }
  }, [currentUser, id]);

  const fetchAlbumDetails = async () => {
    try {
      const response = await fetch(`/api/albums/${id}`, {
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch album details');
      }

      const data = await response.json();
      setAlbum(data.album);
    } catch (error) {
      console.error('Error fetching album details:', error);
      addToast('获取专辑详情失败', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveTrack = async (trackId: number) => {
    if (!window.confirm('确定要从专辑中移除这首歌吗？')) return;

    try {
      const response = await fetch(`/api/albums/${id}/tracks/${trackId}`, {
        method: 'DELETE',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });

      if (!response.ok) {
        throw new Error('Failed to remove track from album');
      }

      // 更新本地状态
      setAlbum(prev => {
        if (!prev) return null;
        return {
          ...prev,
          tracks: prev.tracks?.filter(track => track.id !== trackId)
        };
      });

      addToast('歌曲已从专辑中移除', 'success');
    } catch (error) {
      console.error('Error removing track from album:', error);
      addToast('移除歌曲失败', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-150px)] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyber-primary"></div>
      </div>
    );
  }

  if (!album) {
    return (
      <div className="min-h-[calc(100vh-150px)] flex items-center justify-center text-cyber-red">
        专辑不存在或已被删除
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 min-h-[calc(100vh-100px)] pb-32">
      <button
        onClick={() => navigate('/albums')}
        className="flex items-center text-cyber-secondary hover:text-cyber-primary mb-6 transition-colors"
      >
        <ArrowLeft className="mr-2 h-5 w-5" /> 返回专辑列表
      </button>

      <div className="bg-cyber-bg-darker rounded-lg p-6 mb-8 border-2 border-cyber-primary">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="w-full md:w-1/3">
            <div className="aspect-square bg-cyber-bg rounded-lg overflow-hidden">
              {album.coverPath ? (
                <img
                  src={album.coverPath}
                  alt={album.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-cyber-bg bg-opacity-60">
                  <Music2 className="w-16 h-16 text-cyber-primary opacity-70" />
                </div>
              )}
            </div>
          </div>
          <div className="w-full md:w-2/3">
            <h1 className="text-4xl font-bold text-cyber-primary mb-4">{album.name}</h1>
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-cyber-secondary">艺术家</h2>
                <p className="text-cyber-text">{album.artist}</p>
              </div>
              {album.genre && (
                <div>
                  <h2 className="text-lg font-semibold text-cyber-secondary">风格</h2>
                  <p className="text-cyber-text">{album.genre}</p>
                </div>
              )}
              {album.description && (
                <div>
                  <h2 className="text-lg font-semibold text-cyber-secondary">描述</h2>
                  <p className="text-cyber-text">{album.description}</p>
                </div>
              )}
              {album.releaseTime && (
                <div>
                  <h2 className="text-lg font-semibold text-cyber-secondary">发行时间</h2>
                  <p className="text-cyber-text">{new Date(album.releaseTime).toLocaleDateString()}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-cyber-primary">专辑歌曲</h2>
        <button
          onClick={() => setShowUploadForm(!showUploadForm)}
          className="flex items-center bg-cyber-primary text-cyber-bg-darker px-4 py-2 rounded-lg hover:bg-cyber-hover-primary transition-colors"
        >
          <UploadCloud className="mr-2 h-5 w-5" /> 上传歌曲
        </button>
      </div>

      {showUploadForm && (
        <div className="mb-8">
          <UploadForm
            albumId={album.id}
            onUploadSuccess={() => {
              setShowUploadForm(false);
              fetchAlbumDetails();
            }}
            onCancel={() => setShowUploadForm(false)}
          />
        </div>
      )}

      <div className="space-y-4">
        {album.tracks && album.tracks.length > 0 ? (
          album.tracks.map((track) => {
            const isCurrentlyPlaying = playerState.currentTrack?.id === track.id && playerState.isPlaying;
            
            return (
              <div
                key={track.id}
                className="flex items-center justify-between p-4 bg-cyber-bg-darker rounded-lg border-2 border-cyber-secondary hover:border-cyber-primary transition-colors"
              >
                <div className="flex items-center space-x-4">
                  <button
                    onClick={() => playTrack(track)}
                    className="text-cyber-primary hover:text-cyber-hover-primary transition-colors"
                  >
                    {isCurrentlyPlaying ? (
                      <PauseCircle className="h-8 w-8" />
                    ) : (
                      <PlayCircle className="h-8 w-8" />
                    )}
                  </button>
                  <div>
                    <h3 className="text-lg font-semibold text-cyber-primary">{track.title}</h3>
                    <p className="text-sm text-cyber-secondary">{track.artist || album.artist}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <button
                    onClick={() => handleRemoveTrack(track.id)}
                    className="p-2 text-cyber-secondary hover:text-cyber-red transition-colors"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-8 text-cyber-muted">
            这个专辑还没有歌曲，点击"上传歌曲"按钮添加歌曲
          </div>
        )}
      </div>
    </div>
  );
};

export default AlbumDetailView; 