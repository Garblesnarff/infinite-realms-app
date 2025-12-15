import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { workos, authConfig } from '../../services/workos.js';
import { db } from '../../../../db/client.js';
import { users } from '../../../../db/schema/index.js';
import { eq } from 'drizzle-orm';

// Test auth secret - for automated testing only
// SECURITY: No default secret - must be explicitly set in environment
const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET;
const TEST_USER_ID = 'user_TEST_AUTOMATION_BOT_001';

export default function authRouter() {
  const router = Router();

  /**
   * Start OAuth flow - redirect to WorkOS hosted login
   * GET /v1/auth/login
   */
  router.get('/login', (_req, res) => {
    try {
      const authorizationUrl = workos.userManagement.getAuthorizationUrl({
        provider: 'authkit',
        clientId: authConfig.clientId,
        redirectUri: authConfig.redirectUri,
        // Force account selection screen in Google OAuth
        prompt: 'select_account',
      });

      // Redirect user to WorkOS hosted login page
      res.redirect(authorizationUrl);
    } catch (error) {
      console.error('Error generating authorization URL:', error);
      res.status(500).json({ error: 'Failed to generate authorization URL' });
    }
  });

  /**
   * Handle OAuth callback from WorkOS
   * GET /v1/auth/callback?code=xxx
   */
  router.get('/callback', async (req, res) => {
    const { code } = req.query;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing authorization code' });
      return;
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
      // Frontend will extract and store them
      const frontendUrl = process.env.CORS_ORIGIN?.split(',')[0] || 'https://infiniterealms.app';
      const redirectUrl = `${frontendUrl}/auth/callback#access_token=${accessToken}&refresh_token=${refreshToken}`;

      res.redirect(redirectUrl);
    } catch (error) {
      console.error('OAuth callback error:', error);
      const frontendUrl = process.env.CORS_ORIGIN?.split(',')[0] || 'https://infiniterealms.app';
      res.redirect(`${frontendUrl}/?error=auth_failed`);
    }
  });

  /**
   * Test authentication endpoint for automated testing
   * GET /v1/auth/test-login?secret=xxx
   *
   * Returns tokens for the test user without going through WorkOS OAuth.
   * Only works with correct secret to prevent abuse.
   *
   * SECURITY: Disabled in production unless explicitly enabled.
   */
  router.get('/test-login', async (req, res) => {
    // SECURITY: Disable in production environment
    if (process.env.NODE_ENV === 'production' && !process.env.ENABLE_TEST_AUTH) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // SECURITY: Require the secret to be explicitly set (no default)
    if (!TEST_AUTH_SECRET) {
      res.status(403).json({ error: 'Test auth not configured' });
      return;
    }

    const { secret } = req.query;

    // Verify test auth secret
    if (secret !== TEST_AUTH_SECRET) {
      res.status(403).json({ error: 'Invalid test auth secret' });
      return;
    }

    try {
      // Get test user from database
      const testUser = await db.query.users.findFirst({
        where: eq(users.id, TEST_USER_ID),
      });

      if (!testUser) {
        res.status(404).json({ error: 'Test user not found in database' });
        return;
      }

      // Generate a pseudo-JWT token that our verifyWorkOSToken will accept
      // (it only decodes, doesn't verify signature)
      const accessToken = jwt.sign(
        {
          sub: testUser.id,
          email: testUser.email,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
        },
        'test_secret_key', // Any secret works since we don't verify signature
        { algorithm: 'HS256' }
      );

      const refreshToken = jwt.sign(
        { sub: testUser.id, type: 'refresh' },
        'test_secret_key',
        { algorithm: 'HS256', expiresIn: '7d' }
      );

      // Redirect to frontend callback with tokens (same as normal OAuth flow)
      const frontendUrl = process.env.CORS_ORIGIN?.split(',')[0] || 'https://infiniterealms.app';
      const redirectUrl = `${frontendUrl}/auth/callback#access_token=${accessToken}&refresh_token=${refreshToken}`;

      console.log('[TEST AUTH] Generated tokens for test user:', testUser.email);
      res.redirect(redirectUrl);
    } catch (error) {
      console.error('Test login error:', error);
      res.status(500).json({ error: 'Failed to generate test tokens' });
    }
  });

  /**
   * Sign out and clear WorkOS session
   * GET /v1/auth/logout
   */
  router.get('/logout', async (req, res) => {
    const frontendUrl = process.env.CORS_ORIGIN?.split(',')[0] || 'https://infiniterealms.app';

    try {
      // Get session ID from query parameter (passed by frontend)
      const sessionId = req.query.session_id as string;

      if (!sessionId) {
        console.warn('No session ID provided for logout');
        res.redirect(frontendUrl);
        return;
      }

      // Get WorkOS logout URL with return redirect
      const logoutUrl = workos.userManagement.getLogoutUrl({
        sessionId,
        returnTo: frontendUrl,
      });

      // Redirect to WorkOS to terminate the session
      // WorkOS will redirect back to the configured redirect URI in dashboard
      res.redirect(logoutUrl);
    } catch (error) {
      console.error('Logout error:', error);
      // Fallback: redirect to frontend anyway
      res.redirect(frontendUrl);
    }
  });

  return router;
}
