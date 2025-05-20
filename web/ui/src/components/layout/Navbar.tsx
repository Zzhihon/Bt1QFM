import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { LogIn, LogOut, Music, UserCircle, ListMusic } from 'lucide-react'; // Icons

interface NavbarProps {
  onNavigate: (view: string) => void;
}

const Navbar: React.FC<NavbarProps> = ({ onNavigate }) => {
  const { currentUser, logout } = useAuth();

  return (
    <nav className="bg-cyber-bg-darker p-4 shadow-lg border-b-2 border-cyber-primary">
      <div className="container mx-auto flex justify-between items-center">
        <button 
          onClick={() => onNavigate(currentUser ? 'musicLibrary' : 'login')} 
          className="text-3xl font-bold text-cyber-primary hover:text-cyber-hover-primary transition-colors duration-300 flex items-center"
        >
          <Music className="mr-2 h-8 w-8" /> Bt1QFM
        </button>
        <div className="flex space-x-3">
          {currentUser ? (
            <>
              <button 
                onClick={() => onNavigate('musicLibrary')} 
                className="text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center"
              >
                <ListMusic className="mr-1 h-5 w-5" /> Library
              </button>
              <button 
                onClick={() => onNavigate('profile')} 
                className="text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center"
              >
                <UserCircle className="mr-1 h-5 w-5" /> Profile
              </button>
              <button 
                onClick={() => { logout(); onNavigate('login'); }} 
                className="text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center"
              >
                <LogOut className="mr-1 h-5 w-5" /> Logout
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={() => onNavigate('login')} 
                className="text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center"
              >
                <LogIn className="mr-1 h-5 w-5" /> Login
              </button>
              <button 
                onClick={() => onNavigate('register')} 
                className="text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center"
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