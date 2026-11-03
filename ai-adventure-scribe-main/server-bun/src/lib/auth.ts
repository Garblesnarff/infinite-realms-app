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
import { logger } from './logger.js';
import { verifyTestAccessToken } from './test-auth.js';
import { resolveUserPlan } from './user-plan.js';
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
 * Plan resolution lives in ./user-plan.js (split out so routes needing a
 * fail-closed lookup don't import a new name from this wholesale-mocked module).
 * resolveUserPlan is re-exported here so existing import paths keep working;
 * resolveUserPlanStrict is deliberately NOT re-exported — import it from
 * ./user-plan.js, so no new name from this mocked module is ever imported.
 */
export { resolveUserPlan } from './user-plan.js';

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
    const testUser = verifyTestAccessToken(token);
    if (testUser) {
      return {
        user: {
          userId: testUser.userId,
          email: testUser.email,
          plan: await resolveUserPlan(testUser.userId),
        },
        error: null,
      };
    }

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
