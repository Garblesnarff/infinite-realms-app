/**
 * Authentication Middleware for Elysia
 *
 * Provides WorkOS authentication as Elysia plugins:
 * - requireAuth: Requires valid authentication, returns 401 if missing/invalid
 * - optionalAuth: Attaches user to context if authenticated, continues if not
 *
 * Usage:
 * ```typescript
 * import { requireAuth, optionalAuth } from './middleware/auth';
 *
 * // Protect a route
 * app.use(requireAuth).get('/protected', ({ user }) => {
 *   return { userId: user.userId };
 * });
 *
 * // Optional auth (e.g., for rate limiting)
 * app.use(optionalAuth).get('/public', ({ user }) => {
 *   return { greeting: user ? `Hello ${user.email}` : 'Hello guest' };
 * });
 * ```
 */

import { Elysia } from 'elysia';
import { jwtVerify, createRemoteJWKSet } from 'jose';

import { sql } from '../lib/db.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

export interface AuthTokenPayload {
  userId: string;
  email?: string;
  plan?: string;
}

// Create JWKS for WorkOS token verification (cached across requests)
const JWKS = createRemoteJWKSet(
  new URL(`https://api.workos.com/sso/jwks/${env.WORKOS_CLIENT_ID}`),
  {
    cooldownDuration: 1000 * 60 * 5, // 5 minutes cooldown for JWKS refresh
  }
);

/**
 * Extract Bearer token from Authorization header
 */
function getBearerToken(authHeader?: string | null): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * Verify WorkOS JWT access token with signature verification
 */
async function verifyWorkOSToken(accessToken: string) {
  try {
    // Verify JWT signature using WorkOS JWKS endpoint
    // WorkOS User Management tokens use issuer with client ID
    const { payload } = await jwtVerify(accessToken, JWKS, {
      issuer: `https://api.workos.com/user_management/${env.WORKOS_CLIENT_ID}`,
    });

    // Extract user information from verified token
    if (!payload.sub) {
      logger.error('WorkOS token missing sub claim');
      return null;
    }

    return {
      userId: payload.sub as string,
      email: payload.email as string,
    };
  } catch (error) {
    if (error instanceof Error) {
      logger.error('WorkOS token verification failed:', error.message);
    } else {
      logger.error('WorkOS token verification failed:', error);
    }
    return null;
  }
}

/**
 * Resolve user plan from database or headers
 * 1. Check X-Plan header (for tests)
 * 2. Query database users table
 * 3. Default to 'free'
 */
async function resolveUserPlan(userId: string, headers: Record<string, string | undefined>): Promise<string> {
  // 1) Explicit header override (useful for tests): X-Plan: free|pro|enterprise
  const hdr = headers['x-plan']?.toLowerCase();
  if (hdr && process.env.NODE_ENV !== 'production') return hdr;

  // 2) Try to resolve from Postgres users table
  try {
    const rows = await sql`SELECT plan FROM users WHERE id = ${userId} LIMIT 1`;
    if (rows?.[0]?.plan) {
      return String(rows[0].plan).toLowerCase();
    }
  } catch (error) {
    logger.error('Failed to resolve user plan from database:', error);
  }

  // 3) Default
  return 'free';
}

/**
 * Required authentication plugin
 * Returns 401 if token is missing or invalid
 * Attaches user to context on success
 */
export const requireAuth = new Elysia({ name: 'require-auth' })
  .derive(async ({ request, set }) => {
    const authHeader = request.headers.get('authorization');
    const token = getBearerToken(authHeader);

    if (!token) {
      set.status = 401;
      return {
        user: null,
        error: { error: 'Missing token' },
      };
    }

    try {
      const workosUser = await verifyWorkOSToken(token);
      if (!workosUser) {
        set.status = 401;
        return {
          user: null,
          error: { error: 'Invalid token' },
        };
      }

      // Convert headers to record for plan resolution
      const headersRecord: Record<string, string | undefined> = {};
      request.headers.forEach((value, key) => {
        headersRecord[key] = value;
      });

      const plan = await resolveUserPlan(workosUser.userId, headersRecord);

      return {
        user: {
          userId: workosUser.userId,
          email: workosUser.email,
          plan,
        } as AuthTokenPayload,
        error: null,
      };
    } catch (error) {
      logger.error('Auth error:', error);
      set.status = 401;
      return {
        user: null,
        error: { error: 'Invalid token' },
      };
    }
  })
  .onBeforeHandle(({ user, error, set }) => {
    // Short-circuit if auth failed
    if (error) {
      set.status = 401;
      return error;
    }
  });

/**
 * Optional authentication plugin
 * Attaches user to context if authenticated, but allows request to continue if not
 * Useful for routes that work for both authenticated and unauthenticated users
 */
export const optionalAuth = new Elysia({ name: 'optional-auth' })
  .derive(async ({ request }) => {
    const authHeader = request.headers.get('authorization');
    const token = getBearerToken(authHeader);

    if (!token) {
      return { user: null };
    }

    try {
      const workosUser = await verifyWorkOSToken(token);
      if (!workosUser) {
        return { user: null };
      }

      // Convert headers to record for plan resolution
      const headersRecord: Record<string, string | undefined> = {};
      request.headers.forEach((value, key) => {
        headersRecord[key] = value;
      });

      const plan = await resolveUserPlan(workosUser.userId, headersRecord);

      return {
        user: {
          userId: workosUser.userId,
          email: workosUser.email,
          plan,
        } as AuthTokenPayload,
      };
    } catch (error) {
      logger.debug('Optional auth failed, continuing without user:', error);
      return { user: null };
    }
  });
