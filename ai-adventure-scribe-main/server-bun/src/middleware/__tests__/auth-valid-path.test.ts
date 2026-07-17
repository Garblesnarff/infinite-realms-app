import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const sql = async () => [];

mock.module('../../lib/db.js', () => ({ sql }));
mock.module('../../lib/env.js', () => ({ env: { WORKOS_CLIENT_ID: 'test-client' } }));
mock.module('../../lib/logger.js', () => ({ logger }));
mock.module('../../services/workos.js', () => ({
  verifyWorkOSToken: async (token: string) => token === 'verified-by-jwks-layer'
    ? { userId: 'user_1', email: 'user@example.test' }
    : null,
}));

const { requireAuth } = await import('../auth.js');
const app = new Elysia()
  .use(requireAuth)
  .get('/protected', ({ user }) => ({ userId: user.userId, plan: user.plan }));

describe('requireAuth verified-token path', () => {
  it('passes a JWKS-verified identity from lib/auth to the protected route', async () => {
    const response = await app.handle(new Request('http://localhost/protected', {
      headers: { authorization: 'Bearer verified-by-jwks-layer' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: 'user_1', plan: 'free' });
  });
});
