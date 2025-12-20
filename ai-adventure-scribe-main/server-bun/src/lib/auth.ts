/**
 * Request Authentication
 *
 * Provides direct authentication for REST routes, using the same
 * pattern as tRPC context creation (which works correctly).
 *
 * This bypasses Elysia's plugin/derive system which has context
 * propagation issues.
 */

import { getBearerToken } from './jwt.js';
import { verifyWorkOSToken } from '../services/workos.js';
import { sql } from './db.js';
import { logger } from './logger.js';

export interface AuthUser {
  userId: string;
  email?: string;
  plan: string;
}

export interface AuthResult {
  user: AuthUser | null;
  error: string | null;
}

/**
 * Resolve user's subscription plan from database
 */
async function resolveUserPlan(userId: string): Promise<string> {
  try {
    const rows = await sql`SELECT plan FROM users WHERE id = ${userId} LIMIT 1`;
    if (rows?.[0]?.plan) {
      return String(rows[0].plan).toLowerCase();
    }
  } catch (e) {
    logger.warn('Failed to resolve user plan from database:', e);
  }
  return 'free';
}

/**
 * Authenticate request and return user.
 *
 * Call this at the start of each protected route handler.
 * Uses the same verification logic as tRPC context (which works).
 *
 * @param request - The Fetch API Request object
 * @returns AuthResult with user if authenticated, or error message
 *
 * @example
 * ```typescript
 * .get('/quota', async ({ request, set }) => {
 *   const { user, error } = await authenticateRequest(request);
 *   if (error || !user) {
 *     set.status = 401;
 *     return { error: error || 'Unauthorized' };
 *   }
 *   // user is guaranteed to be valid here
 * })
 * ```
 */
export async function authenticateRequest(request: Request): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization');
  const token = getBearerToken(authHeader);

  if (!token) {
    return { user: null, error: 'Missing token' };
  }

  try {
    const workosUser = await verifyWorkOSToken(token);
    if (!workosUser) {
      return { user: null, error: 'Invalid token' };
    }

    const plan = await resolveUserPlan(workosUser.userId);

    return {
      user: {
        userId: workosUser.userId,
        email: workosUser.email,
        plan,
      },
      error: null,
    };
  } catch (error) {
    // Log detailed error for debugging token issues
    if (error instanceof Error) {
      const isExpired = error.message.includes('exp') || error.message.includes('expired');
      const errorType = isExpired ? 'Token expired' : 'Verification failed';
      logger.warn({
        msg: 'AUTH_VERIFICATION_FAILED',
        errorType,
        errorMessage: error.message,
        errorName: error.name,
      });
      return { user: null, error: isExpired ? 'Token expired' : 'Invalid token' };
    }
    logger.error('Auth verification failed:', error);
    return { user: null, error: 'Invalid token' };
  }
}
