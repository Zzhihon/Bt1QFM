document.addEventListener('DOMContentLoaded', () => {
    const trackListEl = document.getElementById('trackList');
    const audioPlayer = document.getElementById('audioPlayer');
    const nowPlayingCoverEl = document.getElementById('nowPlayingCover');
    const nowPlayingTitleEl = document.getElementById('nowPlayingTitle');
    const nowPlayingArtistAlbumEl = document.getElementById('nowPlayingArtistAlbum');
    const uploadForm = document.getElementById('uploadForm');
    const uploadStatusEl = document.getElementById('uploadStatus');

    let hlsInstance;

    function initPlayer(sourceUrl) {
        if (hlsInstance) {
            hlsInstance.destroy();
        }
        hlsInstance = new Hls();
        hlsInstance.loadSource(sourceUrl);
        hlsInstance.attachMedia(audioPlayer);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            audioPlayer.play();
            console.log("Playing: " + sourceUrl);
        });
        hlsInstance.on(Hls.Events.ERROR, function (event, data) {
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.error('Fatal network error encountered, trying to recover:', data);
                        hlsInstance.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.error('Fatal media error encountered, trying to recover:', data);
                        hlsInstance.recoverMediaError();
                        break;
                    default:
                        console.error('Fatal HLS error, cannot recover:', data);
                        hlsInstance.destroy();
                        break;
                }
            }
        });
    }

    async function fetchAndDisplayTracks() {
        try {
            const response = await fetch('/api/tracks');
            if (!response.ok) {
                trackListEl.innerHTML = `<p class="text-red-400">Error loading library: ${response.statusText} (status: ${response.status})</p>`;
                console.error(`HTTP error! status: ${response.status}`, response);
                return;
            }
            const tracks = await response.json();

            trackListEl.innerHTML = ''; // Clear loading/previous tracks

            if (!Array.isArray(tracks) || tracks.length === 0) {
                trackListEl.innerHTML = '<p class="text-gray-400">No tracks in library. Upload some music!</p>';
                return;
            }

            tracks.forEach(track => {
                const trackItem = document.createElement('div');
                trackItem.className = 'p-3 bg-gray-700 hover:bg-purple-600 rounded-md cursor-pointer flex items-center gap-4';
                trackItem.addEventListener('click', () => {
                    playTrack(track);
                });

                let coverArtHtml = '';
                if (track.coverArtPath && track.coverArtPath !== "") {
                    // Assuming coverArtPath is like "/static/covers/1.jpg"
                    coverArtHtml = `<img src="${track.coverArtPath}?t=${new Date().getTime()}" alt="Cover" class="w-12 h-12 rounded object-cover">`; 
                } else {
                    coverArtHtml = `<div class="w-12 h-12 rounded bg-gray-600 flex items-center justify-center text-gray-400 text-xl">♫</div>`;
                }
                
                const titleArtistHtml = `
                    <div>
                        <div class="font-semibold text-white truncate">${track.title || 'Untitled'}</div>
                        <div class="text-sm text-gray-400 truncate">${track.artist || 'Unknown Artist'} - ${track.album || 'Unknown Album'}</div>
                    </div>`;

                trackItem.innerHTML = `${coverArtHtml}${titleArtistHtml}`;
                trackListEl.appendChild(trackItem);
            });

        } catch (error) {
            console.error('Failed to fetch or process tracks:', error);
            trackListEl.innerHTML = '<p class="text-red-400">Error loading library. Check console.</p>';
        }
    }

    function playTrack(track) {
        if (!track || !track.id) {
            console.error("Invalid track object provided to playTrack:", track);
            nowPlayingTitleEl.textContent = 'Error: Invalid track';
            nowPlayingArtistAlbumEl.textContent = '---';
            if (nowPlayingCoverEl.firstChild && nowPlayingCoverEl.firstChild.tagName === 'IMG') {
                nowPlayingCoverEl.firstChild.src = ''; // Clear image
            } else {
                 nowPlayingCoverEl.innerHTML = `<svg class="w-16 h-16 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>`;
            }
            return;
        }

        const streamUrl = `/stream/${track.id}/playlist.m3u8`;
        initPlayer(streamUrl);

        // Update Now Playing info
        nowPlayingTitleEl.textContent = track.title || 'Untitled';
        nowPlayingArtistAlbumEl.textContent = `${track.artist || 'Unknown Artist'} - ${track.album || 'Unknown Album'}`;
        if (track.coverArtPath && track.coverArtPath !== "") {
            nowPlayingCoverEl.innerHTML = `<img src="${track.coverArtPath}?t=${new Date().getTime()}" alt="Cover Art" class="w-full h-full object-cover rounded">`;
        } else {
            nowPlayingCoverEl.innerHTML = `<svg class="w-16 h-16 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>`;
        }
    }

    uploadForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        uploadStatusEl.textContent = 'Uploading...';
        uploadStatusEl.className = 'mt-2 text-sm text-yellow-400';

        const formData = new FormData(uploadForm);
        
        // Basic client-side validation (optional, as server validates too)
        const title = formData.get('title');
        const trackFile = formData.get('trackFile');
        if (!title || !trackFile || trackFile.size === 0) {
            uploadStatusEl.textContent = 'Title and Track File are required.';
            uploadStatusEl.className = 'mt-2 text-sm text-red-400';
            return;
        }

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (response.ok) {
                uploadStatusEl.textContent = `Success: ${result.message} (ID: ${result.trackId})`;
                uploadStatusEl.className = 'mt-2 text-sm text-green-400';
                uploadForm.reset();
                fetchAndDisplayTracks(); // Refresh track list
            } else {
                uploadStatusEl.textContent = `Error: ${result.error || response.statusText || 'Upload failed.'}`;
                uploadStatusEl.className = 'mt-2 text-sm text-red-400';
            }
        } catch (error) {
            console.error('Upload error:', error);
            uploadStatusEl.textContent = 'Upload failed. Check console for details.';
            uploadStatusEl.className = 'mt-2 text-sm text-red-400';
        }
    });

    // Initial load
    if (Hls.isSupported()) {
        fetchAndDisplayTracks();
    } else if (audioPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        // For native HLS support (e.g., Safari), but HLS.js provides more control
        // Consider if you want to support native HLS without HLS.js features
        fetchAndDisplayTracks(); 
        // Native playback would require setting audioPlayer.src directly and not using HLS.js
        // For now, we assume HLS.js is the primary method.
    } else {
        trackListEl.innerHTML = '<p class="text-red-400">HLS is not supported in your browser.</p>';
        console.error("HLS not supported.");
    }
}); 