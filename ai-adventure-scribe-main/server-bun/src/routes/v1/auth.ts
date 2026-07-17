/**
 * Auth Routes for Elysia
 *
 * Handles WorkOS OAuth flow:
 * - /v1/auth/login - Start OAuth flow, redirect to WorkOS
 * - /v1/auth/callback - Handle OAuth callback, create/update user
 * - /v1/auth/logout - Sign out user
 * - /v1/auth/test-login - Test automation endpoint (disabled in prod)
 *
 * Ported from /server/src/routes/v1/auth.ts
 */

import crypto from 'crypto';

import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';
import jwt from 'jsonwebtoken';

import { users } from '../../../../db/schema/index';
import { db } from '../../lib/drizzle';
import { logger } from '../../lib/logger';
import { authTokenExchangeRoutes } from './auth-token-exchange.js';
import { authTokenExchangeCodes } from '../../services/auth-token-exchange.js';
import { workos, authConfig } from '../../services/workos';

// Test auth configuration
const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET;
const TEST_USER_ID = 'user_TEST_AUTOMATION_BOT_001';
const OAUTH_STATE_COOKIE = 'ir_oauth_state';
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10; // 10 minutes

if (process.env.NODE_ENV === 'production' && process.env.ENABLE_TEST_AUTH !== undefined) {
  logger.warn({
    msg: 'SECURITY_CONFIG_WARNING',
    alert: true,
    setting: 'ENABLE_TEST_AUTH',
    detail: 'Test authentication is disabled unconditionally in production',
  });
}

function createOAuthState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((entry) => entry.trim());
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.split('=');
    if (key === name) {
      return rest.join('=') || null;
    }
  }
  return null;
}

function buildOAuthStateCookie(value: string, maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${OAUTH_STATE_COOKIE}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

function createFrontendTokenExchangeRedirect(accessToken: string, refreshToken: string): string {
  const exchangeCode = authTokenExchangeCodes.issue({ accessToken, refreshToken });
  const frontendUrl = process.env.CORS_ORIGIN?.split(',')[0] || 'https://infiniterealms.app';
  return `${frontendUrl}/auth/callback?code=${encodeURIComponent(exchangeCode)}`;
}

export const authRoutes = new Elysia({ prefix: '/v1/auth' })
  .use(authTokenExchangeRoutes)
  /**
   * Start OAuth flow - redirect to WorkOS hosted login
   * GET /v1/auth/login
   */
  .get('/login', ({ redirect, request, set }) => {
    try {
      const state = createOAuthState();
      const authorizationUrl = workos.userManagement.getAuthorizationUrl({
        provider: 'authkit',
        clientId: authConfig.clientId,
        redirectUri: authConfig.redirectUri,
        state,
        // Force account selection screen in Google OAuth
        prompt: 'select_account',
      });

      const existingCookie = request.headers.get('cookie');
      const hadPriorState = Boolean(getCookieValue(existingCookie, OAUTH_STATE_COOKIE));
      set.headers['Set-Cookie'] = buildOAuthStateCookie(state, OAUTH_STATE_MAX_AGE_SECONDS);

      if (hadPriorState) {
        logger.warn({ msg: 'Replacing existing OAuth state cookie' });
      }

      return redirect(authorizationUrl);
    } catch (error) {
      logger.error({ msg: 'Error generating authorization URL', error });
      set.status = 500;
      return { error: 'Failed to generate authorization URL' };
    }
  })

  /**
   * Handle OAuth callback from WorkOS
   * GET /v1/auth/callback?code=xxx
   */
  .get('/callback', async ({ query, request, redirect, set }) => {
    const code = query.code as string | undefined;
    const state = query.state as string | undefined;

    const cookieState = getCookieValue(request.headers.get('cookie'), OAUTH_STATE_COOKIE);
    set.headers['Set-Cookie'] = buildOAuthStateCookie('', 0);

    if (!code) {
      set.status = 400;
      return { error: 'Missing authorization code' };
    }

    if (!state || !cookieState || state !== cookieState) {
      logger.warn({
        msg: 'OAuth state validation failed',
        hasState: Boolean(state),
        hasCookieState: Boolean(cookieState),
      });
      set.status = 400;
      return { error: 'Invalid OAuth state' };
    }

    try {
      // Exchange authorization code for user session
      const { user, accessToken, refreshToken } = await workos.userManagement.authenticateWithCode({
        code,
        clientId: authConfig.clientId,
      });

      // ⚡ Bolt: Optimized N+1 query pattern by replacing 'find-then-upsert' with a single atomic UPSERT.
      // This reduces database round-trips from 2 down to 1 for every authentication callback.
      await db
        .insert(users)
        .values({
          id: user.id,
          email: user.email,
          plan: 'free',
          firstName: user.firstName || null,
          lastName: user.lastName || null,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: user.email,
            firstName: user.firstName || null,
            lastName: user.lastName || null,
            updatedAt: new Date(),
          },
        });

      return redirect(createFrontendTokenExchangeRedirect(accessToken, refreshToken));
    } catch (error) {
      logger.error({ msg: 'OAuth callback error', error });
      const frontendUrl = process.env.CORS_ORIGIN?.split(',')[0] || 'https://infiniterealms.app';
      return redirect(`${frontendUrl}/?error=auth_failed`);
    }
  })

  /**
   * Refresh access token using refresh token
   * POST /v1/auth/refresh
   *
   * WorkOS access tokens expire after ~5 minutes by default.
   * Use this endpoint to get a new access token without requiring re-login.
   */
  .post('/refresh', async ({ body, set }) => {
    const refreshToken = (body as any)?.refreshToken as string | undefined;

    if (!refreshToken) {
      set.status = 400;
      return { error: 'Missing refresh token' };
    }

    try {
      // Exchange refresh token for new access token
      const { accessToken, refreshToken: newRefreshToken } =
        await workos.userManagement.authenticateWithRefreshToken({
          refreshToken,
          clientId: authConfig.clientId,
        });

      return {
        accessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      logger.error({ msg: 'Token refresh error', error });
      set.status = 401;
      return { error: 'Failed to refresh token - please log in again' };
    }
  })

  /**
   * Sign out and clear WorkOS session
   * GET /v1/auth/logout?session_id=xxx
   */
  .get('/logout', ({ query, redirect }) => {
    const frontendUrl = process.env.CORS_ORIGIN?.split(',')[0] || 'https://infiniterealms.app';

    try {
      const sessionId = query.session_id as string | undefined;

      if (!sessionId) {
        logger.warn('No session ID provided for logout');
        return redirect(frontendUrl);
      }

      // Get WorkOS logout URL with return redirect
      const logoutUrl = workos.userManagement.getLogoutUrl({
        sessionId,
        returnTo: frontendUrl,
      });

      return redirect(logoutUrl);
    } catch (error) {
      logger.error({ msg: 'Logout error', error });
      return redirect(frontendUrl);
    }
  })

  /**
   * Test authentication endpoint for automated testing
   * GET /v1/auth/test-login (requires x-test-auth-secret header)
   *
   * SECURITY: Available only outside production when ENABLE_TEST_AUTH is set.
   */
  .get('/test-login', async ({ query, headers, redirect, set }) => {
    // SECURITY: Never expose this route in production, regardless of configuration.
    if (process.env.NODE_ENV === 'production' || !process.env.ENABLE_TEST_AUTH) {
      set.status = 404;
      return { error: 'Not found' };
    }

    // SECURITY: Require the secret to be explicitly set
    if (!TEST_AUTH_SECRET) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    const headerSecret = headers['x-test-auth-secret'];
    const querySecret = query.secret as string | undefined;

    if (querySecret) {
      logger.warn({ msg: 'Deprecated test auth query secret usage detected' });
    }

    // Verify test auth secret
    if (headerSecret !== TEST_AUTH_SECRET) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    try {
      // Get test user from database
      const testUser = await db.query.users.findFirst({
        where: eq(users.id, TEST_USER_ID),
      });

      if (!testUser) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }

      // Generate pseudo-JWT tokens
      const accessToken = jwt.sign(
        {
          sub: testUser.id,
          email: testUser.email,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
        },
        TEST_AUTH_SECRET,
        { algorithm: 'HS256' },
      );

      const refreshToken = jwt.sign({ sub: testUser.id, type: 'refresh' }, TEST_AUTH_SECRET, {
        algorithm: 'HS256',
        expiresIn: '7d',
      });

      logger.info({ msg: '[TEST AUTH] Generated tokens for test user', email: testUser.email });
      return redirect(createFrontendTokenExchangeRedirect(accessToken, refreshToken));
    } catch (error) {
      logger.error({ msg: 'Test login error', error });
      set.status = 500;
      return { error: 'Failed to generate test tokens' };
    }
  });
