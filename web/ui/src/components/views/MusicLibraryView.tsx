import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePlayer } from '../../contexts/PlayerContext';
import { Track } from '../../types';
import { AlertTriangle, UploadCloud, Music2, PlayCircle, PauseCircle, ListMusic, Plus, Loader2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';

const MusicLibraryView: React.FC = () => {
  const { currentUser, authToken } = useAuth();
  const { 
    playerState, 
    playTrack, 
    addToPlaylist,
    showPlaylist, 
    setShowPlaylist 
  } = usePlayer();
  
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload form state
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [showBatchUploadForm, setShowBatchUploadForm] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { addToast } = useToast();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [trackFile, setTrackFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      setIsLoading(false);
      setError('Please login to view your music library.');
      setTracks([]);
      return;
    }
    fetchTracks();
  }, [currentUser]);

  const fetchTracks = async () => {
    if (!currentUser) {
      setError('User not authenticated to fetch tracks.');
      setIsLoading(false);
      setTracks([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      console.log('Fetching tracks from /api/tracks with token:', authToken?.substring(0, 20) + "...");
      const response = await fetch('/api/tracks', { // Ensure this matches your backend endpoint
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = { error: response.statusText }; 
        }
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      let fetchedTracks: Track[] = await response.json();
      
      fetchedTracks = fetchedTracks.map(track => {
        // Ensure that an empty string from the backend is treated as undefined for consistent UI rendering
        const finalCoverArtPath = track.coverArtPath === "" ? undefined : track.coverArtPath;

        return {
          ...track,
          hlsPlaylistUrl: track.hlsPlaylistUrl || (track.id ? `/stream/${track.id}/playlist.m3u8` : undefined),
          coverArtPath: finalCoverArtPath 
        };
      });

      console.log("Processed fetched tracks with cover paths:", fetchedTracks);
      setTracks(fetchedTracks);

    } catch (err: any) {
      console.error("Failed to fetch tracks:", err);
      setError(err.message || 'Failed to load tracks. Please try again later.');
      setTracks([]);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackFile || !title) {
      setUploadError("Title and Track File are required.");
      return;
    }
    if (!currentUser) {
        setUploadError("You must be logged in to upload tracks.");
        return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    const formData = new FormData();
    formData.append('title', title);
    formData.append('artist', artist);
    formData.append('album', album);
    formData.append('trackFile', trackFile); // Backend should handle this as `multipart.FileHeader`
    if (coverFile) {
      formData.append('coverFile', coverFile); // Backend should handle this as `multipart.FileHeader`
    }
    // If your backend expects userId in the form data for associating tracks:
    // formData.append('userId', String(currentUser.id));

    try {
      console.log('Uploading track to /api/upload with token:', authToken?.substring(0,20) + "...");
      const response = await fetch('/api/upload', { // Ensure this matches your backend endpoint
        method: 'POST',
        body: formData,
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
          // For FormData, the browser automatically sets the 'Content-Type' to 'multipart/form-data' with the correct boundary.
          // Do NOT explicitly set 'Content-Type': 'application/json' or 'multipart/form-data' here.
        }
      });

      const result = await response.json(); // Expecting JSON response like UploadResponse or an error structure

      if (!response.ok) {
        throw new Error(result.error || result.message || `Upload failed with status ${response.status}`);
      }

      console.log("Upload successful, server response:", result);
      setUploadSuccess(result.message || `Track '${result.title || title}' uploaded successfully!`);
      
      // Optimistically add to track list or re-fetch
      // For simplicity, re-fetching is often easier unless you have all track details from upload response.
      fetchTracks(); 
      
      // Reset form and optionally close it
      setTitle('');
      setArtist('');
      setAlbum('');
      setTrackFile(null);
      setCoverFile(null);
      // setShowUploadForm(false); // Uncomment to close form on success

    } catch (err: any) {
      console.error("Upload error:", err);
      setUploadError(err.message || 'An error occurred during upload. Check console for details.');
    } finally {
      setUploading(false);
    }
  };

  // 批量上传处理函数
  const handleBatchUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);

    const artist = formData.get('artist') as string;
    const album = formData.get('album') as string;
    const coverFile = formData.get('cover') as File;
    const audioFiles = formData.getAll('audioFiles') as File[];

    if (!artist || !album || !coverFile || audioFiles.length === 0) {
      addToast('请填写所有必要信息', 'error');
      return;
    }

    setIsLoading(true);
    setUploadProgress(0);

    try {
      // 1. 先上传封面
      const coverFormData = new FormData();
      coverFormData.append('cover', coverFile);
      coverFormData.append('artist', artist);
      coverFormData.append('album', album);

      const coverResponse = await fetch('/api/upload/cover', {
        method: 'POST',
        body: coverFormData,
      });

      if (!coverResponse.ok) {
        throw new Error('Failed to upload cover');
      }

      const coverData = await coverResponse.json();
      const coverPath = coverData.coverPath;

      // 2. 批量上传音频文件
      const totalFiles = audioFiles.length;
      let uploadedCount = 0;

      for (const audioFile of audioFiles) {
        const audioFormData = new FormData();
        audioFormData.append('trackFile', audioFile);
        audioFormData.append('artist', artist);
        audioFormData.append('album', album);
        audioFormData.append('title', audioFile.name.replace(/\.[^/.]+$/, '')); // 使用文件名作为标题
        audioFormData.append('coverPath', coverPath);

        const audioResponse = await fetch('/api/upload', {
          method: 'POST',
          body: audioFormData,
        });

        if (!audioResponse.ok) {
          throw new Error(`Failed to upload ${audioFile.name}`);
        }

        uploadedCount++;
        setUploadProgress((uploadedCount / totalFiles) * 100);
      }

      addToast('专辑上传成功！', 'success');
      setShowBatchUploadForm(false);
      fetchTracks(); // 刷新音乐列表
    } catch (error) {
      console.error('Upload error:', error);
      addToast('上传失败，请重试', 'error');
    } finally {
      setIsLoading(false);
      setUploadProgress(0);
    }
  };

  if (isLoading) {
    return <div className="min-h-[calc(100vh-150px)] flex items-center justify-center p-4 text-cyber-primary text-xl">Loading music library...</div>;
  }

  if (error) {
    return (
      <div className="min-h-[calc(100vh-150px)] flex flex-col items-center justify-center p-4 text-cyber-red">
        <AlertTriangle className="h-12 w-12 mb-4" />
        <p className="text-xl">{error}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 min-h-[calc(100vh-100px)] pb-32">
      <header className="my-8 text-center">
        <h1 className="text-5xl font-bold text-cyber-primary animate-pulse">Music Matrix</h1>
        <p className="text-cyber-secondary mt-2">Your digital soundscape awaits.</p>
      </header>

      <div className="flex justify-end mb-6 space-x-4">
        {currentUser && (
          <>
            <button 
              onClick={() => setShowPlaylist(!showPlaylist)}
              className={`flex items-center ${showPlaylist ? 'bg-cyber-primary text-cyber-bg-darker' : 'bg-cyber-bg-darker text-cyber-secondary'} hover:bg-cyber-hover-secondary font-semibold py-2 px-4 rounded-lg shadow-md transition-all duration-300 hover:scale-105 focus:outline-none focus:ring-2 ring-offset-2 ring-offset-cyber-bg ring-cyber-primary`}
            >
              <ListMusic className="mr-2 h-5 w-5" /> 播放列表
            </button>
            <button 
              onClick={() => setShowUploadForm(!showUploadForm)}
              className="flex items-center bg-cyber-secondary hover:bg-cyber-hover-secondary text-cyber-bg-darker font-semibold py-2 px-4 rounded-lg shadow-md transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 ring-offset-2 ring-offset-cyber-bg ring-cyber-primary"
            >
              <UploadCloud className="mr-2 h-5 w-5" /> {showUploadForm ? '取消上传' : '上传音乐'}
            </button>
            <button
              onClick={() => setShowBatchUploadForm(true)}
              className="bg-cyber-primary text-cyber-bg-darker px-4 py-2 rounded hover:bg-cyber-hover-primary transition-colors"
            >
              批量上传专辑
            </button>
          </>
        )}
      </div>

      {showBatchUploadForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-cyber-bg-darker p-6 rounded-lg w-full max-w-2xl">
            <h2 className="text-xl font-bold text-cyber-primary mb-4">批量上传专辑</h2>
            <form onSubmit={handleBatchUploadSubmit} className="space-y-4">
              <div>
                <label className="block text-cyber-text mb-2">艺术家</label>
                <input
                  type="text"
                  name="artist"
                  required
                  className="w-full bg-cyber-bg border border-cyber-primary text-cyber-text p-2 rounded"
                />
              </div>
              <div>
                <label className="block text-cyber-text mb-2">专辑名称</label>
                <input
                  type="text"
                  name="album"
                  required
                  className="w-full bg-cyber-bg border border-cyber-primary text-cyber-text p-2 rounded"
                />
              </div>
              <div>
                <label className="block text-cyber-text mb-2">专辑封面</label>
                <input
                  type="file"
                  name="cover"
                  accept="image/*"
                  required
                  className="w-full bg-cyber-bg border border-cyber-primary text-cyber-text p-2 rounded"
                />
              </div>
              <div>
                <label className="block text-cyber-text mb-2">音频文件（可多选）</label>
                <input
                  type="file"
                  name="audioFiles"
                  accept="audio/*"
                  multiple
                  required
                  className="w-full bg-cyber-bg border border-cyber-primary text-cyber-text p-2 rounded"
                />
              </div>
              {uploadProgress > 0 && (
                <div className="w-full bg-cyber-bg rounded-full h-2.5">
                  <div
                    className="bg-cyber-primary h-2.5 rounded-full"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              )}
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowBatchUploadForm(false)}
                  className="px-4 py-2 text-cyber-text hover:text-cyber-primary transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="bg-cyber-primary text-cyber-bg-darker px-4 py-2 rounded hover:bg-cyber-hover-primary transition-colors disabled:opacity-50"
                >
                  {isLoading ? '上传中...' : '上传'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showUploadForm && currentUser && (
        <div className="mb-8 p-6 bg-cyber-bg-darker rounded-lg shadow-xl border border-cyber-primary">
          <h3 className="text-2xl font-semibold mb-4 text-cyber-primary">Upload New Track</h3>
          <form onSubmit={handleUploadSubmit} className="space-y-4">
             <div>
                <label htmlFor="title" className="block text-sm font-medium text-cyber-secondary">Title:</label>
                <input type="text" id="title" value={title} onChange={(e) => setTitle(e.target.value)} required className="mt-1 block w-full bg-cyber-bg border border-cyber-secondary rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-cyber-primary focus:border-cyber-primary sm:text-sm placeholder-cyber-muted" />
            </div>
            <div>
                <label htmlFor="artist" className="block text-sm font-medium text-cyber-secondary">Artist:</label>
                <input type="text" id="artist" value={artist} onChange={(e) => setArtist(e.target.value)} className="mt-1 block w-full bg-cyber-bg border border-cyber-secondary rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-cyber-primary focus:border-cyber-primary sm:text-sm placeholder-cyber-muted" />
            </div>
            <div>
                <label htmlFor="album" className="block text-sm font-medium text-cyber-secondary">Album:</label>
                <input type="text" id="album" value={album} onChange={(e) => setAlbum(e.target.value)} className="mt-1 block w-full bg-cyber-bg border border-cyber-secondary rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-cyber-primary focus:border-cyber-primary sm:text-sm placeholder-cyber-muted" />
            </div>
            <div>
                <label htmlFor="trackFile" className="block text-sm font-medium text-cyber-secondary">Track File (WAV/MP3):</label>
                <input type="file" id="trackFile" onChange={(e) => setTrackFile(e.target.files ? e.target.files[0] : null)} accept=".wav,.mp3" required className="mt-1 block w-full text-sm text-cyber-text file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyber-primary file:text-cyber-bg-darker hover:file:bg-cyber-hover-primary file:cursor-pointer" />
            </div>
            <div>
                <label htmlFor="coverFile" className="block text-sm font-medium text-cyber-secondary">Cover Art (JPG, PNG):</label>
                <input type="file" id="coverFile" onChange={(e) => setCoverFile(e.target.files ? e.target.files[0] : null)} accept="image/jpeg,image/png" className="mt-1 block w-full text-sm text-cyber-text file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyber-primary file:text-cyber-bg-darker hover:file:bg-cyber-hover-primary file:cursor-pointer" />
            </div>
            <button type="submit" disabled={uploading} className="w-full flex items-center justify-center bg-cyber-green hover:bg-green-400 text-cyber-bg-darker font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline disabled:opacity-50 transition-colors duration-300">
              {uploading && <Loader2 className="animate-spin mr-2 h-5 w-5" />} 
              {uploading ? 'Uploading...' : 'Upload Track'}
            </button>
            {uploadError && <p className="mt-2 text-sm text-center text-cyber-red">{uploadError}</p>}
            {uploadSuccess && <p className="mt-2 text-sm text-center text-cyber-green">{uploadSuccess}</p>}
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tracks.length === 0 && !isLoading && (
          <p className="col-span-full text-center text-cyber-muted text-lg py-12">
            Your music library is currently empty. Try uploading some tracks!
          </p>
        )}
        
        {tracks.map((track) => {
          const isPlayable = !!track.hlsPlaylistUrl;
          const isCurrentlyPlaying = (playerState.currentTrack?.id === track.id || 
                                     // @ts-ignore - 支持trackId字段
                                     playerState.currentTrack?.trackId === track.id) && 
                                     playerState.isPlaying;
          const isSelected = playerState.currentTrack?.id === track.id || 
                            // @ts-ignore - 支持trackId字段
                            playerState.currentTrack?.trackId === track.id;
          
          return (
            <div 
              key={track.id} 
              className={`bg-cyber-bg-darker border-2 ${isSelected ? 'border-cyber-primary' : 'border-cyber-secondary'} rounded-lg overflow-hidden shadow-lg transition-all duration-300 hover:shadow-xl hover:scale-[1.02]`}
            >
              <div className="h-48 bg-cyber-bg relative overflow-hidden">
                {track.coverArtPath ? (
                  <img 
                    src={track.coverArtPath} 
                    alt={track.title} 
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }}
                  />
                ) : null}
                <div className={`absolute inset-0 flex items-center justify-center bg-cyber-bg bg-opacity-60 ${track.coverArtPath ? 'hidden' : ''}`}>
                  <Music2 className="w-16 h-16 text-cyber-primary opacity-70" />
                </div>
                
                {/* Play/Pause Overlay */}
                <div 
                  className="absolute inset-0 bg-cyber-bg-darker bg-opacity-40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
                  onClick={() => isPlayable && playTrack(track)}
                >
                  {isCurrentlyPlaying ? (
                    <PauseCircle className="h-16 w-16 text-cyber-primary" />
                  ) : (
                    <PlayCircle className="h-16 w-16 text-cyber-primary" />
                  )}
                </div>
              </div>
              
              <div className="p-4">
                <h3 className="text-lg font-semibold text-cyber-primary truncate">{track.title}</h3>
                <p className="text-sm text-cyber-secondary truncate">{track.artist || 'Unknown Artist'}</p>
                <p className="text-xs text-cyber-muted truncate">{track.album || 'Unknown Album'}</p>
                
                <div className="mt-4 flex justify-between items-center">
                  <button 
                    onClick={() => isPlayable && playTrack(track)}
                    disabled={!isPlayable}
                    className={`flex items-center px-3 py-1 rounded-full text-sm font-medium transition-colors ${isPlayable ? 'bg-cyber-primary text-cyber-bg-darker hover:bg-cyber-hover-primary' : 'bg-cyber-bg text-cyber-muted cursor-not-allowed'}`}
                  >
                    {isCurrentlyPlaying ? 'Now Playing' : 'Play'}
                  </button>
                  
                  <button 
                    onClick={() => addToPlaylist(track)}
                    disabled={!isPlayable}
                    className={`flex items-center p-1 rounded-full transition-colors ${isPlayable ? 'text-cyber-secondary hover:text-cyber-primary' : 'text-cyber-muted cursor-not-allowed'}`}
                    title="Add to Playlist"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MusicLibraryView; 