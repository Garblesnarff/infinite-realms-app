/**
 * Over-long public chronicle tokens are indistinguishable from unknown
 * tokens: 404 with `{ error: 'Chronicle not found' }`, not a 422 validation
 * payload that hints the token was too long. The database client is stubbed
 * so the suite runs without a live DB; the long-token 404 is returned before
 * any query, and the normal-length 404 resolves an empty row set.
 */
import { describe, expect, it, mock } from 'bun:test';

// chronicles.ts imports the auth middleware, which constructs the WorkOS
// client at module load. The public handler never calls it. These are placeholders.
process.env.WORKOS_API_KEY ||= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ||= 'test-workos-client';

mock.module('../../../../../db/client', () => {
  const chain: Record<string, (...args: unknown[]) => unknown> = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve([]),
  };
  return {
    db: {
      select: () => chain,
      insert: () => chain,
      update: () => chain,
      delete: () => chain,
      transaction: async () => undefined,
      query: {},
    },
    pgClient: {},
    withNpcActionTransaction: async () => undefined,
  };
});

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { chroniclesV1Routes } = await import('../chronicles.js');
const { PUBLIC_CHRONICLE_PATH } = await import('../../../../../shared/chronicle-share-routes');

const app = createRequestPipelineApp().use(chroniclesV1Routes);

describe('public chronicle token validation', () => {
  it('returns 404 for a token longer than 255 characters', async () => {
    const longToken = 'a'.repeat(256);
    const res = await app.handle(
      new Request(`http://localhost${PUBLIC_CHRONICLE_PATH(longToken)}`),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Chronicle not found' });
  });

  it('returns the same 404 for a normal-length unknown token', async () => {
    const res = await app.handle(
      new Request(`http://localhost${PUBLIC_CHRONICLE_PATH('no-such-token')}`),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Chronicle not found' });
  });
});
