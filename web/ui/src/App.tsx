import React, { useState, useEffect } from 'react';
import Navbar from './components/layout/Navbar';
import LoginForm from './components/auth/LoginForm';
import RegisterForm from './components/auth/RegisterForm';
import ProfileView from './components/views/ProfileView';
import MusicLibraryView from './components/views/MusicLibraryView';
import Player from './components/player/Player';
import { useAuth } from './contexts/AuthContext';
import { usePlayer } from './contexts/PlayerContext';
import { Loader2 } from 'lucide-react';

function App() {
  const { currentUser, isLoading: authIsLoading } = useAuth();
  const { playerState } = usePlayer();
  const [currentView, setCurrentView] = useState('login'); // Default view

  useEffect(() => {
    // If user is logged in, default to music library, else to login
    if (!authIsLoading) {
        if (currentUser) {
            setCurrentView('musicLibrary');
        } else {
            setCurrentView('login');
        }
    }
  }, [currentUser, authIsLoading]);

  const handleNavigate = (view: string) => {
    setCurrentView(view);
  };

  const handleLoginSuccess = () => {
    setCurrentView('musicLibrary');
  };

  if (authIsLoading) {
    return (
      <div className="min-h-screen bg-cyber-bg flex flex-col items-center justify-center">
        <Loader2 className="h-16 w-16 text-cyber-primary animate-spin" />
        <p className="text-cyber-secondary mt-4 text-xl">Initializing System...</p>
      </div>
    );
  }

  let viewToRender;
  switch (currentView) {
    case 'login':
      viewToRender = <LoginForm onNavigate={handleNavigate} onLoginSuccess={handleLoginSuccess} />;
      break;
    case 'register':
      viewToRender = <RegisterForm onNavigate={handleNavigate} />;
      break;
    case 'profile':
      viewToRender = currentUser ? <ProfileView /> : <LoginForm onNavigate={handleNavigate} onLoginSuccess={handleLoginSuccess} />;
      break;
    case 'musicLibrary':
      viewToRender = currentUser ? <MusicLibraryView /> : <LoginForm onNavigate={handleNavigate} onLoginSuccess={handleLoginSuccess} />;
      break;
    default:
      viewToRender = currentUser ? <MusicLibraryView /> : <LoginForm onNavigate={handleNavigate} onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-cyber-bg flex flex-col">
      <Navbar onNavigate={handleNavigate} />
      <main className="flex-grow container mx-auto px-0 py-0 md:px-4 md:py-4">
        {viewToRender}
      </main>
      {/* 只有当用户登录时显示播放器 */}
      {currentUser && <Player />}
      {/* Footer could go here */}
      {/* <footer className='bg-cyber-bg-darker text-center p-4 border-t-2 border-cyber-secondary text-cyber-muted'>
        1QFM &copy; 2024 - Your Cyber Radio Experience
      </footer> */}
    </div>
  );
}

export default App; 