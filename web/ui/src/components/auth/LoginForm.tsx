import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const LoginForm: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await login(username, password);
      navigate('/music-library');
    } catch (err: any) {
      setError(err.message || 'Failed to login. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-150px)] flex flex-col items-center justify-center bg-cyber-bg p-4">
      <div className="w-full max-w-md p-8 space-y-6 bg-cyber-bg-darker shadow-2xl rounded-lg border-2 border-cyber-secondary">
        <h2 className="text-3xl font-bold text-center text-cyber-primary animate-pulse">Login to 1QFM</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-cyber-primary">
              Username or Email
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-cyber-bg border border-cyber-secondary rounded-md shadow-sm placeholder-cyber-muted focus:outline-none focus:ring-2 focus:ring-cyber-primary focus:border-cyber-primary"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-cyber-primary">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-cyber-bg border border-cyber-secondary rounded-md shadow-sm placeholder-cyber-muted focus:outline-none focus:ring-2 focus:ring-cyber-primary focus:border-cyber-primary"
            />
          </div>
          {error && <p className="text-sm text-cyber-red text-center">{error}</p>}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-cyber-bg-darker bg-cyber-primary hover:bg-cyber-hover-primary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-cyber-bg focus:ring-cyber-primary disabled:opacity-50 transition-colors duration-300"
          >
            {isLoading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-cyber-muted">
          Don't have an account?{' '}
          <button onClick={() => navigate('/register')} className="font-medium text-cyber-secondary hover:text-cyber-primary underline">
            Register here
          </button>
        </p>
      </div>
    </div>
  );
};

export default LoginForm; 