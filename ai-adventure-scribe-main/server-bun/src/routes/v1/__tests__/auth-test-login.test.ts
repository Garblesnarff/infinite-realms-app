import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import jwt from 'jsonwebtoken';

const TEST_AUTH_SECRET = 'test-auth-secret';

process.env.TEST_AUTH_SECRET = TEST_AUTH_SECRET;
process.env.NODE_ENV = 'test';

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const TEST_USER = { id: 'user_TEST_AUTOMATION_BOT_001', email: 'test-bot@example.test' };

let dbUser: { id: string; email: string } | null = { ...TEST_USER };
let refreshCalls: string[] = [];

mock.module('../../../lib/drizzle.js', () => ({
  db: {
    query: {
      users: {
        findFirst: async () => dbUser,
      },
    },
  },
}));
mock.module('../../../lib/logger.js', () => ({ logger }));
mock.module('../../../services/workos.js', () => ({
  workos: {
    userManagement: {
      authenticateWithRefreshToken: async ({ refreshToken }: { refreshToken: string }) => {
        refreshCalls.push(refreshToken);
        return { accessToken: 'workos-access-token', refreshToken: 'workos-refresh-token' };
      },
    },
  },
  authConfig: { clientId: 'test-client', redirectUri: 'http://localhost/auth/callback' },
}));
mock.module('../auth-token-exchange.js', () => ({
  authTokenExchangeRoutes: new Elysia({ name: 'test-auth-token-exchange' }),
}));
mock.module('../../../services/auth-token-exchange.js', () => ({
  authTokenExchangeCodes: { issue: () => 'test-exchange-code' },
}));

const { authRoutes } = await import('../auth.js');
const app = new Elysia().use(authRoutes);

function testLoginRequest() {
  return new Request('http://localhost/v1/auth/test-login', {
    headers: { 'x-test-auth-secret': TEST_AUTH_SECRET },
  });
}

afterEach(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.ENABLE_TEST_AUTH;
  dbUser = { ...TEST_USER };
  refreshCalls = [];
});

describe('GET /v1/auth/test-login', () => {
  it('returns 404 in production even when test auth is enabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_TEST_AUTH = '1';

    const response = await app.handle(testLoginRequest());

    expect(response.status).toBe(404);
  });

  it('mints a test login redirect outside production when explicitly enabled', async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_TEST_AUTH = '1';

    const response = await app.handle(testLoginRequest());

    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).not.toBeNull();
    const callbackUrl = new URL(location!);
    expect(callbackUrl.pathname).toBe('/auth/callback');
    expect(callbackUrl.searchParams.get('code')).toBe('test-exchange-code');
  });

  it('returns 404 outside production when test auth is not enabled', async () => {
    process.env.NODE_ENV = 'test';

    const response = await app.handle(testLoginRequest());

    expect(response.status).toBe(404);
  });
});

describe('POST /v1/auth/refresh', () => {
  function refreshRequest(refreshToken: string) {
    return new Request('http://localhost/v1/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  }

  function signRefreshToken(sub = TEST_USER.id) {
    return jwt.sign({ sub, type: 'refresh' }, TEST_AUTH_SECRET, {
      algorithm: 'HS256',
      expiresIn: '7d',
    });
  }

  it('returns a new test token pair for a test refresh token off-production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_TEST_AUTH = '1';

    const response = await app.handle(refreshRequest(signRefreshToken()));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { accessToken: string; refreshToken: string };
    expect(jwt.verify(body.accessToken, TEST_AUTH_SECRET) as jwt.JwtPayload).toMatchObject({
      sub: TEST_USER.id,
      type: 'access',
    });
    expect(jwt.verify(body.refreshToken, TEST_AUTH_SECRET) as jwt.JwtPayload).toMatchObject({
      sub: TEST_USER.id,
      type: 'refresh',
    });
    expect(refreshCalls).toHaveLength(0);
  });

  it('returns 401 off-production when the test user row is missing', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_TEST_AUTH = '1';
    dbUser = null;

    const response = await app.handle(refreshRequest(signRefreshToken()));

    expect(response.status).toBe(401);
  });

  it('falls through to WorkOS in production even for a test refresh token', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_TEST_AUTH = '1';

    const token = signRefreshToken();
    const response = await app.handle(refreshRequest(token));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accessToken: 'workos-access-token',
      refreshToken: 'workos-refresh-token',
    });
    expect(refreshCalls).toEqual([token]);
  });
});
