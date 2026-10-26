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
let lastAuthorizationUrl: URL | null = null;

mock.module('../../../lib/drizzle.js', () => ({
  db: {
    query: {
      users: {
        findFirst: async () => dbUser,
      },
    },
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => undefined,
      }),
    }),
  },
}));
mock.module('../../../lib/logger.js', () => ({ logger }));
mock.module('../../../services/account-relink.js', () => ({
  relinkWorkosAccountIfNeeded: async () => undefined,
}));
mock.module('../../../services/workos.js', () => ({
  workos: {
    userManagement: {
      getAuthorizationUrl: (options: { state: string }) => {
        lastAuthorizationUrl = new URL(
          `https://auth.example.test/authorize?state=${options.state}`,
        );
        return lastAuthorizationUrl.toString();
      },
      authenticateWithCode: async () => ({
        user: { id: TEST_USER.id, email: TEST_USER.email, emailVerified: true },
        accessToken: 'workos-access-token',
        refreshToken: 'workos-refresh-token',
      }),
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
  lastAuthorizationUrl = null;
});

describe('GET /v1/auth/login return destinations', () => {
  it('carries a same-origin return path through the real callback route', async () => {
    const login = await app.handle(
      new Request(
        'http://localhost/v1/auth/login?returnTo=%2Fexplore%2Fthe-eternal-feast%23heroes',
      ),
    );

    expect(login.status).toBe(302);
    expect(lastAuthorizationUrl).not.toBeNull();
    const state = lastAuthorizationUrl!.searchParams.get('state');
    const cookie = login.headers.get('set-cookie');
    expect(state).not.toBeNull();
    expect(cookie).toContain(`ir_oauth_state=${state}`);

    const callback = await app.handle(
      new Request(`http://localhost/v1/auth/callback?code=callback-code&state=${state}`, {
        headers: { cookie: cookie!.split(';')[0] },
      }),
    );

    expect(callback.status).toBe(302);
    const location = new URL(callback.headers.get('location')!);
    expect(location.pathname).toBe('/auth/callback');
    expect(location.searchParams.get('returnTo')).toBe('/explore/the-eternal-feast#heroes');
  });

  it('refuses an off-site return destination at the real login route', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/auth/login?returnTo=https%3A%2F%2Fevil.example%2Fsteal'),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid return destination' });
    expect(lastAuthorizationUrl).toBeNull();
  });
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
