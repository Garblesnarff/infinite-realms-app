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

import { Elysia } from 'elysia';
import jwt from 'jsonwebtoken';
import { workos, authConfig } from '../../services/workos';
import { db } from '../../lib/drizzle';
import { users } from '../../../../db/schema/index';
import { eq } from 'drizzle-orm';

// Test auth configuration
const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET;
const TEST_USER_ID = 'user_TEST_AUTOMATION_BOT_001';

export const authRoutes = new Elysia({ prefix: '/v1/auth' })
  /**
   * Start OAuth flow - redirect to WorkOS hosted login
   * GET /v1/auth/login
   */
  .get('/login', ({ redirect, set }) => {
    try {
      const authorizationUrl = workos.userManagement.getAuthorizationUrl({
        provider: 'authkit',
        clientId: authConfig.clientId,
        redirectUri: authConfig.redirectUri,
        // Force account selection screen in Google OAuth
        prompt: 'select_account',
      });

      return redirect(authorizationUrl);
    } catch (error) {
      console.error('Error generating authorization URL:', error);
      set.status = 500;
      return { error: 'Failed to generate authorization URL' };
    }
  })

  /**
   * Handle OAuth callback from WorkOS
   * GET /v1/auth/callback?code=xxx
   */
  .get('/callback', async ({ query, redirect, set }) => {
    const code = query.code as string | undefined;

    if (!code) {
      set.status = 400;
      return { error: 'Missing authorization code' };
    }

    try {
      // Exchange authorization code for user session
      const { user, accessToken, refreshToken } =
        await workos.userManagement.authenticateWithCode({
          code,
          clientId: authConfig.clientId,
        });

      // Create or update user in database
      const existingUser = await db.query.users.findFirst({
        where: eq(users.id, user.id),
      });

      if (!existingUser) {
        // Create new user with free plan by default
        await db.insert(users).values({
          id: user.id,
          email: user.email,
          plan: 'free',
          firstName: user.firstName || null,
          lastName: user.lastName || null,
        });
      } else {
        // Update existing user info
        await db
          .update(users)
          .set({
            email: user.email,
            firstName: user.firstName || null,
            lastName: user.lastName || null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
      }

      // Redirect to frontend with tokens in URL hash
      const frontendUrl = process.env.CORS_ORIGIN?.split(',')[0] || 'https://infiniterealms.app';
      const redirectUrl = `${frontendUrl}/auth/callback#access_token=${accessToken}&refresh_token=${refreshToken}`;

      return redirect(redirectUrl);
    } catch (error) {
      console.error('OAuth callback error:', error);
      const frontendUrl = process.env.CORS_ORIGIN?.split(',')[0] || 'https://infiniterealms.app';
      return redirect(`${frontendUrl}/?error=auth_failed`);
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
        console.warn('No session ID provided for logout');
        return redirect(frontendUrl);
      }

      // Get WorkOS logout URL with return redirect
      const logoutUrl = workos.userManagement.getLogoutUrl({
        sessionId,
        returnTo: frontendUrl,
      });

      return redirect(logoutUrl);
    } catch (error) {
      console.error('Logout error:', error);
      return redirect(frontendUrl);
    }
  })

  /**
   * Test authentication endpoint for automated testing
   * GET /v1/auth/test-login?secret=xxx
   *
   * SECURITY: Disabled in production unless ENABLE_TEST_AUTH is set.
   */
  .get('/test-login', async ({ query, redirect, set }) => {
    // SECURITY: Disable in production environment
    if (process.env.NODE_ENV === 'production' && !process.env.ENABLE_TEST_AUTH) {
      set.status = 404;
      return { error: 'Not found' };
    }

    // SECURITY: Require the secret to be explicitly set
    if (!TEST_AUTH_SECRET) {
      set.status = 403;
      return { error: 'Test auth not configured' };
    }

    const secret = query.secret as string | undefined;

    // Verify test auth secret
    if (secret !== TEST_AUTH_SECRET) {
      set.status = 403;
      return { error: 'Invalid test auth secret' };
    }

    try {
      // Get test user from database
      const testUser = await db.query.users.findFirst({
        where: eq(users.id, TEST_USER_ID),
      });

      if (!testUser) {
        set.status = 404;
        return { error: 'Test user not found in database' };
      }

      // Generate pseudo-JWT tokens
      const accessToken = jwt.sign(
        {
          sub: testUser.id,
          email: testUser.email,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
        },
        'test_secret_key',
        { algorithm: 'HS256' }
      );

      const refreshToken = jwt.sign(
        { sub: testUser.id, type: 'refresh' },
        'test_secret_key',
        { algorithm: 'HS256', expiresIn: '7d' }
      );

      // Redirect to frontend callback with tokens
      const frontendUrl = process.env.CORS_ORIGIN?.split(',')[0] || 'https://infiniterealms.app';
      const redirectUrl = `${frontendUrl}/auth/callback#access_token=${accessToken}&refresh_token=${refreshToken}`;

      console.log('[TEST AUTH] Generated tokens for test user:', testUser.email);
      return redirect(redirectUrl);
    } catch (error) {
      console.error('Test login error:', error);
      set.status = 500;
      return { error: 'Failed to generate test tokens' };
    }
  });
