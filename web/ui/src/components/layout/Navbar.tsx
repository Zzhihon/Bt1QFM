import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { LogIn, LogOut, Music, UserCircle, ListMusic, Disc } from 'lucide-react'; // Icons

const Navbar: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="bg-cyber-bg-darker p-4 shadow-lg border-b-2 border-cyber-primary">
      <div className="container mx-auto flex justify-between items-center">
        <button 
          onClick={() => navigate(currentUser ? '/music-library' : '/login')} 
          className="text-3xl font-bold text-cyber-primary hover:text-cyber-hover-primary transition-colors duration-300 flex items-center"
        >
          <Music className="mr-2 h-8 w-8" /> Bt1QFM
        </button>
        <div className="flex space-x-3">
          {currentUser ? (
            <>
              <button 
                onClick={() => navigate('/music-library')} 
                className={`text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center ${location.pathname === '/music-library' ? 'text-cyber-primary' : ''}`}
              >
                <ListMusic className="mr-1 h-5 w-5" /> Library
              </button>
              <button 
                onClick={() => navigate('/albums')} 
                className={`text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center ${location.pathname === '/albums' ? 'text-cyber-primary' : ''}`}
              >
                <Disc className="mr-1 h-5 w-5" /> Albums
              </button>
              <button 
                onClick={() => navigate('/profile')} 
                className={`text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center ${location.pathname === '/profile' ? 'text-cyber-primary' : ''}`}
              >
                <UserCircle className="mr-1 h-5 w-5" /> Profile
              </button>
              <button 
                onClick={handleLogout} 
                className="text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center"
              >
                <LogOut className="mr-1 h-5 w-5" /> Logout
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={() => navigate('/login')} 
                className={`text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center ${location.pathname === '/login' ? 'text-cyber-primary' : ''}`}
              >
                <LogIn className="mr-1 h-5 w-5" /> Login
              </button>
              <button 
                onClick={() => navigate('/register')} 
                className={`text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center ${location.pathname === '/register' ? 'text-cyber-primary' : ''}`}
              >
                Register
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar; 