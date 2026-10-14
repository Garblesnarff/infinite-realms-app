import { Loader2 } from 'lucide-react';
import React from 'react';

import AuthPage from './AuthPage';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { SESSION_ENDED_MESSAGE } from '@/services/auth/TokenService';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading, sessionEnded, connectionError, refreshAuth } = useAuth();

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

  // #565: the auth backend could not be reached (e.g. mid deploy-swap). The
  // stored session is intact — offer a retry instead of the sign-in page.
  if (connectionError && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center max-w-md" role="alert">
          <h1 className="text-2xl font-bold mb-4">Connection issue</h1>
          <p className="text-muted-foreground mb-8">
            We couldn&apos;t reach the server. Your sign-in is still saved — please try again.
          </p>
          <Button onClick={() => void refreshAuth()}>Retry</Button>
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
