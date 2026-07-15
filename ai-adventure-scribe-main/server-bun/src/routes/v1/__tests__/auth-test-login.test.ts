import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const TEST_AUTH_SECRET = 'test-auth-secret';

process.env.TEST_AUTH_SECRET = TEST_AUTH_SECRET;
process.env.NODE_ENV = 'test';

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/drizzle.js', () => ({
  db: {
    query: {
      users: {
        findFirst: async () => ({
          id: 'user_TEST_AUTOMATION_BOT_001',
          email: 'test-bot@example.test',
        }),
      },
    },
  },
}));
mock.module('../../../lib/logger.js', () => ({ logger }));
mock.module('../../../services/workos.js', () => ({
  workos: { userManagement: {} },
  authConfig: { clientId: 'test-client', redirectUri: 'http://localhost/auth/callback' },
}));
mock.module('../auth-token-exchange.js', () => ({
  authTokenExchangeRoutes: new Elysia({ name: 'test-auth-token-exchange' }),
}));
mock.module('../../../services/auth-token-exchange.js', () => ({
  authTokenExchangeCodes: { issue: () => 'test-exchange-code' },
}));
mock.module('jsonwebtoken', () => ({
  default: { sign: () => 'test-token' },
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
