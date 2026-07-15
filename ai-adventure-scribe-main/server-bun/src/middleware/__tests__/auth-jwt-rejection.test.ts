/**
 * Authentication must accept only WorkOS RS256 tokens. These cases go through
 * requireAuth -> authenticateRequest -> verifyWorkOSToken using a mocked JWKS
 * fetch, so no WorkOS request or database connection is needed.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

process.env.WORKOS_API_KEY = 'test-workos-key';
process.env.WORKOS_CLIENT_ID = 'test-client';

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const sql = async () => [];

mock.module('../../lib/db.js', () => ({ sql }));
mock.module('../../lib/env.js', () => ({ env: { WORKOS_CLIENT_ID: 'test-client' } }));
mock.module('../../lib/logger.js', () => ({ logger }));

const { privateKey, publicKey } = await generateKeyPair('RS256');
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'test-workos-key';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicJwk] }), {
  headers: { 'content-type': 'application/json' },
});

const { requireAuth } = await import('../auth.js');
const app = new Elysia()
  .use(requireAuth)
  .get('/protected', ({ user }) => ({ userId: user.userId }));

async function signedRs256(expiration: string | number) {
  return new SignJWT({ email: 'user@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-workos-key' })
    .setSubject('user_1')
    .setIssuer('https://api.workos.com/user_management/test-client')
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(privateKey);
}

async function protectedRequest(token?: string) {
  return app.handle(new Request('http://localhost/protected', {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  }));
}

afterAll(() => {
  // Prevent this test's local JWKS fetch shim leaking if Bun reuses the worker.
  globalThis.fetch = originalFetch;
});

describe('requireAuth JWT rejection boundary', () => {
  it('returns 401 when no bearer token is supplied', async () => {
    expect((await protectedRequest()).status).toBe(401);
  });

  it('returns 401 for a malformed bearer token', async () => {
    expect((await protectedRequest('not.a.jwt')).status).toBe(401);
  });

  it('returns 401 for an expired RS256 token even when its signing key is in JWKS', async () => {
    const expired = await signedRs256('60 seconds ago');

    expect((await protectedRequest(expired)).status).toBe(401);
  });

  it('always returns 401 for an HS256 token signed with a local secret (bead -3n9)', async () => {
    const token = await new SignJWT({ email: 'user@example.test' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user_1')
      .setIssuer('https://api.workos.com/user_management/test-client')
      .setIssuedAt()
      .setExpirationTime('5 minutes')
      .sign(new TextEncoder().encode('locally-signed-test-login-secret'));

    expect((await protectedRequest(token)).status).toBe(401);
  });
});
