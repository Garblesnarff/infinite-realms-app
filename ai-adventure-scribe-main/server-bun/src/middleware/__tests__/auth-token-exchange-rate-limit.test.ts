import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import { createAuthTokenExchangeRoutes } from '../../routes/v1/auth-token-exchange.js';
import { AuthTokenExchangeCodeStore } from '../../services/auth-token-exchange.js';

function exchangeRequest(code: string) {
  return new Request('http://localhost/v1/auth/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

describe('auth token exchange rate limiting', () => {
  it('fires for repeated exchange attempts', async () => {
    const app = new Elysia({ prefix: '/v1/auth' }).use(
      createAuthTokenExchangeRoutes({
        codeStore: new AuthTokenExchangeCodeStore(),
        rateLimit: { windowMs: 60_000, max: 2, key: `auth-exchange-rate-${Date.now()}` },
      }),
    );

    expect((await app.handle(exchangeRequest('missing-1'))).status).toBe(401);
    expect((await app.handle(exchangeRequest('missing-2'))).status).toBe(401);
    expect((await app.handle(exchangeRequest('missing-3'))).status).toBe(429);
  });
});
