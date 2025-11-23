/**
 * OAuth Callback Page
 *
 * Handles the OAuth redirect from backend after WorkOS authentication.
 * Backend passes tokens in URL hash, this page extracts and stores them,
 * then redirects to the app.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import logger from '@/lib/logger';

export default function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Extract tokens from URL hash (set by backend redirect)
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (!accessToken) {
          logger.error('No access token in callback URL');
          setError('Authentication failed - no access token received');
          setTimeout(() => navigate('/'), 3000);
          return;
        }

        logger.info('Successfully received tokens from backend');

        // Store tokens in localStorage for persistence
        // AuthContext will read these on app load
        localStorage.setItem('workos_access_token', accessToken);
        if (refreshToken) {
          localStorage.setItem('workos_refresh_token', refreshToken);
        }

        // Clear URL hash
        window.history.replaceState(null, '', window.location.pathname);

        // Redirect to app
        logger.info('Redirecting to /app');
        navigate('/app');
      } catch (err) {
        logger.error('Error processing callback:', err);
        setError('An error occurred during authentication');
        setTimeout(() => navigate('/'), 3000);
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        {error ? (
          <>
            <h1 className="text-2xl font-bold text-destructive mb-4">Authentication Error</h1>
            <p className="text-muted-foreground">{error}</p>
            <p className="text-sm text-muted-foreground mt-4">Redirecting...</p>
          </>
        ) : (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <h1 className="text-2xl font-bold mb-2">Completing sign in...</h1>
            <p className="text-muted-foreground">Please wait while we set up your session.</p>
          </>
        )}
      </div>
    </div>
  );
}
