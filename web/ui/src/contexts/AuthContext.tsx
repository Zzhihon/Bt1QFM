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
  const [isLoading, setIsLoading] = useState<boolean>(true); // Initially true to check localStorage

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
    // Simulate API call
    console.log("Attempting login for:", usernameOrEmail);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Hardcoded credentials for now, like in original player.js
    if (usernameOrEmail === "bt1q" && password === "qweasd2417") {
      const user: User = { id: 1, username: "bt1q", email: "bt1q@tatakal.com", phone: "13434206007", createdAt: new Date().toISOString() };
      const token = "fake-auth-token-" + Date.now();
      
      setCurrentUser(user);
      setAuthToken(token);
      localStorage.setItem('currentUser', JSON.stringify(user));
      localStorage.setItem('authToken', token);
      setIsLoading(false);
    } else {
      setIsLoading(false);
      throw new Error("Invalid username or password.");
    }
  };

  const register = async (username: string, email: string, password: string, phone?: string) => {
    setIsLoading(true);
    // Simulate API call
    console.log("Attempting registration for:", username, email, phone, password);
    await new Promise(resolve => setTimeout(resolve, 1000)); 
    
    // Simulate success for now - in a real app, this would create a user and then likely auto-login or redirect to login
    // For this example, we won't auto-login after register to keep it simple.
    // const newUser: User = { id: Date.now(), username, email, phone, createdAt: new Date().toISOString() };
    // const token = "fake-register-token-" + Date.now();
    // setCurrentUser(newUser);
    // setAuthToken(token);
    // localStorage.setItem('currentUser', JSON.stringify(newUser));
    // localStorage.setItem('authToken', token);
    setIsLoading(false);
    // Simulate success, but user will have to login manually
    // throw new Error("Registration failed (simulated)."); 
  };

  const logout = () => {
    setCurrentUser(null);
    setAuthToken(null);
    localStorage.removeItem('currentUser');
    localStorage.removeItem('authToken');
    console.log("User logged out");
    // Optionally redirect or clear other app state here
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