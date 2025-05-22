import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Album, Track } from '../../types';
import { Music2, Trash2, Upload, Plus } from 'lucide-react';
import UploadForm from '../upload/UploadForm';
import TrackListItem from '../common/TrackListItem';

const AlbumDetailView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { currentUser, authToken } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [album, setAlbum] = useState<Album | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadMode, setUploadMode] = useState<'single' | 'batch'>('single');
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => {
    if (id) {
      fetchAlbumDetails();
      fetchAlbumTracks();
    }
  }, [id]);

  const fetchAlbumDetails = async () => {
    try {
      const response = await fetch(`/api/albums/${id}`, {
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });

      if (!response.ok) {
        throw new Error('获取专辑详情失败');
      }

      const data = await response.json();
      if (data && typeof data === 'object') {
        const albumData = data.album || data;
        if (albumData.tracks && !Array.isArray(albumData.tracks)) {
          albumData.tracks = [];
        }
        setAlbum(albumData);
      } else {
        throw new Error('无效的专辑数据格式');
      }
    } catch (error) {
      console.error('Error fetching album details:', error);
      addToast('获取专辑详情失败', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAlbumTracks = async () => {
    try {
      const response = await fetch(`/api/albums/${id}/tracks`, {
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });
      if (!response.ok) {
        throw new Error('获取专辑歌曲失败');
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        setTracks(data);
      } else if (data && Array.isArray(data.tracks)) {
        setTracks(data.tracks);
      } else {
        setTracks([]);
      }
    } catch (error) {
      console.error('Error fetching album tracks:', error);
      addToast('获取专辑歌曲失败', 'error');
    }
  };

  const handleRemoveTrack = async (trackId: number) => {
    if (!album || !id) return;

    try {
      const response = await fetch(`/api/albums/${Number(id)}/tracks/${trackId}`, {
        method: 'DELETE',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });

      if (!response.ok) {
        throw new Error('删除歌曲失败');
      }

      addToast('歌曲已删除', 'success');
      fetchAlbumTracks();
    } catch (error) {
      console.error('Error removing track:', error);
      addToast('删除歌曲失败', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyber-primary"></div>
      </div>
    );
  }

  if (!album) {
    return (
      <div className="text-center py-8">
        <p className="text-cyber-secondary">专辑不存在或已被删除</p>
      </div>
    );
  }

  const albumName = String(album.name || '');
  const artistName = String(album.artist || '');
  const genre = String(album.genre || '未分类');
  const description = String(album.description || '暂无简介');
  const releaseTime = album.releaseTime ? new Date(album.releaseTime).toLocaleDateString() : '未知';

  return (
    <div className="container mx-auto p-4 min-h-[calc(100vh-100px)] pb-32">
      <div className="space-y-6">
        <div className="bg-cyber-bg-darker border-2 border-cyber-secondary rounded-lg p-6">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="w-full md:w-1/3 aspect-square bg-cyber-bg rounded-lg overflow-hidden">
              {album.coverPath ? (
                <img
                  src={String(album.coverPath)}
                  alt={albumName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-cyber-bg bg-opacity-60">
                  <Music2 className="w-16 h-16 text-cyber-primary opacity-70" />
                </div>
              )}
            </div>
            <div className="flex-1 space-y-4">
              <div>
                <h1 className="text-3xl font-bold text-cyber-primary">{albumName}</h1>
                <p className="text-xl text-cyber-secondary">{artistName}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-cyber-muted">流派</p>
                  <p className="text-cyber-secondary">{genre}</p>
                </div>
                <div>
                  <p className="text-sm text-cyber-muted">发行时间</p>
                  <p className="text-cyber-secondary">{releaseTime}</p>
                </div>
              </div>
              <div>
                <p className="text-sm text-cyber-muted">简介</p>
                <p className="text-cyber-secondary whitespace-pre-wrap">{description}</p>
              </div>
              <div className="flex justify-between items-center">
                <button
                  onClick={() => navigate(`/album/${album.id}/edit`)}
                  className="px-4 py-2 text-cyber-bg-darker rounded hover:bg-cyber-hover-primary transition-colors"
                  style={{ backgroundColor: 'rgb(55, 41, 99)' }}
                >
                  编辑专辑
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-cyber-bg-darker border-2 border-cyber-secondary rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-cyber-primary">歌曲列表</h2>
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  setUploadMode('single');
                  setShowUploadModal(true);
                }}
                className="flex items-center px-4 py-2 text-cyber-bg-darker rounded hover:bg-cyber-hover-primary transition-colors"
                style={{ backgroundColor: 'rgb(55, 41, 99)' }}
              >
                <Plus className="mr-2 h-5 w-5" /> 添加单曲
              </button>
              <button
                onClick={() => {
                  setUploadMode('batch');
                  setShowUploadModal(true);
                }}
                className="flex items-center px-4 py-2 text-cyber-bg-darker rounded hover:bg-cyber-hover-primary transition-colors"
                style={{ backgroundColor: 'rgb(55, 41, 99)' }}
              >
                <Upload className="mr-2 h-5 w-5" /> 批量上传
              </button>
            </div>
          </div>
          {tracks && tracks.length > 0 ? (
            <div className="space-y-2">
              {tracks.map((track) => (
                <div key={track.id} className="relative group">
                  <TrackListItem track={{ ...track, coverArtPath: track.coverArtPath || album?.coverPath }} />
                  <button
                    onClick={() => handleRemoveTrack(Number(track.id))}
                    className="absolute top-1 right-1 p-2 text-cyber-secondary hover:text-cyber-red transition-colors opacity-0 group-hover:opacity-100 bg-cyber-bg-darker rounded-full z-10"
                    title="删除歌曲"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-cyber-secondary mb-4">这个专辑还没有歌曲</p>
            </div>
          )}
        </div>
      </div>

      {showUploadModal && album && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-cyber-bg-darker p-6 rounded-lg w-full max-w-md">
            <h2 className="text-2xl font-bold text-cyber-primary mb-4">
              {uploadMode === 'single' ? '添加单曲' : '批量上传'}
            </h2>
            <UploadForm
              albumId={Number(album.id)}
              isBatch={uploadMode === 'batch'}
              onUploadSuccess={() => {
                setShowUploadModal(false);
                fetchAlbumTracks();
              }}
              onCancel={() => setShowUploadModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default AlbumDetailView; 