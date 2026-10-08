/**
 * Authentication Middleware for Elysia
 *
 * requireAuth: Requires valid authentication, returns 401 if missing/invalid.
 *
 * Usage:
 * ```typescript
 * import { requireAuth } from './middleware/auth';
 *
 * app.use(requireAuth).get('/protected', ({ user }) => {
 *   return { userId: user.userId };
 * });
 * ```
 */

import { Elysia, status } from 'elysia';

import { authenticateRequest } from '../lib/auth.js';
import { logger } from '../lib/logger.js';

export interface AuthTokenPayload {
  userId: string;
  email?: string;
  plan?: string;
}

/**
 * Required authentication plugin
 * Returns 401 if token is missing or invalid
 * Attaches user to context on success
 *
 * This is a `.resolve()` hook (beforeHandle). Elysia still parses TypeBox
 * `body` schemas before it runs, so a required `body: t.Object(...)` on the
 * same route 422s unauthenticated callers with a missing body (#2120). Do not
 * move this to `.onRequest()`: unscoped `onRequest` on this plugin leaks to
 * every route in the app (including public ones), and `{ as: 'scoped' }` on
 * `onRequest` crashes this Elysia version's composer. Routes that must 401
 * regardless of body should validate the body in the handler.
 */
export const requireAuth = new Elysia({ name: 'require-auth' }).resolve(
  { as: 'scoped' },
  async ({ request }) => {
    const { user, error } = await authenticateRequest(request);

    if (!user) {
      logger.warn({
        route: new URL(request.url).pathname,
        authOutcome: 'rejected',
        bodyLength: JSON.stringify({ error: error || 'Unauthorized' }).length,
        msg: 'auth.decision',
      });
      return status(401, { error: error || 'Unauthorized', code: 'unauthorized' });
    }

    logger.debug({
      route: new URL(request.url).pathname,
      authOutcome: 'accepted',
      msg: 'auth.decision',
    });

    return { user };
  },
);
