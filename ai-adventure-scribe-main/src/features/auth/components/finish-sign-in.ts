import logger from '@/lib/logger';
import { persistSession } from '@/services/auth/TokenService';

/** Ceiling for AuthContext to verify the session and fire `auth-ready` (#1256). */
const AUTH_READY_TIMEOUT_MS = 5_000;

export interface SignInTokens {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Complete a browser sign-in the way the OAuth callback does (#1256): persist
 * the token pair, notify AuthContext, and wait until it has verified the
 * session (or the ceiling fires). Returns the signed-in email from the
 * `auth-ready` event detail, or null when the wait timed out.
 */
export async function finishSignIn(tokens: SignInTokens): Promise<string | null> {
  // Keep the established TokenService storage and AuthContext event flow.
  persistSession({
    access_token: tokens.accessToken,
    ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}),
  });

  // Notify AuthContext that tokens have been updated
  logger.info('Dispatching auth-tokens-updated event');
  window.dispatchEvent(new CustomEvent('auth-tokens-updated'));

  // Wait for AuthContext to verify and set user before navigating
  let signedInEmail: string | null = null;
  const authReadyPromise = new Promise<void>((resolve) => {
    const handleAuthReady = (event: Event) => {
      logger.info('Received auth-ready event');
      window.removeEventListener('auth-ready', handleAuthReady);
      signedInEmail =
        (event as CustomEvent<{ user?: { email?: string | null } }>).detail?.user?.email ?? null;
      resolve();
    };
    window.addEventListener('auth-ready', handleAuthReady);
  });

  // Add timeout fallback (5 seconds) in case event doesn't fire
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      logger.warn('Auth ready timeout reached, proceeding anyway');
      resolve();
    }, AUTH_READY_TIMEOUT_MS);
  });

  // Wait for either auth-ready event or timeout
  await Promise.race([authReadyPromise, timeoutPromise]);
  return signedInEmail;
}
