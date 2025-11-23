import { Router } from 'express';
import { workos, authConfig } from '../../services/workos.js';
import { db } from '../../../../db/client.js';
import { users } from '../../../../db/schema/index.js';
import { eq } from 'drizzle-orm';

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

  return router;
}
