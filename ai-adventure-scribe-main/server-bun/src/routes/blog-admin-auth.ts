/**
 * Blog Admin Authentication Routes
 *
 * Provides a separate login system for blog administration,
 * independent of WorkOS authentication.
 */

import { Elysia, t } from 'elysia';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { logger } from '../lib/logger';

// Environment variables for blog admin auth
const BLOG_ADMIN_USERNAME = process.env.BLOG_ADMIN_USERNAME;
const BLOG_ADMIN_PASSWORD_HASH = process.env.BLOG_ADMIN_PASSWORD_HASH;
const BLOG_ADMIN_JWT_SECRET = process.env.BLOG_ADMIN_JWT_SECRET;

export const blogAdminAuthRoutes = new Elysia({ prefix: '/v1/blog-admin' })
  /**
   * Blog Admin Login
   * POST /v1/blog-admin/login
   *
   * Authenticates blog admin with username/password and returns a JWT token.
   */
  .post(
    '/login',
    async ({ body, set }) => {
      try {
        const { username, password } = body;

        logger.info('[BlogAdminAuth] Login attempt for:', username);

        // Check if blog admin credentials are configured
        if (!BLOG_ADMIN_USERNAME || !BLOG_ADMIN_PASSWORD_HASH || !BLOG_ADMIN_JWT_SECRET) {
          logger.error('[BlogAdminAuth] Blog admin credentials not configured');
          set.status = 401;
          return { error: 'Invalid credentials' };
        }

        // Verify username
        if (username !== BLOG_ADMIN_USERNAME) {
          logger.warn('[BlogAdminAuth] Invalid username attempt:', username);
          set.status = 401;
          return { error: 'Invalid credentials' };
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, BLOG_ADMIN_PASSWORD_HASH);
        if (!isValidPassword) {
          logger.warn('[BlogAdminAuth] Invalid password attempt for user:', username);
          set.status = 401;
          return { error: 'Invalid credentials' };
        }

        // Generate JWT token
        const token = jwt.sign(
          {
            type: 'blog_admin',
            username: BLOG_ADMIN_USERNAME,
            role: 'admin',
            iat: Math.floor(Date.now() / 1000),
          },
          BLOG_ADMIN_JWT_SECRET,
          { expiresIn: '7d' } // Token valid for 7 days
        );

        logger.info('[BlogAdminAuth] Successful login for:', username);

        return {
          success: true,
          token,
          expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
        };
      } catch (error) {
        logger.error('[BlogAdminAuth] Login error:', error);
        set.status = 500;
        return { error: 'Login failed' };
      }
    },
    {
      body: t.Object({
        username: t.String(),
        password: t.String(),
      }),
      detail: {
        tags: ['Blog Admin'],
        description: 'Authenticate as blog admin',
      },
    }
  )
  /**
   * Verify Blog Admin Token
   * GET /v1/blog-admin/verify
   *
   * Verifies a blog admin JWT token and returns the payload.
   */
  .get(
    '/verify',
    async ({ headers, set }) => {
      const authHeader = headers.authorization;

      if (!BLOG_ADMIN_JWT_SECRET) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }

      const token = authHeader.substring(7);

      try {
        const payload = jwt.verify(token, BLOG_ADMIN_JWT_SECRET) as {
          type: string;
          username: string;
          role: string;
        };

        if (payload.type !== 'blog_admin') {
          set.status = 401;
          return { error: 'Unauthorized' };
        }

        return {
          valid: true,
          username: payload.username,
          role: payload.role,
        };
      } catch (error) {
        logger.warn('[BlogAdminAuth] Token verification failed:', error);
        set.status = 401;
        return { error: 'Unauthorized' };
      }
    },
    {
      detail: {
        tags: ['Blog Admin'],
        description: 'Verify blog admin token',
      },
    }
  )
  /**
   * Blog Admin Logout
   * POST /v1/blog-admin/logout
   *
   * Client-side logout (token invalidation would require a blacklist).
   * Returns success for the client to clear the stored token.
   */
  .post(
    '/logout',
    async () => {
      // Client should clear the token from localStorage
      // Server-side token invalidation would require maintaining a blacklist
      return { success: true, message: 'Logged out successfully' };
    },
    {
      detail: {
        tags: ['Blog Admin'],
        description: 'Logout from blog admin',
      },
    }
  );
