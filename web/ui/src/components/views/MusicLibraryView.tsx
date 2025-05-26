import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePlayer } from '../../contexts/PlayerContext';
import { Track } from '../../types';
import { AlertTriangle, UploadCloud, Music2, PlayCircle, PauseCircle, ListMusic, Plus } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import UploadForm from '../upload/UploadForm';

// 声明全局jsmediatags类型
declare global {
  interface Window {
    jsmediatags: {
      read: (file: File, callbacks: {
        onSuccess: (tag: any) => void;
        onError: (error: Error) => void;
      }) => void;
    };
  }
}

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
  const { addToast } = useToast();

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
      const response = await fetch('/api/tracks', {
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
    <div className="container mx-auto p-4 min-h-[calc(100vh-100px)] pb-32 max-w-7xl">
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
          </>
        )}
      </div>

      {showUploadForm && currentUser && (
        <div className="mb-8">
          <UploadForm 
            onUploadSuccess={() => {
              setShowUploadForm(false);
              fetchTracks();
            }}
            onCancel={() => setShowUploadForm(false)}
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
              <div className="aspect-[4/5] bg-cyber-bg relative overflow-hidden">
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