import { Loader2 } from 'lucide-react';
import React from 'react';

import AuthPage from './AuthPage';

import { useAuth } from '@/contexts/AuthContext';
import { SESSION_ENDED_MESSAGE } from '@/services/auth/TokenService';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading, sessionEnded } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        {sessionEnded && (
          <div
            role="alert"
            className="border-b border-amber-400/40 bg-amber-950 px-4 py-3 text-center text-sm font-medium text-amber-100"
          >
            {SESSION_ENDED_MESSAGE}
          </div>
        )}
        <AuthPage />
      </>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
