import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';

interface AuthContextType {
  currentUser: User | null;
  authToken: string | null;
  isLoading: boolean;
  login: (usernameOrEmail: string, password: string) => Promise<void>;
  logout: () => void;
  register: (username: string, email: string, password: string, phone?: string) => Promise<void>;
  // Future: add function to check auth status, refresh token, etc.
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    // Try to load user and token from localStorage on initial load
    try {
      const storedUser = localStorage.getItem('currentUser');
      const storedToken = localStorage.getItem('authToken');
      if (storedUser && storedToken) {
        setCurrentUser(JSON.parse(storedUser));
        setAuthToken(storedToken);
      }
    } catch (error) {
      console.error("Error loading auth data from localStorage", error);
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authToken');
    }
    setIsLoading(false);
  }, []);

  const login = async (usernameOrEmail: string, password: string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: usernameOrEmail,
          password: password,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Login failed');
      }

      const data = await response.json();
      const { token, user } = data;

      // 先清除旧的存储
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authToken');

      // 存储新的数据
      localStorage.setItem('currentUser', JSON.stringify(user));
      localStorage.setItem('authToken', token);

      // 更新状态
      setCurrentUser(user);
      setAuthToken(token);

      // 登录成功后的跳转交由调用方处理，以便在有路径前缀时正常工作
    } catch (error: any) {
      throw new Error(error.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (username: string, email: string, password: string, phone?: string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          email,
          password,
          phone,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Registration failed');
      }

      const data = await response.json();
      const { token, user } = data;

      // 先清除旧的存储
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authToken');

      // 存储新的数据
      localStorage.setItem('currentUser', JSON.stringify(user));
      localStorage.setItem('authToken', token);

      // 更新状态
      setCurrentUser(user);
      setAuthToken(token);

      // 注册完成后的跳转交由调用方处理，兼容带有前缀的部署环境
    } catch (error: any) {
      throw new Error(error.message || 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    // 清除状态和存储
    setCurrentUser(null);
    setAuthToken(null);
    localStorage.removeItem('currentUser');
    localStorage.removeItem('authToken');
    
    // 登出后的跳转交由调用方处理，兼容带有前缀的部署环境
  };

  return (
    <AuthContext.Provider value={{ currentUser, authToken, isLoading, login, logout, register }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 