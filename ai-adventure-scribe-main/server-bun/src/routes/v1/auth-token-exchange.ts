import { Elysia, t } from 'elysia';

import { createSimpleRateLimit } from '../../middleware/rate-limit.js';
import {
  authTokenExchangeCodes,
  AuthTokenExchangeCodeStore,
} from '../../services/auth-token-exchange.js';

const DEFAULT_RATE_LIMIT = {
  windowMs: 60_000,
  max: 10,
  key: 'auth-token-exchange',
};

interface AuthTokenExchangeRouteOptions {
  codeStore?: AuthTokenExchangeCodeStore;
  rateLimit?: typeof DEFAULT_RATE_LIMIT;
}

/**
 * Kept as a child plugin so createSimpleRateLimit applies only to the exchange
 * endpoint. Its { as: 'scoped' } hook semantics are required by that middleware.
 */
export function createAuthTokenExchangeRoutes({
  codeStore = authTokenExchangeCodes,
  rateLimit = DEFAULT_RATE_LIMIT,
}: AuthTokenExchangeRouteOptions = {}) {
  return new Elysia({ name: 'auth-token-exchange' }).use(createSimpleRateLimit(rateLimit)).post(
    '/exchange',
    ({ body, set }) => {
      const tokens = codeStore.consume(body.code);
      if (!tokens) {
        set.status = 401;
        return { error: 'Invalid or expired exchange code' };
      }

      return tokens;
    },
    {
      body: t.Object({ code: t.String({ minLength: 1, maxLength: 128 }) }),
    },
  );
}

export const authTokenExchangeRoutes = createAuthTokenExchangeRoutes();
