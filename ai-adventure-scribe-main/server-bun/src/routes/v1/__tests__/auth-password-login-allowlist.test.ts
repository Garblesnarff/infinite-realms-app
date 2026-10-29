import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/db';
process.env.PORT = process.env.PORT || '8888';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
process.env.WORKOS_API_KEY = process.env.WORKOS_API_KEY || 'sk_test_mock';
process.env.WORKOS_CLIENT_ID = process.env.WORKOS_CLIENT_ID || 'client_mock';

mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../../../../../db/client', () => ({
  db: {},
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { createPasswordLoginRoutes } = await import('../auth.js');
// The real error class, so the pending-token tests below throw exactly what
// @workos-inc/node 7.82.0 throws (see OauthException in the installed SDK:
// handleHttpError passes the full response body as rawData).
const { OauthException } = await import('@workos-inc/node');

describe('POST /v1/auth/password-login allowlist', () => {
  it('returns 200 with access and refresh tokens for an allowlisted email', async () => {
    const calls: unknown[] = [];
    const fakeWorkOS = {
      userManagement: {
        authenticateWithPassword: async (params: unknown) => {
          calls.push(params);
          return { accessToken: 'access_abc', refreshToken: 'refresh_xyz' };
        },
      },
    };

    const routes = createPasswordLoginRoutes({
      workos: fakeWorkOS as never,
      clientId: 'test-client-id',
      getTesterEmails: () => ' tester@example.com , smoke@example.test ',
      rateLimit: { windowMs: 60_000, max: 5, key: 'test-allowlisted' },
    });

    const app = createRequestPipelineApp().use(
      new Elysia({ prefix: '/v1/auth' }).use(routes),
    );

    const res = await app.handle(
      new Request('http://localhost/v1/auth/password-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'TESTER@example.com', password: 'secretpassword' }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ accessToken: 'access_abc', refreshToken: 'refresh_xyz' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      email: 'tester@example.com',
      password: 'secretpassword',
      clientId: 'test-client-id',
    });
  });

  it('returns 404 and makes no WorkOS call for an email not in TESTER_LOGIN_EMAILS', async () => {
    const calls: unknown[] = [];
    const fakeWorkOS = {
      userManagement: {
        authenticateWithPassword: async (params: unknown) => {
          calls.push(params);
          return { accessToken: 'access_abc', refreshToken: 'refresh_xyz' };
        },
      },
    };

    const routes = createPasswordLoginRoutes({
      workos: fakeWorkOS as never,
      clientId: 'test-client-id',
      getTesterEmails: () => 'tester@example.com',
      rateLimit: { windowMs: 60_000, max: 5, key: 'test-non-allowlisted' },
    });

    const app = createRequestPipelineApp().use(
      new Elysia({ prefix: '/v1/auth' }).use(routes),
    );

    const res = await app.handle(
      new Request('http://localhost/v1/auth/password-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'attacker@example.com', password: 'secretpassword' }),
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Not found' });
    expect(calls).toHaveLength(0);
  });

  it('returns 404 when TESTER_LOGIN_EMAILS is unset or empty', async () => {
    const calls: unknown[] = [];
    const fakeWorkOS = {
      userManagement: {
        authenticateWithPassword: async (params: unknown) => {
          calls.push(params);
          return { accessToken: 'access_abc', refreshToken: 'refresh_xyz' };
        },
      },
    };

    const routes = createPasswordLoginRoutes({
      workos: fakeWorkOS as never,
      clientId: 'test-client-id',
      getTesterEmails: () => undefined,
      rateLimit: { windowMs: 60_000, max: 5, key: 'test-unset-emails' },
    });

    const app = createRequestPipelineApp().use(
      new Elysia({ prefix: '/v1/auth' }).use(routes),
    );

    const res = await app.handle(
      new Request('http://localhost/v1/auth/password-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'tester@example.com', password: 'secretpassword' }),
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Not found' });
    expect(calls).toHaveLength(0);
  });

  it('returns 429 on the 6th request within a minute', async () => {
    const fakeWorkOS = {
      userManagement: {
        authenticateWithPassword: async () => ({
          accessToken: 'access_abc',
          refreshToken: 'refresh_xyz',
        }),
      },
    };

    const routes = createPasswordLoginRoutes({
      workos: fakeWorkOS as never,
      clientId: 'test-client-id',
      getTesterEmails: () => 'tester@example.com',
      rateLimit: { windowMs: 60_000, max: 5, key: 'test-rate-limit-6th' },
    });

    const app = createRequestPipelineApp().use(
      new Elysia({ prefix: '/v1/auth' }).use(routes),
    );

    const makeRequest = () =>
      app.handle(
        new Request('http://localhost/v1/auth/password-login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'tester@example.com', password: 'secretpassword' }),
        }),
      );

    for (let i = 0; i < 5; i++) {
      const res = await makeRequest();
      expect(res.status).toBe(200);
    }

    const res6 = await makeRequest();
    expect(res6.status).toBe(429);
  });

  it('returns 401 with specific reason code when WorkOS error carries pending_authentication_token', async () => {
    const emailVerificationError = {
      code: 'email_verification_required',
      pending_authentication_token: 'pat_email_123',
    };

    const mfaError = {
      code: 'mfa_required',
      pending_authentication_token: 'pat_mfa_456',
      message: 'MFA challenge required',
    };

    let currentError: unknown = emailVerificationError;

    const fakeWorkOS = {
      userManagement: {
        authenticateWithPassword: async () => {
          throw currentError;
        },
      },
    };

    const routes = createPasswordLoginRoutes({
      workos: fakeWorkOS as never,
      clientId: 'test-client-id',
      getTesterEmails: () => 'tester@example.com',
      rateLimit: { windowMs: 60_000, max: 10, key: 'test-pending-auth-token' },
    });

    const app = createRequestPipelineApp().use(
      new Elysia({ prefix: '/v1/auth' }).use(routes),
    );

    // Email verification case
    const res1 = await app.handle(
      new Request('http://localhost/v1/auth/password-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'tester@example.com', password: 'secretpassword' }),
      }),
    );

    expect(res1.status).toBe(401);
    const body1 = await res1.json();
    expect(body1).toEqual({ error: 'email_verification_required' });

    // MFA case
    currentError = mfaError;
    const res2 = await app.handle(
      new Request('http://localhost/v1/auth/password-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'tester@example.com', password: 'secretpassword' }),
      }),
    );

    expect(res2.status).toBe(401);
    const body2 = await res2.json();
    expect(body2).toEqual({ error: 'mfa_required' });
  });

  it('returns 401 with specific reason code when the real WorkOS OauthException carries the pending token in rawData', async () => {
    // Shape pinned here, not WorkOS's literal error strings: the SDK throws
    // OauthException(status, requestID, error, errorDescription, rawData)
    // with rawData set to the full response body, so the pending token is
    // only reachable through rawData. A hand-shaped top-level `code` + token
    // would never exercise the rawData branch in auth.ts.
    const emailVerificationError = new OauthException(
      400,
      'req_test_email_verification',
      'invalid_grant',
      'The user must verify their email address before signing in.',
      {
        error: 'invalid_grant',
        error_description: 'The user must verify their email address before signing in.',
        pending_authentication_token: 'pat_email_real_shape',
      },
    );

    const mfaError = new OauthException(
      400,
      'req_test_mfa',
      'mfa_required',
      'MFA challenge required.',
      {
        error: 'mfa_required',
        error_description: 'MFA challenge required.',
        pending_authentication_token: 'pat_mfa_real_shape',
      },
    );

    let currentError: unknown = emailVerificationError;
    const calls: unknown[] = [];

    const fakeWorkOS = {
      userManagement: {
        authenticateWithPassword: async (params: unknown) => {
          calls.push(params);
          throw currentError;
        },
      },
    };

    const routes = createPasswordLoginRoutes({
      workos: fakeWorkOS as never,
      clientId: 'test-client-id',
      getTesterEmails: () => 'tester@example.com',
      rateLimit: { windowMs: 60_000, max: 10, key: 'test-sdk-pending-token' },
    });

    const app = createRequestPipelineApp().use(
      new Elysia({ prefix: '/v1/auth' }).use(routes),
    );

    // Email verification case
    const res1 = await app.handle(
      new Request('http://localhost/v1/auth/password-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'tester@example.com', password: 'secretpassword' }),
      }),
    );

    expect(res1.status).toBe(401);
    const body1 = await res1.json();
    expect(body1).toEqual({ error: 'email_verification_required' });

    // MFA case
    currentError = mfaError;
    const res2 = await app.handle(
      new Request('http://localhost/v1/auth/password-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'tester@example.com', password: 'secretpassword' }),
      }),
    );

    expect(res2.status).toBe(401);
    const body2 = await res2.json();
    expect(body2).toEqual({ error: 'mfa_required' });
    expect(calls).toHaveLength(2);
  });

  it('returns 401 Invalid email or password when the WorkOS error carries no pending token', async () => {
    const calls: unknown[] = [];

    const fakeWorkOS = {
      userManagement: {
        authenticateWithPassword: async (params: unknown) => {
          calls.push(params);
          throw new OauthException(
            400,
            'req_test_wrong_password',
            'invalid_grant',
            'The email or password is incorrect.',
            {
              error: 'invalid_grant',
              error_description: 'The email or password is incorrect.',
            },
          );
        },
      },
    };

    const routes = createPasswordLoginRoutes({
      workos: fakeWorkOS as never,
      clientId: 'test-client-id',
      getTesterEmails: () => 'tester@example.com',
      rateLimit: { windowMs: 60_000, max: 5, key: 'test-wrong-password' },
    });

    const app = createRequestPipelineApp().use(
      new Elysia({ prefix: '/v1/auth' }).use(routes),
    );

    const res = await app.handle(
      new Request('http://localhost/v1/auth/password-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'tester@example.com', password: 'wrongpassword' }),
      }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Invalid email or password' });
    expect(calls).toHaveLength(1);
  });
});
