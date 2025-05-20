import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { UserCircle, Mail, Phone, CalendarDays } from 'lucide-react';

const ProfileView: React.FC = () => {
  const { currentUser } = useAuth();

  if (!currentUser) {
    return (
      <div className="min-h-[calc(100vh-150px)] flex items-center justify-center p-4 text-cyber-accent">
        Loading profile or not logged in...
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-150px)] flex flex-col items-center justify-center bg-cyber-bg p-4">
      <div className="w-full max-w-lg p-8 space-y-6 bg-cyber-bg-darker shadow-2xl rounded-lg border-2 border-cyber-primary">
        <h2 className="text-3xl font-bold text-center text-cyber-primary animate-pulse mb-8">User Profile</h2>
        <div className="space-y-4 text-cyber-text">
          <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
            <UserCircle className="h-6 w-6 text-cyber-secondary" />
            <p><strong className="text-cyber-accent">Username:</strong> {currentUser.username}</p>
          </div>
          <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
            <Mail className="h-6 w-6 text-cyber-secondary" />
            <p><strong className="text-cyber-accent">Email:</strong> {currentUser.email}</p>
          </div>
          <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
            <Phone className="h-6 w-6 text-cyber-secondary" />
            <p><strong className="text-cyber-accent">Phone:</strong> {currentUser.phone || 'N/A'}</p>
          </div>
          <div className="flex items-center space-x-3 p-3 bg-cyber-bg rounded-md">
            <CalendarDays className="h-6 w-6 text-cyber-secondary" />
            <p><strong className="text-cyber-accent">Joined:</strong> {currentUser.createdAt ? new Date(currentUser.createdAt).toLocaleDateString() : 'N/A'}</p>
          </div>
        </div>
        {/* <button 
          // onClick={() => alert('Edit profile functionality not implemented yet.')}
          className="mt-8 w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-cyber-bg-darker bg-cyber-accent hover:bg-yellow-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-cyber-bg focus:ring-cyber-accent transition-colors duration-300"
        >
          Edit Profile (Soon!)
        </button> */}
      </div>
    </div>
  );
};

export default ProfileView; 