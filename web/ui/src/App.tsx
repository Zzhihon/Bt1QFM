import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/layout/Navbar';
import LoginForm from './components/auth/LoginForm';
import RegisterForm from './components/auth/RegisterForm';
import SettingsView from './components/views/SettingsView';
import MusicLibraryView from './components/views/MusicLibraryView';
import AlbumsView from './components/views/AlbumsView';
import AlbumDetailView from './components/views/AlbumDetailView';
import BotView from './components/views/BotView';
import Player from './components/player/Player';
import { useAuth } from './contexts/AuthContext';
import { usePlayer } from './contexts/PlayerContext';
import { Loader2 } from 'lucide-react';

function App() {
  const { currentUser, isLoading: authIsLoading } = useAuth();
  const { playerState } = usePlayer();

  if (authIsLoading) {
    return (
      <div className="min-h-screen bg-cyber-bg flex flex-col items-center justify-center">
        <Loader2 className="h-16 w-16 text-cyber-primary animate-spin" />
        <p className="text-cyber-secondary mt-4 text-xl">Initializing System...</p>
      </div>
    );
  }

  return (
    <Router basename="/1qfm">
      <div className="min-h-screen bg-cyber-bg flex flex-col">
        <Navbar />
        <main className="flex-grow container mx-auto px-0 py-0 md:px-4 md:py-4">
          <Routes>
            <Route path="/login" element={!currentUser ? <LoginForm /> : <Navigate to="/music-library" />} />
            <Route path="/register" element={!currentUser ? <RegisterForm /> : <Navigate to="/music-library" />} />
            <Route path="/settings" element={currentUser ? <SettingsView /> : <Navigate to="/login" />} />
            <Route path="/music-library" element={currentUser ? <MusicLibraryView /> : <Navigate to="/login" />} />
            <Route path="/albums" element={currentUser ? <AlbumsView /> : <Navigate to="/login" />} />
            <Route path="/album/:id" element={currentUser ? <AlbumDetailView /> : <Navigate to="/login" />} />
            <Route path="/bot" element={currentUser ? <BotView /> : <Navigate to="/login" />} />
            <Route path="/" element={<Navigate to={currentUser ? "/music-library" : "/login"} />} />
          </Routes>
        </main>
        {currentUser && <Player />}
      </div>
    </Router>
  );
}

export default App;