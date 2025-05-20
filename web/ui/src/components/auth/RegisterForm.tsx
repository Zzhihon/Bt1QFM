import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

interface RegisterFormProps {
  onNavigate: (view: string) => void;
}

const RegisterForm: React.FC<RegisterFormProps> = ({ onNavigate }) => {
  const { register } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setIsLoading(true);
    try {
      await register(username, email, password, phone || undefined);
      setMessage('Registration successful! Please login.');
      // Clear form or navigate, here we just show a message
      setUsername('');
      setEmail('');
      setPassword('');
      setPhone('');
      setTimeout(() => onNavigate('login'), 2000); // Navigate to login after a delay
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-150px)] flex flex-col items-center justify-center bg-cyber-bg p-4">
      <div className="w-full max-w-md p-8 space-y-6 bg-cyber-bg-darker shadow-2xl rounded-lg border-2 border-cyber-secondary">
        <h2 className="text-3xl font-bold text-center text-cyber-secondary animate-pulse">Create Account</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="usernameReg" className="block text-sm font-medium text-cyber-primary">
              Username
            </label>
            <input
              id="usernameReg"
              name="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-cyber-bg border border-cyber-secondary rounded-md shadow-sm placeholder-cyber-muted focus:outline-none focus:ring-2 focus:ring-cyber-secondary focus:border-cyber-secondary"
            />
          </div>
          <div>
            <label htmlFor="emailReg" className="block text-sm font-medium text-cyber-primary">
              Email
            </label>
            <input
              id="emailReg"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-cyber-bg border border-cyber-secondary rounded-md shadow-sm placeholder-cyber-muted focus:outline-none focus:ring-2 focus:ring-cyber-secondary focus:border-cyber-secondary"
            />
          </div>
          <div>
            <label htmlFor="passwordReg" className="block text-sm font-medium text-cyber-primary">
              Password
            </label>
            <input
              id="passwordReg"
              name="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-cyber-bg border border-cyber-secondary rounded-md shadow-sm placeholder-cyber-muted focus:outline-none focus:ring-2 focus:ring-cyber-secondary focus:border-cyber-secondary"
            />
          </div>
          <div>
            <label htmlFor="phoneReg" className="block text-sm font-medium text-cyber-primary">
              Phone (Optional)
            </label>
            <input
              id="phoneReg"
              name="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-cyber-bg border border-cyber-secondary rounded-md shadow-sm placeholder-cyber-muted focus:outline-none focus:ring-2 focus:ring-cyber-secondary focus:border-cyber-secondary"
            />
          </div>
          {error && <p className="text-sm text-cyber-red text-center">{error}</p>}
          {message && <p className="text-sm text-cyber-green text-center">{message}</p>}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-cyber-bg-darker bg-cyber-secondary hover:bg-cyber-hover-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-cyber-bg focus:ring-cyber-secondary disabled:opacity-50 transition-colors duration-300"
          >
            {isLoading ? 'Registering...' : 'Register'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-cyber-muted">
          Already have an account?{' '}
          <button onClick={() => onNavigate('login')} className="font-medium text-cyber-primary hover:text-cyber-hover-primary underline">
            Login here
          </button>
        </p>
      </div>
    </div>
  );
};

export default RegisterForm; 