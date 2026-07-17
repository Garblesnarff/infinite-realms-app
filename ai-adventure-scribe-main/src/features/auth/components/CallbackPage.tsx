/**
 * OAuth Callback Page
 *
 * Handles the OAuth redirect from backend after WorkOS authentication.
 * The backend sends a one-time exchange code; this page exchanges it for tokens
 * and then redirects to the app.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import logger from '@/lib/logger';
import { persistSession } from '@/services/auth/TokenService';

export default function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const exchangeCode = new URLSearchParams(window.location.search).get('code');
        let accessToken: string | null = null;
        let refreshToken: string | null = null;

        if (exchangeCode) {
          const apiUrl = import.meta.env?.VITE_API_URL || '';
          const response = await fetch(`${apiUrl}/v1/auth/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: exchangeCode }),
          });

          if (!response.ok) {
            throw new Error(`Token exchange failed (${response.status})`);
          }

          const tokens = await response.json();
          accessToken = tokens.accessToken;
          refreshToken = tokens.refreshToken;
        } else {
          // Deprecated deploy-compatibility fallback. Remove after all server
          // instances no longer redirect with fragment tokens.
          const params = new URLSearchParams(window.location.hash.substring(1));
          accessToken = params.get('access_token');
          refreshToken = params.get('refresh_token');
        }

        if (!accessToken) {
          logger.error('No auth token received from callback');
          setError('Authentication failed - no access token received');
          setTimeout(() => navigate('/'), 3000);
          return;
        }

        logger.info('Successfully completed authentication callback');

        // Keep the established TokenService storage and AuthContext event flow.
        persistSession({
          access_token: accessToken,
          ...(refreshToken ? { refresh_token: refreshToken } : {}),
        });

        // Clear the one-time code or deprecated fragment from browser history.
        window.history.replaceState(null, '', window.location.pathname);

        // Notify AuthContext that tokens have been updated
        logger.info('Dispatching auth-tokens-updated event');
        window.dispatchEvent(new CustomEvent('auth-tokens-updated'));

        // Wait for AuthContext to verify and set user before navigating
        const authReadyPromise = new Promise<void>((resolve) => {
          const handleAuthReady = () => {
            logger.info('Received auth-ready event, proceeding to /app');
            window.removeEventListener('auth-ready', handleAuthReady);
            resolve();
          };
          window.addEventListener('auth-ready', handleAuthReady);
        });

        // Add timeout fallback (5 seconds) in case event doesn't fire
        const timeoutPromise = new Promise<void>((resolve) => {
          setTimeout(() => {
            logger.warn('Auth ready timeout reached, proceeding to /app anyway');
            resolve();
          }, 5000);
        });

        // Wait for either auth-ready event or timeout
        await Promise.race([authReadyPromise, timeoutPromise]);

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
