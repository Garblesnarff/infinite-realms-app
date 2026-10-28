/**
 * Hidden tester sign-in page (#1256).
 *
 * Not linked from anywhere and `noindex`: it exists so an automation-driven
 * browser that cannot pass the WorkOS hosted page's Turnstile check can still
 * sign in as an allowlisted tester. The form shows only when
 * VITE_TESTER_LOGIN=true (a convenience; the server allowlist in #1257 is
 * the security control). Sign-in finishes through the same helper the OAuth
 * callback uses.
 */

import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { finishSignIn } from './finish-sign-in';

import { isTesterLoginEnabled } from '@/config/featureFlags';
import { fetchWithTimeout } from '@/infrastructure/api/fetch-with-timeout';
import logger from '@/lib/logger';

/** Ceiling for the password-login POST so a hung backend cannot leave the
 *  page on "Signing in..." forever (#565). */
const TESTER_LOGIN_TIMEOUT_MS = 15_000;

const NOT_ENABLED_MESSAGE = 'Tester sign-in is not enabled';

export default function TesterLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isTesterLoginEnabled()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Helmet>
          <meta name="robots" content="noindex, nofollow" />
          <title>Tester sign-in | InfiniteRealms</title>
        </Helmet>
        <p className="text-muted-foreground">{NOT_ENABLED_MESSAGE}</p>
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const apiUrl = import.meta.env?.VITE_API_URL || '';
      const response = await fetchWithTimeout(
        `${apiUrl}/v1/auth/password-login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        },
        TESTER_LOGIN_TIMEOUT_MS,
      );

      if (response.status === 404) {
        setError(NOT_ENABLED_MESSAGE);
        return;
      }
      if (!response.ok) {
        // Log the status only: never the email or password (#1257).
        logger.error(`Tester sign-in failed (${response.status})`);
        setError('Sign-in failed. Check your email and password and try again.');
        return;
      }

      const tokens = (await response.json()) as {
        accessToken?: string;
        refreshToken?: string;
      };
      if (!tokens.accessToken) {
        logger.error('Tester sign-in returned no access token');
        setError('Sign-in failed. Check your email and password and try again.');
        return;
      }

      const signedInEmail = await finishSignIn({
        accessToken: tokens.accessToken,
        ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      });
      navigate('/app');
      // Always say which account this is (#2292).
      if (signedInEmail) toast.success(`Signed in as ${signedInEmail}`);
    } catch (err) {
      logger.error('Error during tester sign-in:', err);
      setError('Sign-in failed. Check your email and password and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Helmet>
        <meta name="robots" content="noindex, nofollow" />
        <title>Tester sign-in | InfiniteRealms</title>
      </Helmet>
      <div className="w-full max-w-sm px-4">
        <h1 className="text-2xl font-bold mb-2">Tester sign-in</h1>
        <p className="text-muted-foreground mb-6">
          Sign in with a tester account to continue to the app.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="tester-email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <input
              id="tester-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="mb-4">
            <label htmlFor="tester-password" className="block text-sm font-medium mb-1">
              Password
            </label>
            <input
              id="tester-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-sm mb-4">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
