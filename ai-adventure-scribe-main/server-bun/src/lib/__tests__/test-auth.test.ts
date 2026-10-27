import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import jwt from 'jsonwebtoken';

const SECRET = 'test-auth-secret';
const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

let workosCalls: string[] = [];

mock.module('../db.js', () => ({ sql: async () => [{ plan: 'pro' }] }));
mock.module('../logger.js', () => ({ logger }));
mock.module('../user-plan-cache.js', () => ({
  UserPlanCache: { get: () => undefined, set: () => {}, clear: () => {} },
}));
mock.module('../../services/workos.js', () => ({
  verifyWorkOSToken: async (token: string) => {
    workosCalls.push(token);
    return null;
  },
}));

const {
  TEST_AUTH_USER_ID,
  isTestAuthEnabled,
  mintTestTokens,
  verifyTestAccessToken,
  verifyTestRefreshToken,
} = await import('../test-auth.js');
const { authenticateRequest } = await import('../auth.js');

const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  ENABLE_TEST_AUTH: process.env.ENABLE_TEST_AUTH,
  TEST_AUTH_SECRET: process.env.TEST_AUTH_SECRET,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function enabled() {
  process.env.NODE_ENV = 'development';
  process.env.ENABLE_TEST_AUTH = 'true';
  process.env.TEST_AUTH_SECRET = SECRET;
}

function bearerRequest(token: string) {
  return new Request('http://localhost/protected', {
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  workosCalls = [];
});

afterEach(() => {
  restoreEnv();
});

describe('isTestAuthEnabled', () => {
  it('is true off-production when enabled and the secret is set', () => {
    enabled();
    expect(isTestAuthEnabled()).toBe(true);
  });

  it('is false in production regardless of configuration', () => {
    enabled();
    process.env.NODE_ENV = 'production';
    expect(isTestAuthEnabled()).toBe(false);
  });

  it('is false for every non-true ENABLE_TEST_AUTH value', () => {
    enabled();
    for (const value of ['false', '0', '', '1', 'TRUE', 'yes']) {
      process.env.ENABLE_TEST_AUTH = value;
      expect(isTestAuthEnabled()).toBe(false);
    }
    delete process.env.ENABLE_TEST_AUTH;
    expect(isTestAuthEnabled()).toBe(false);
  });

  it('is false when the secret is missing', () => {
    enabled();
    delete process.env.TEST_AUTH_SECRET;
    expect(isTestAuthEnabled()).toBe(false);
  });

  it('reads the environment at call time', () => {
    delete process.env.ENABLE_TEST_AUTH;
    delete process.env.TEST_AUTH_SECRET;
    process.env.NODE_ENV = 'development';
    expect(isTestAuthEnabled()).toBe(false);
    enabled();
    expect(isTestAuthEnabled()).toBe(true);
  });
});

describe('mintTestTokens and verification', () => {
  it('verifies a minted access token off-production', () => {
    enabled();
    const { accessToken } = mintTestTokens({ id: TEST_AUTH_USER_ID, email: 'bot@example.test' });

    expect(verifyTestAccessToken(accessToken)).toEqual({
      userId: TEST_AUTH_USER_ID,
      email: 'bot@example.test',
    });
  });

  it('verifies a minted refresh token off-production', () => {
    enabled();
    const { refreshToken } = mintTestTokens({ id: TEST_AUTH_USER_ID, email: 'bot@example.test' });

    expect(verifyTestRefreshToken(refreshToken)).toBe(TEST_AUTH_USER_ID);
  });

  it('rejects an access token used as a refresh token', () => {
    enabled();
    const { accessToken } = mintTestTokens({ id: TEST_AUTH_USER_ID, email: 'bot@example.test' });

    expect(verifyTestRefreshToken(accessToken)).toBeNull();
  });

  it('rejects a refresh token used as an access token', () => {
    enabled();
    const { refreshToken } = mintTestTokens({ id: TEST_AUTH_USER_ID, email: 'bot@example.test' });

    expect(verifyTestAccessToken(refreshToken)).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    enabled();
    const token = jwt.sign(
      { sub: TEST_AUTH_USER_ID, email: 'bot@example.test', type: 'access' },
      'other-secret',
      {
        algorithm: 'HS256',
      },
    );

    expect(verifyTestAccessToken(token)).toBeNull();
  });

  it('rejects an access token for another subject', () => {
    enabled();
    const { accessToken } = mintTestTokens({ id: 'user_someone_else', email: 'bot@example.test' });

    expect(verifyTestAccessToken(accessToken)).toBeNull();
  });

  it('rejects both token kinds in production', () => {
    enabled();
    const { accessToken, refreshToken } = mintTestTokens({
      id: TEST_AUTH_USER_ID,
      email: 'bot@example.test',
    });
    process.env.NODE_ENV = 'production';

    expect(verifyTestAccessToken(accessToken)).toBeNull();
    expect(verifyTestRefreshToken(refreshToken)).toBeNull();
  });

  it('rejects a malformed token without throwing', () => {
    enabled();
    expect(verifyTestAccessToken('not.a.jwt')).toBeNull();
    expect(verifyTestRefreshToken('not.a.jwt')).toBeNull();
  });
});

describe('authenticateRequest with test tokens', () => {
  it('accepts a test access token off-production without calling WorkOS', async () => {
    enabled();
    const { accessToken } = mintTestTokens({ id: TEST_AUTH_USER_ID, email: 'bot@example.test' });

    const result = await authenticateRequest(bearerRequest(accessToken));

    expect(result).toEqual({
      user: { userId: TEST_AUTH_USER_ID, email: 'bot@example.test', plan: 'pro' },
      error: null,
    });
    expect(workosCalls).toHaveLength(0);
  });

  it('refuses a test access token in production and reaches WorkOS', async () => {
    enabled();
    const { accessToken } = mintTestTokens({ id: TEST_AUTH_USER_ID, email: 'bot@example.test' });
    process.env.NODE_ENV = 'production';

    const result = await authenticateRequest(bearerRequest(accessToken));

    expect(result.user).toBeNull();
    expect(workosCalls).toEqual([accessToken]);
  });

  it("refuses a test access token when ENABLE_TEST_AUTH is 'false'", async () => {
    enabled();
    const { accessToken } = mintTestTokens({ id: TEST_AUTH_USER_ID, email: 'bot@example.test' });
    process.env.ENABLE_TEST_AUTH = 'false';

    const result = await authenticateRequest(bearerRequest(accessToken));

    expect(result.user).toBeNull();
    expect(workosCalls).toEqual([accessToken]);
  });

  it('refuses an access token signed with another secret', async () => {
    enabled();
    const token = jwt.sign(
      { sub: TEST_AUTH_USER_ID, email: 'bot@example.test', type: 'access' },
      'other-secret',
      {
        algorithm: 'HS256',
      },
    );

    const result = await authenticateRequest(bearerRequest(token));

    expect(result.user).toBeNull();
    expect(workosCalls).toEqual([token]);
  });

  it('refuses a refresh token used as an access token', async () => {
    enabled();
    const { refreshToken } = mintTestTokens({ id: TEST_AUTH_USER_ID, email: 'bot@example.test' });

    const result = await authenticateRequest(bearerRequest(refreshToken));

    expect(result.user).toBeNull();
    expect(workosCalls).toEqual([refreshToken]);
  });

  it('refuses an access token for another subject', async () => {
    enabled();
    const { accessToken } = mintTestTokens({ id: 'user_someone_else', email: 'bot@example.test' });

    const result = await authenticateRequest(bearerRequest(accessToken));

    expect(result.user).toBeNull();
    expect(workosCalls).toEqual([accessToken]);
  });
});
