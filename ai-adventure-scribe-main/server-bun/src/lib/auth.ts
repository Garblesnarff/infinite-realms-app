/**
 * Request Authentication
 *
 * Provides direct authentication for REST routes, using the same
 * pattern as tRPC context creation (which works correctly).
 *
 * This bypasses Elysia's plugin/derive system which has context
 * propagation issues.
 */

import { sql } from './db.js';
import { getBearerToken } from './jwt.js';
import { logger } from './logger.js';
import { UserPlanCache } from './user-plan-cache.js';
import { verifyWorkOSToken } from '../services/workos.js';

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
  // ⚡ Bolt: Check in-memory cache first to avoid redundant O(1) query per request
  const cachedPlan = UserPlanCache.get(userId);
  if (cachedPlan) return cachedPlan;

  try {
    const rows = await sql`SELECT plan FROM users WHERE id = ${userId} LIMIT 1`;
    if (rows?.[0]?.plan) {
      const plan = String(rows[0].plan).toLowerCase();
      // ⚡ Bolt: Cache the result for 5 minutes
      UserPlanCache.set(userId, plan);
      return plan;
    }
  } catch (e) {
    logger.warn({ error: e }, 'Failed to resolve user plan from database:');
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
    return { user: null, error: 'Unauthorized' };
  }

  try {
    const workosUser = await verifyWorkOSToken(token);
    if (!workosUser) {
      return { user: null, error: 'Unauthorized' };
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
      return { user: null, error: 'Unauthorized' };
    }
    logger.error({ error: error }, 'Auth verification failed:');
    return { user: null, error: 'Unauthorized' };
  }
}
