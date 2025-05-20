import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Track } from '../../types';
import { AlertTriangle, UploadCloud, Music2, PlayCircle, PauseCircle, Volume2, VolumeX, SkipForward, SkipBack, Loader2 } from 'lucide-react';
import Hls from 'hls.js';

const MusicLibraryView: React.FC = () => {
  const { currentUser, authToken } = useAuth();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);
  const audioRef = React.useRef<HTMLAudioElement>(null);

  // Upload form state
  const [showUploadForm, setShowUploadForm] = useState(false);
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

  useEffect(() => {
    // Initialize HLS.js
    let hls: Hls | null = null; 

    if (Hls.isSupported()) {
      console.log("HLS.js: Supported. Initializing HLS instance.");
      hls = new Hls({
        debug: true, 
        // Enable detailed logging from HLS.js itself
        // Consider adding more specific HLS configurations if issues persist, e.g.:
        // abrEwmaDefaultEstimate: 500000, 
        // manifestLoadingTimeOut: 10000, 
        // levelLoadingTimeOut: 10000,
        // fragLoadingTimeOut: 15000,
      });
      setHlsInstance(hls); // Store in state

      if (audioRef.current) {
        console.log("HLS.js: Attaching media to audio element.");
        hls.attachMedia(audioRef.current);
      }

      // Log all HLS events for detailed diagnostics
      Object.values(Hls.Events).forEach(eventName => {
        hls?.on(eventName as any, (event: any, data: any) => {
          console.log(`HLS Event: ${event}`, data);
        });
      });
      
      // Specific error handler for more direct control if needed,
      // though the above comprehensive logger will also catch errors.
      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS.js Error Event:', data);
        if (data.fatal) {
          console.error(`HLS.js: Fatal error encountered - Type: ${data.type}, Details: ${data.details}`);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('HLS.js: Network error. Attempting to recover by calling startLoad()...');
              hls?.startLoad(); // Try to restart loading
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS.js: Media error. Attempting to recover by calling recoverMediaError()...');
              hls?.recoverMediaError(); // Try to recover media error
              break;
            default:
              console.error('HLS.js: Unrecoverable fatal error. Destroying HLS instance.');
              hls?.destroy();
              setHlsInstance(null); // Clear from state to allow re-initialization if needed
              break;
          }
        } else {
          console.warn('HLS.js: Non-fatal error occurred:', data);
        }
      });

    } else if (audioRef.current && audioRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      console.log("HLS.js: HLS.js is not supported by this browser, but native HLS playback is available (e.g., Safari).");
    } else {
      console.warn("HLS.js: HLS.js is not supported and no native HLS playback capability detected.");
      setError("Audio playback may not work correctly as HLS is not fully supported.");
    }

    // Cleanup function for when the component unmounts
    return () => {
      if (hls) { 
        console.log("HLS.js: Component unmounting. Destroying HLS instance.");
        hls.destroy();
      }
    };
  }, []); // Empty dependency array ensures this runs only once on mount and cleans up on unmount

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
        setIsPlaying(false);
        // Optional: Play next track, etc.
        console.log("Track ended");
    };

    audioElement.addEventListener('play', handlePlay);
    audioElement.addEventListener('playing', handlePlay); // Some browsers might need this
    audioElement.addEventListener('pause', handlePause);
    audioElement.addEventListener('ended', handleEnded);

    return () => {
      audioElement.removeEventListener('play', handlePlay);
      audioElement.removeEventListener('playing', handlePlay);
      audioElement.removeEventListener('pause', handlePause);
      audioElement.removeEventListener('ended', handleEnded);
    };
  }, [audioRef]);

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

  const playTrack = (track: Track) => {
    setCurrentTrack(track);
    setIsPlaying(false); // Reset playing state immediately

    if (!audioRef.current) {
      console.error("PlayTrack: Audio element reference is not available.");
      setError("Audio player not initialized correctly.");
      return;
    }
    if (!track.hlsPlaylistUrl) {
      console.error("PlayTrack: Track has no HLS playlist URL.", track);
      setError(`Track "${track.title}" is not streamable.`);
      return;
    }

    console.log(`PlayTrack: Attempting to play track: "${track.title}", URL: ${track.hlsPlaylistUrl}`);

    if (hlsInstance) {
      console.log("PlayTrack: Using HLS.js instance.");
      
      // Ensure media is attached. This can be crucial if the HLS instance was created
      // before the audioRef was definitely available, or if it was detached.
      if (hlsInstance.media !== audioRef.current) {
          console.warn("PlayTrack: HLS instance media is not the current audio element. Re-attaching.");
          hlsInstance.detachMedia(); // Detach from any previous media
          hlsInstance.attachMedia(audioRef.current);
      }
      
      console.log("PlayTrack: Stopping any previous HLS load.");
      hlsInstance.stopLoad(); // Stop any ongoing loading processes

      console.log("PlayTrack: Loading new source into HLS.js:", track.hlsPlaylistUrl);
      hlsInstance.loadSource(track.hlsPlaylistUrl);

      hlsInstance.once(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        console.log("PlayTrack: HLS.js Manifest parsed successfully.", data.levels);
        if (audioRef.current) {
          console.log("PlayTrack: Attempting to play audio via HLS.js...");
          audioRef.current.play()
            .then(() => {
              console.log("PlayTrack: Playback initiated successfully via HLS.js.");
              // isPlaying state will be set by the 'play' event listener on audioRef
            })
            .catch(error => {
              console.error("PlayTrack: Error initiating playback via HLS.js:", error);
              setError(`Error playing "${track.title}": ${error.message}`);
              setIsPlaying(false);
            });
        } else {
          console.error("PlayTrack: Audio element ref became null before play could be called after manifest parsing.");
        }
      });

      hlsInstance.once(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            // Error already logged by the global HLS error handler in useEffect
            setError(`Playback error for "${track.title}". Check console.`);
          }
      });

    } else if (audioRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      console.log("PlayTrack: Using native HLS playback (e.g., Safari).");
      audioRef.current.src = track.hlsPlaylistUrl;
      console.log("PlayTrack: Set audio src to:", track.hlsPlaylistUrl);
      audioRef.current.load(); // Ensure the new source is loaded
      audioRef.current.play()
        .then(() => {
          console.log("PlayTrack: Playback initiated successfully via native HLS.");
          // isPlaying state will be set by the 'play' event listener on audioRef
        })
        .catch(error => {
          console.error("PlayTrack: Error initiating playback via native HLS:", error);
          setError(`Error playing "${track.title}" (native HLS): ${error.message}`);
          setIsPlaying(false);
        });
    } else {
      console.warn("PlayTrack: Cannot play track. No HLS.js instance and native HLS not supported or audioRef missing.");
      setError("Unable to play track: Playback method not available.");
    }
  };

  const togglePlayPause = () => {
    if (!audioRef.current) {
      console.warn("TogglePlayPause: Audio element ref not available.");
      return;
    }
    if (!currentTrack) {
      console.log("TogglePlayPause: No current track selected to play/pause.");
      return;
    }

    if (isPlaying) {
      console.log("TogglePlayPause: Pausing audio.");
      audioRef.current.pause();
    } else {
      console.log("TogglePlayPause: Attempting to play audio (current or resume).");
      // If HLS.js is used and stopped, or for native, play() should resume or start.
      audioRef.current.play()
        .catch(error => {
          console.error("TogglePlayPause: Error on play():", error);
          setError(`Error resuming playback: ${error.message}`);
          setIsPlaying(false); // Ensure state consistency
        });
    }
    // The actual isPlaying state is managed by the event listeners on the audio element ('play', 'pause')
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
    <div className="container mx-auto p-4 min-h-[calc(100vh-100px)]">
      <header className="my-8 text-center">
        <h1 className="text-5xl font-bold text-cyber-primary animate-pulse">Music Matrix</h1>
        <p className="text-cyber-secondary mt-2">Your digital soundscape awaits.</p>
      </header>

      <div className="flex justify-end mb-6">
        {currentUser && (
            <button 
                onClick={() => setShowUploadForm(!showUploadForm)}
                className="flex items-center bg-cyber-secondary hover:bg-cyber-hover-secondary text-cyber-bg-darker font-semibold py-2 px-4 rounded-lg shadow-md transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 ring-offset-2 ring-offset-cyber-bg ring-cyber-primary"
            >
                <UploadCloud className="mr-2 h-5 w-5" /> {showUploadForm ? 'Cancel Upload' : 'Upload Track'}
            </button>
        )}
      </div>

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

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Track List Column - ENHANCED */} 
        <div className="lg:w-3/5">
            <h2 className="text-3xl font-semibold mb-6 text-cyber-secondary border-b-2 border-cyber-secondary pb-2">Track List</h2>
            {tracks.length === 0 && !isLoading && (
                <p className="text-cyber-muted text-lg">Your music library is currently empty. Try uploading some tracks!</p>
            )}
            <div className="space-y-3 max-h-[calc(100vh-300px)] lg:max-h-[65vh] overflow-y-auto pr-2">
            {tracks.map((track) => {
              const isPlayable = !!track.hlsPlaylistUrl;
              const isCurrentlyPlaying = currentTrack?.id === track.id && isPlaying;
              const isSelected = currentTrack?.id === track.id;

              return (
                <div 
                    key={track.id} 
                    onClick={() => isPlayable && playTrack(track)}
                    className={`p-4 rounded-lg shadow-lg flex items-center gap-4 transition-all duration-200 ease-in-out border-2 
                                ${isPlayable ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'} 
                                ${isSelected ? 'bg-cyber-primary border-cyber-primary shadow-cyber-primary/50' : 'bg-cyber-bg-darker border-cyber-secondary hover:bg-cyber-secondary hover:border-cyber-primary'}`}
                >
                    {track.coverArtPath ? (
                        <img 
                          src={track.coverArtPath} 
                          alt={track.title} 
                          className="w-14 h-14 rounded object-cover border-2 border-cyber-primary flex-shrink-0"
                          onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} // Show fallback on error
                        />
                    ) : null} 
                    <div className={`w-14 h-14 rounded bg-cyber-bg flex items-center justify-center text-cyber-primary border-2 border-cyber-primary flex-shrink-0 ${track.coverArtPath ? 'hidden' : ''}`}>
                        <Music2 className="w-8 h-8" />
                    </div>
                    
                    <div className={`flex-grow overflow-hidden ${isSelected ? 'text-cyber-bg-darker' : 'text-cyber-text'}`}>
                        <div 
                          className={`font-semibold text-lg truncate ${isSelected ? '' : 'text-cyber-primary'} ${!isPlayable ? 'text-cyber-muted' : ''}`}
                          title={track.title}
                        >
                          {track.title}
                        </div>
                        <div 
                          className={`text-sm truncate ${isSelected ? 'text-cyber-bg' : 'text-cyber-secondary'} ${!isPlayable ? 'text-cyber-muted' : ''}`}
                          title={`${track.artist || 'Unknown Artist'} - ${track.album || 'Unknown Album'}`}
                        >
                            {track.artist || 'Unknown Artist'} - {track.album || 'Unknown Album'}
                        </div>
                        {!isPlayable && <div className="text-xs text-cyber-red mt-1">Track not available for streaming</div>}
                    </div>
                    {isPlayable && isSelected && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); togglePlayPause(); }} 
                        className={`ml-auto p-2 rounded-full flex-shrink-0 transition-colors duration-200 ${isCurrentlyPlaying ? 'bg-cyber-primary text-cyber-bg-darker hover:bg-cyber-hover-primary' : 'bg-cyber-secondary text-cyber-bg-darker hover:bg-cyber-hover-secondary'}`}
                        title={isCurrentlyPlaying ? 'Pause' : 'Play'}
                      >
                        {isCurrentlyPlaying ? <PauseCircle size={28} /> : <PlayCircle size={28} />}
                      </button>
                    )}
                </div>
            );}
            )}
            </div>
        </div>

        {/* Player and Now Playing Column - ENHANCED */} 
        <div className="lg:w-2/5 lg:sticky lg:top-8 self-start">
            <h2 className="text-3xl font-semibold mb-6 text-cyber-secondary border-b-2 border-cyber-secondary pb-2">Now Playing</h2>
            <div className="bg-cyber-bg-darker p-6 rounded-lg shadow-xl border-2 border-cyber-secondary">
                <div id="nowPlayingCover" className="w-full h-72 bg-cyber-bg rounded-lg mb-6 flex items-center justify-center overflow-hidden border-2 border-cyber-primary relative">
                    {currentTrack && currentTrack.coverArtPath ? (
                        <img 
                          src={currentTrack.coverArtPath} 
                          alt="Cover Art" 
                          className="w-full h-full object-cover"
                          onError={(e) => { 
                            e.currentTarget.style.display = 'none'; 
                            const fallback = e.currentTarget.parentElement?.querySelector('.fallback-icon');
                            if(fallback) fallback.classList.remove('hidden');
                          }}
                        />
                    ) : null}
                    <Music2 className={`w-24 h-24 text-cyber-muted fallback-icon ${currentTrack && currentTrack.coverArtPath ? 'hidden' : ''}`} />
                </div>
                <div id="nowPlayingTitle" className="text-2xl font-semibold truncate text-cyber-primary mb-1 min-h-[32px]">
                    {currentTrack?.title || 'Select a track'}
                </div>
                <div id="nowPlayingArtistAlbum" className="text-md text-cyber-secondary truncate mb-4 min-h-[24px]">
                    {currentTrack ? `${currentTrack.artist || 'Unknown Artist'} - ${currentTrack.album || 'Unknown Album'}` : '---'}
                </div>
                {/* Consider adding custom controls for better styling */}
                <audio 
                  ref={audioRef} 
                  controls 
                  className="w-full mt-4 custom-audio-player"
                  // onPlay={() => setIsPlaying(true)} // Handled by useEffect
                  // onPause={() => setIsPlaying(false)} // Handled by useEffect
                  // onEnded={() => setIsPlaying(false)} // Handled by useEffect
                />
            </div>
        </div>
      </div>
    </div>
  );
};

export default MusicLibraryView; 