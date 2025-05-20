document.addEventListener('DOMContentLoaded', () => {
    const trackListEl = document.getElementById('trackList');
    const audioPlayer = document.getElementById('audioPlayer');
    const nowPlayingCoverEl = document.getElementById('nowPlayingCover');
    const nowPlayingTitleEl = document.getElementById('nowPlayingTitle');
    const nowPlayingArtistAlbumEl = document.getElementById('nowPlayingArtistAlbum');
    const uploadForm = document.getElementById('uploadForm');
    const uploadStatusEl = document.getElementById('uploadStatus');
    const uploadSectionContainer = document.getElementById('uploadSectionContainer'); // For hiding/showing upload form

    // New DOM Elements for Auth and Views
    const navBrand = document.getElementById('navBrand');
    const navMusicLibrary = document.getElementById('navMusicLibrary');
    const navProfile = document.getElementById('navProfile');
    const navLogin = document.getElementById('navLogin');
    const navRegister = document.getElementById('navRegister');
    const navLogout = document.getElementById('navLogout');

    const musicLibraryView = document.getElementById('musicLibraryView');
    const loginView = document.getElementById('loginView');
    const registerView = document.getElementById('registerView');
    const profileView = document.getElementById('profileView');

    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const switchToRegister = document.getElementById('switchToRegister');
    const switchToLogin = document.getElementById('switchToLogin');

    const loginStatusEl = document.getElementById('loginStatus');
    const registerStatusEl = document.getElementById('registerStatus');

    const profileUsername = document.getElementById('profileUsername');
    const profileEmail = document.getElementById('profileEmail');
    const profilePhone = document.getElementById('profilePhone');
    const profileJoinedDate = document.getElementById('profileJoinedDate');

    let hlsInstance;
    let currentUser = null; // Will hold user object {id, username, email, phone, createdAt}
    let authToken = localStorage.getItem('authToken'); // Persist token

    const allViews = [musicLibraryView, loginView, registerView, profileView];

    function showView(viewToShow) {
        allViews.forEach(view => {
            if (view) view.classList.add('hidden');
        });
        if (viewToShow) viewToShow.classList.remove('hidden');
    }

    function updateNavLinks() {
        if (currentUser) {
            navLogin.classList.add('hidden');
            navRegister.classList.add('hidden');
            navProfile.classList.remove('hidden');
            navLogout.classList.remove('hidden');
            if(uploadSectionContainer) uploadSectionContainer.classList.remove('hidden');
        } else {
            navLogin.classList.remove('hidden');
            navRegister.classList.remove('hidden');
            navProfile.classList.add('hidden');
            navLogout.classList.add('hidden');
            if(uploadSectionContainer) uploadSectionContainer.classList.add('hidden'); // Hide upload if not logged in
        }
    }

    // --- Authentication Functions (Stubs for now, to be implemented with API calls) ---
    async function handleLogin(event) {
        event.preventDefault();
        const formData = new FormData(loginForm);
        const username = formData.get('username');
        const password = formData.get('password');
        loginStatusEl.textContent = 'Logging in...';
        loginStatusEl.className = 'mt-4 text-sm text-center text-yellow-400';

        // SIMULATE API CALL
        console.log("Attempting login for:", username);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay

        if (username === "bt1q" && password === "qweasd2417") { // Hardcoded for now, matches DB
            currentUser = { id: 1, username: "bt1q", email: "bt1q@tatakal.com", phone: "13434206007", createdAt: new Date().toISOString() };
            authToken = "fake-auth-token-" + Date.now(); // Simulate a token
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
            loginStatusEl.textContent = 'Login successful!';
            loginStatusEl.className = 'mt-4 text-sm text-center text-green-400';
            setTimeout(() => {
                updateNavLinks();
                showView(musicLibraryView);
                fetchAndDisplayTracks(); // Fetch tracks for this user
                loadUserProfile(); // Load profile info
            }, 500);
        } else {
            currentUser = null;
            authToken = null;
            localStorage.removeItem('authToken');
            localStorage.removeItem('currentUser');
            loginStatusEl.textContent = 'Invalid username or password.';
            loginStatusEl.className = 'mt-4 text-sm text-center text-red-400';
        }
    }

    async function handleRegister(event) {
        event.preventDefault();
        const formData = new FormData(registerForm);
        const username = formData.get('username');
        const email = formData.get('email');
        const password = formData.get('password');
        const phone = formData.get('phone');
        registerStatusEl.textContent = 'Registering...';
        registerStatusEl.className = 'mt-4 text-sm text-center text-yellow-400';
        
        // SIMULATE API CALL
        console.log("Attempting registration for:", username, email, phone);
        await new Promise(resolve => setTimeout(resolve, 1000)); 

        // Simulate success for now
        registerStatusEl.textContent = 'Registration successful! Please login.';
        registerStatusEl.className = 'mt-4 text-sm text-center text-green-400';
        registerForm.reset();
        setTimeout(() => showView(loginView), 1000);
    }

    function loadUserProfile() {
        if (!currentUser) return;
        profileUsername.textContent = currentUser.username;
        profileEmail.textContent = currentUser.email;
        profilePhone.textContent = currentUser.phone || 'N/A';
        profileJoinedDate.textContent = currentUser.createdAt ? new Date(currentUser.createdAt).toLocaleDateString() : 'N/A';
    }

    function logout() {
        currentUser = null;
        authToken = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        updateNavLinks();
        showView(loginView);
        if(trackListEl) trackListEl.innerHTML = '<p class="text-gray-400">Please login to see your music library.</p>';
        if(nowPlayingTitleEl) nowPlayingTitleEl.textContent = 'Select a song';
        if(nowPlayingArtistAlbumEl) nowPlayingArtistAlbumEl.textContent = '---';
        if(nowPlayingCoverEl) nowPlayingCoverEl.innerHTML = `<svg class="w-16 h-16 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>`;
        if(hlsInstance) hlsInstance.destroy();
        
        console.log("User logged out");
    }

    // --- End Authentication Functions ---

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
        if (!currentUser) { // Only fetch if a user is logged in (simulated)
            trackListEl.innerHTML = '<p class="text-gray-400">Please login to see your music library.</p>';
            return;
        }
        // Actual fetch logic remains the same for now as backend is hardcoded to user 1
        try {
            const response = await fetch('/api/tracks'); // This will get tracks for user 1 due to backend hardcoding
            if (!response.ok) {
                trackListEl.innerHTML = `<p class="text-red-400">Error loading library: ${response.statusText} (status: ${response.status})</p>`;
                console.error(`HTTP error! status: ${response.status}`, response);
                return;
            }
            const tracks = await response.json();

            trackListEl.innerHTML = ''; 

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
                nowPlayingCoverEl.firstChild.src = ''; 
            } else {
                 nowPlayingCoverEl.innerHTML = `<svg class="w-16 h-16 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>`;
            }
            return;
        }
        const streamUrl = `/stream/${track.id}/playlist.m3u8`;
        initPlayer(streamUrl);
        nowPlayingTitleEl.textContent = track.title || 'Untitled';
        nowPlayingArtistAlbumEl.textContent = `${track.artist || 'Unknown Artist'} - ${track.album || 'Unknown Album'}`;
        if (track.coverArtPath && track.coverArtPath !== "") {
            nowPlayingCoverEl.innerHTML = `<img src="${track.coverArtPath}?t=${new Date().getTime()}" alt="Cover Art" class="w-full h-full object-cover rounded">`;
        } else {
            nowPlayingCoverEl.innerHTML = `<svg class="w-16 h-16 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>`;
        }
    }

    if (uploadForm) {
        uploadForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!currentUser) {
                uploadStatusEl.textContent = 'Please login to upload tracks.';
                uploadStatusEl.className = 'mt-2 text-sm text-red-400';
                return;
            }
            uploadStatusEl.textContent = 'Uploading...';
            uploadStatusEl.className = 'mt-2 text-sm text-yellow-400';
    
            const formData = new FormData(uploadForm);
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
                    // Headers: { 'Authorization': `Bearer ${authToken}` } // Add this when backend expects token
                });
    
                const result = await response.json();
    
                if (response.ok) {
                    uploadStatusEl.textContent = `Success: ${result.message} (ID: ${result.trackId})`;
                    uploadStatusEl.className = 'mt-2 text-sm text-green-400';
                    uploadForm.reset();
                    fetchAndDisplayTracks(); 
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
    }

    // Navigation Event Listeners
    if (navBrand) navBrand.addEventListener('click', (e) => { e.preventDefault(); showView(currentUser ? musicLibraryView : loginView); });
    if (navMusicLibrary) navMusicLibrary.addEventListener('click', (e) => { e.preventDefault(); if(currentUser) showView(musicLibraryView); else showView(loginView); });
    if (navProfile) navProfile.addEventListener('click', (e) => { e.preventDefault(); if(currentUser) { loadUserProfile(); showView(profileView); } });
    if (navLogin) navLogin.addEventListener('click', (e) => { e.preventDefault(); showView(loginView); });
    if (navRegister) navRegister.addEventListener('click', (e) => { e.preventDefault(); showView(registerView); });
    if (navLogout) navLogout.addEventListener('click', (e) => { e.preventDefault(); logout(); });
    if (switchToRegister) switchToRegister.addEventListener('click', (e) => { e.preventDefault(); showView(registerView); });
    if (switchToLogin) switchToLogin.addEventListener('click', (e) => { e.preventDefault(); showView(loginView); });

    // Form submit listeners
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (registerForm) registerForm.addEventListener('submit', handleRegister);

    // Initial application state setup
    function initializeAppState() {
        const storedUser = localStorage.getItem('currentUser');
        const storedToken = localStorage.getItem('authToken');
        if (storedUser && storedToken) {
            currentUser = JSON.parse(storedUser);
            authToken = storedToken;
            updateNavLinks();
            loadUserProfile();
            showView(musicLibraryView);
            if (Hls.isSupported()) {
                fetchAndDisplayTracks();
            } else {
                trackListEl.innerHTML = '<p class="text-red-400">HLS is not supported.</p>';
            }
        } else {
            updateNavLinks();
            showView(loginView);
        }
    }

    initializeAppState();
}); 