import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { LogIn, LogOut, Music, UserCircle, ListMusic, Disc } from 'lucide-react'; // Icons

interface NavbarProps {
  onNavigate?: (view: string) => void;
}

const Navbar: React.FC<NavbarProps> = ({ onNavigate }) => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavigate = (path: string) => {
    if (onNavigate) {
      // 使用旧的导航方式
      onNavigate(path.replace('/', ''));
    } else {
      // 使用新的路由方式
      navigate(path);
    }
  };

  const handleLogout = () => {
    logout();
    handleNavigate('/login');
  };

  return (
    <nav className="bg-cyber-bg-darker p-4 shadow-lg border-b-2 border-cyber-primary">
      <div className="container mx-auto flex justify-between items-center">
        <button 
          onClick={() => handleNavigate(currentUser ? '/music-library' : '/login')} 
          className="text-3xl font-bold text-cyber-primary hover:text-cyber-hover-primary transition-colors duration-300 flex items-center"
        >
          <Music className="mr-2 h-8 w-8" /> Bt1QFM
        </button>
        <div className="flex space-x-3">
          {currentUser ? (
            <>
              <button 
                onClick={() => handleNavigate('/music-library')} 
                className={`text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center ${location.pathname === '/music-library' ? 'text-cyber-primary' : ''}`}
              >
                <ListMusic className="mr-1 h-5 w-5" /> Library
              </button>
              <button 
                onClick={() => handleNavigate('/albums')} 
                className={`text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center ${location.pathname === '/albums' ? 'text-cyber-primary' : ''}`}
              >
                <Disc className="mr-1 h-5 w-5" /> Albums
              </button>
              <button 
                onClick={() => handleNavigate('/profile')} 
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
                onClick={() => handleNavigate('/login')} 
                className={`text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center ${location.pathname === '/login' ? 'text-cyber-primary' : ''}`}
              >
                <LogIn className="mr-1 h-5 w-5" /> Login
              </button>
              <button 
                onClick={() => handleNavigate('/register')} 
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