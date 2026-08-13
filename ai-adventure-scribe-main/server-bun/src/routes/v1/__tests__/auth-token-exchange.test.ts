import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import { AuthTokenExchangeCodeStore } from '../../../services/auth-token-exchange.js';
import { createAuthTokenExchangeRoutes } from '../auth-token-exchange.js';

function createTestApp(store: AuthTokenExchangeCodeStore, key: string) {
  return new Elysia({ prefix: '/v1/auth' }).use(
    createAuthTokenExchangeRoutes({
      codeStore: store,
      rateLimit: { windowMs: 60_000, max: 2, key },
    }),
  );
}

function exchangeRequest(code: string) {
  return new Request('http://localhost/v1/auth/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

describe('POST /v1/auth/exchange', () => {
  it('exchanges a valid code once and rejects its replay', async () => {
    const store = new AuthTokenExchangeCodeStore();
    const app = createTestApp(store, `auth-exchange-once-${Date.now()}`);
    const code = store.issue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
    });

    const first = await app.handle(exchangeRequest(code));
    const firstBody = await first.json();
    const replay = await app.handle(exchangeRequest(code));

    expect(first.status).toBe(200);
    expect(typeof firstBody.accessToken).toBe('string');
    expect(typeof firstBody.refreshToken).toBe('string');
    expect(replay.status).toBe(401);
  });

  it('rejects expired codes', async () => {
    let now = 0;
    const store = new AuthTokenExchangeCodeStore(() => now);
    const app = createTestApp(store, `auth-exchange-expired-${Date.now()}`);
    const code = store.issue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
    });
    now = 60_001;

    const response = await app.handle(exchangeRequest(code));

    expect(response.status).toBe(401);
  });
});
