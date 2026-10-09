import { Elysia } from 'elysia';

import { type AuthUser, authenticateRequest } from '../lib/auth.js';

/**
 * Attaches the authenticated user to every route this plugin is attached to. It never
 * rejects, so planRateLimit, which runs after it, counts unauthenticated requests per IP
 * (#193 step 4). `user` is null when the request has no valid token; requireUserAuth
 * rejects those before any handler runs.
 */
export const resolveUser = new Elysia({ name: 'resolve-user' }).resolve(
  { as: 'scoped' },
  async ({ request }) => {
    const { user, error } = await authenticateRequest(request);
    return { user: user as AuthUser, authError: error };
  },
);

/**
 * Rejects a request with no user using 401 `{ error: 'Unauthorized' }`. Attach it after
 * planRateLimit, so the rate limit has already counted the request (#193 step 4).
 */
export const requireUserAuth = new Elysia({ name: 'require-user-auth' }).onBeforeHandle(
  { as: 'scoped' },
  (context) => {
    const { user, authError, set } = context as unknown as {
      user: AuthUser | null;
      authError: string | null | undefined;
      set: { status?: number };
    };
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
  },
);
