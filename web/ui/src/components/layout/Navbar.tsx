import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { LogIn, LogOut, Music, UserCircle, ListMusic, Disc, Bot, Settings, Mail, Phone, CalendarDays, Menu, Heart } from 'lucide-react';

const Navbar: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showProfile, setShowProfile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
    setMobileMenuOpen(false);
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    setMobileMenuOpen(false);
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

  const menuItems = currentUser ? (
    <>
      <button
        onClick={() => handleNavigate('/music-library')}
        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 flex items-center border-2 ${
          location.pathname === '/music-library' 
            ? 'bg-cyber-primary text-cyber-bg-darker border-cyber-primary shadow-glow' 
            : 'text-cyber-text hover:text-cyber-primary hover:bg-cyber-primary/10 border-transparent hover:border-cyber-primary/50'
        }`}
      >
        <ListMusic className="mr-2 h-5 w-5" /> Library
      </button>
      <button
        onClick={() => handleNavigate('/albums')}
        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 flex items-center border-2 ${
          location.pathname === '/albums' 
            ? 'bg-cyber-primary text-cyber-bg-darker border-cyber-primary shadow-glow' 
            : 'text-cyber-text hover:text-cyber-primary hover:bg-cyber-primary/10 border-transparent hover:border-cyber-primary/50'
        }`}
      >
        <Disc className="mr-2 h-5 w-5" /> Albums
      </button>
      <button
        onClick={() => handleNavigate('/collections')}
        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 flex items-center border-2 ${
          location.pathname === '/collections' 
            ? 'bg-cyber-primary text-cyber-bg-darker border-cyber-primary shadow-glow' 
            : 'text-cyber-text hover:text-cyber-primary hover:bg-cyber-primary/10 border-transparent hover:border-cyber-primary/50'
        }`}
      >
        <Heart className="mr-2 h-5 w-5" /> Collections
      </button>
      <button
        onClick={() => handleNavigate('/bot')}
        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 flex items-center border-2 ${
          location.pathname === '/bot' 
            ? 'bg-cyber-primary text-cyber-bg-darker border-cyber-primary shadow-glow' 
            : 'text-cyber-text hover:text-cyber-primary hover:bg-cyber-primary/10 border-transparent hover:border-cyber-primary/50'
        }`}
      >
        <Bot className="mr-2 h-5 w-5" /> Bot
      </button>

      {/* 设置按钮 */}
      <div className="relative">
        <button
          onClick={() => handleNavigate('/settings')}
          onMouseEnter={() => window.innerWidth >= 640 && setShowProfile(true)}
          onMouseLeave={() => setShowProfile(false)}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 flex items-center border-2 ${
            location.pathname === '/settings' 
              ? 'bg-cyber-primary text-cyber-bg-darker border-cyber-primary shadow-glow' 
              : 'text-cyber-text hover:text-cyber-primary hover:bg-cyber-primary/10 border-transparent hover:border-cyber-primary/50'
          }`}
        >
          <Settings className="mr-2 h-5 w-5" /> Settings
        </button>

        {/* 悬浮显示的个人档案 - 只在桌面端显示 */}
        {showProfile && window.innerWidth >= 768 && (
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
                onClick={() => handleNavigate('/settings')}
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
        className="px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 flex items-center border-2 border-transparent text-cyber-secondary hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
      >
        <LogOut className="mr-2 h-5 w-5" /> Logout
      </button>
    </>
  ) : (
    <>
      <button
        onClick={() => handleNavigate('/login')}
        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 flex items-center border-2 ${
          location.pathname === '/login' 
            ? 'bg-cyber-primary text-cyber-bg-darker border-cyber-primary shadow-glow' 
            : 'text-cyber-text hover:text-cyber-primary hover:bg-cyber-primary/10 border-transparent hover:border-cyber-primary/50'
        }`}
      >
        <LogIn className="mr-2 h-5 w-5" /> Login
      </button>
      <button
        onClick={() => handleNavigate('/register')}
        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 flex items-center border-2 ${
          location.pathname === '/register' 
            ? 'bg-cyber-primary text-cyber-bg-darker border-cyber-primary shadow-glow' 
            : 'text-cyber-text hover:text-cyber-primary hover:bg-cyber-primary/10 border-transparent hover:border-cyber-primary/50'
        }`}
      >
        Register
      </button>
    </>
  );

  return (
    <nav className="bg-cyber-bg-darker shadow-lg border-b-2 border-cyber-primary h-[64px] flex items-center px-4">
      <div className="container mx-auto flex justify-between items-center h-full">
        <button
          onClick={() => handleNavigate(currentUser ? '/music-library' : '/login')}
          className="text-2xl sm:text-3xl font-bold text-cyber-primary hover:text-cyber-hover-primary transition-colors duration-300 flex items-center"
        >
          <Music className="mr-2 h-8 w-8" /> Bt1QFM
        </button>

        <div className="hidden md:flex items-center space-x-3">{menuItems}</div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden text-cyber-primary hover:bg-cyber-primary/20 p-2 rounded-lg transition-colors duration-300"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden absolute top-[64px] left-0 right-0 bg-cyber-bg-darker border-t-2 border-cyber-primary p-4 space-y-3 z-50 shadow-xl">
          {menuItems}
        </div>
      )}
    </nav>
  );
};

export default Navbar;

// 导航栏代码无需修改，问题在于 Router basename 配置
// 确保 App.tsx 中设置了 <Router basename="/1qfm">