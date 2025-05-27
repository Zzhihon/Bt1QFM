import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { LogIn, LogOut, Music, UserCircle, ListMusic, Disc, Bot, Settings, Mail, Phone, CalendarDays } from 'lucide-react';

const Navbar: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showProfile, setShowProfile] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getStringValue = (value: any): string => {
    if (value === null || value === undefined) return 'N/A';
    if (typeof value === 'object' && 'String' in value) {
      return value.String || 'N/A';
    }
    return String(value);
  };

  const formatDate = (dateString: string): string => {
    if (!dateString || dateString === 'N/A') return 'N/A';
    return new Date(dateString).toLocaleDateString();
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
        
        <div className="flex items-center space-x-4">
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
                onClick={() => navigate('/bot')} 
                className={`text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center ${location.pathname === '/bot' ? 'text-cyber-primary' : ''}`}
              >
                <Bot className="mr-1 h-5 w-5" /> Bot
              </button>
              
              {/* 设置按钮 */}
              <div className="relative">
                <button 
                  onClick={() => navigate('/settings')}
                  onMouseEnter={() => setShowProfile(true)}
                  onMouseLeave={() => setShowProfile(false)}
                  className={`text-cyber-secondary hover:text-cyber-primary px-3 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center ${location.pathname === '/settings' ? 'text-cyber-primary' : ''}`}
                >
                  <Settings className="mr-1 h-5 w-5" /> Settings
                </button>

                {/* 悬浮显示的个人档案 */}
                {showProfile && (
                  <div className="absolute right-0 mt-2 w-64 bg-cyber-bg-darker border-2 border-cyber-primary rounded-lg shadow-xl p-4 z-50">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="w-12 h-12 rounded-full bg-cyber-primary flex items-center justify-center">
                        <UserCircle className="w-8 h-8 text-cyber-bg-darker" />
                      </div>
                      <div>
                        <h3 className="text-cyber-text font-semibold">{getStringValue(currentUser.username)}</h3>
                        <p className="text-cyber-secondary text-sm">{getStringValue(currentUser.email)}</p>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center text-cyber-text">
                        <Phone className="w-4 h-4 mr-2 text-cyber-secondary" />
                        {getStringValue(currentUser.phone)}
                      </div>
                      <div className="flex items-center text-cyber-text">
                        <CalendarDays className="w-4 h-4 mr-2 text-cyber-secondary" />
                        {formatDate(getStringValue(currentUser.createdAt))}
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-cyber-secondary/30">
                      <button
                        onClick={() => navigate('/settings')}
                        className="w-full text-center text-cyber-primary hover:text-cyber-hover-primary transition-colors duration-300"
                      >
                        查看完整档案
                      </button>
                    </div>
                  </div>
                )}
              </div>

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