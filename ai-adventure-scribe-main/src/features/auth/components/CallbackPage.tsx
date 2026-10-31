/**
 * OAuth Callback Page
 *
 * Handles the OAuth redirect from backend after WorkOS authentication.
 * The backend sends a one-time exchange code; this page exchanges it for tokens
 * and then redirects to the app.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { finishSignIn } from './finish-sign-in';

import { fetchWithTimeout } from '@/infrastructure/api/fetch-with-timeout';
import logger from '@/lib/logger';

/** Ceiling for the one-time code exchange so a hung backend cannot leave the
 *  page on "Completing sign in..." forever (#565). */
const AUTH_EXCHANGE_TIMEOUT_MS = 15_000;
const RATE_LIMIT_MESSAGE = 'Too many sign-ins at once. Wait a minute, then try again.';
const MISSING_TOKEN_MESSAGE = 'Authentication failed - no access token received';

function saysTooManyRequests(value: unknown): boolean {
  return typeof value === 'string' && value.toLowerCase().includes('too_many_requests');
}

function paramsSayTooManyRequests(params: URLSearchParams): boolean {
  return ['error', 'error_description', 'code'].some((key) => saysTooManyRequests(params.get(key)));
}

async function exchangeSaysTooManyRequests(response: Response): Promise<boolean> {
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') return false;
  const record = body as Record<string, unknown>;
  return [record.code, record.error, record.message, record.error_description].some(
    saysTooManyRequests,
  );
}

function safeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;

  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export default function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const callbackParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        if (paramsSayTooManyRequests(callbackParams) || paramsSayTooManyRequests(hashParams)) {
          setError(RATE_LIMIT_MESSAGE);
          return;
        }

        const exchangeCode = callbackParams.get('code');
        const returnTo = safeReturnTo(callbackParams.get('returnTo'));
        let accessToken: string | null = null;
        let refreshToken: string | null = null;

        if (exchangeCode) {
          const apiUrl = import.meta.env?.VITE_API_URL || '';
          const response = await fetchWithTimeout(
            `${apiUrl}/v1/auth/exchange`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: exchangeCode }),
            },
            AUTH_EXCHANGE_TIMEOUT_MS,
          );

          if (!response.ok) {
            if (await exchangeSaysTooManyRequests(response)) {
              setError(RATE_LIMIT_MESSAGE);
              return;
            }
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
          setError(MISSING_TOKEN_MESSAGE);
          setTimeout(() => navigate('/'), 3000);
          return;
        }

        logger.info('Successfully completed authentication callback');

        // Clear the one-time code or deprecated fragment from browser history.
        window.history.replaceState(null, '', window.location.pathname);

        // Finish sign-in through the shared helper (persist + notify + wait for
        // AuthContext), the same handoff the tester page uses (#1256).
        const signedInEmail = await finishSignIn({
          accessToken,
          ...(refreshToken ? { refreshToken } : {}),
        });

        // Redirect to the campaign that initiated sign-in, or the app for a
        // normal sign-in with no return destination.
        const destination = returnTo ?? '/app';
        logger.info(`Redirecting to ${destination}`);
        // #1122: `authReturn` marks this navigation as the return from sign-in;
        // the campaign page resumes a pending hero only on it.
        if (returnTo) navigate(returnTo, { state: { authReturn: true } });
        else navigate(destination);
        // AuthKit can resume a remembered session without asking for
        // credentials, so always say which account this is (#2292).
        if (signedInEmail) toast.success(`Signed in as ${signedInEmail}`);
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
            {error === RATE_LIMIT_MESSAGE ? (
              <button
                type="button"
                className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                onClick={() => navigate('/')}
              >
                Try again
              </button>
            ) : (
              <p className="text-sm text-muted-foreground mt-4">Redirecting...</p>
            )}
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
