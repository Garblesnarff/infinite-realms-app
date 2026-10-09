import { Elysia } from 'elysia';

import { type AuthUser, authenticateRequest } from '../lib/auth.js';

/**
 * Authenticates every route this plugin is attached to. The user is attached before
 * planRateLimit runs, so the per-user bucket counts it (#193 step 4). A request without a valid
 * token gets 401 `{ error: 'Unauthorized' }` before the handler runs.
 */
export const requireUserAuth = new Elysia({ name: 'require-user-auth' })
  .resolve({ as: 'scoped' }, async ({ request }) => {
    const { user, error } = await authenticateRequest(request);
    // The guard below rejects a missing user before any handler sees it.
    return { user: user as AuthUser, authError: error };
  })
  .onBeforeHandle({ as: 'scoped' }, ({ user, authError, set }) => {
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
  });
