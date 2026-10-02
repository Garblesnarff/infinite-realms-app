import { describe, expect, it, mock } from 'bun:test';

// Separate file from feedback-http.test.ts: the limiter's store is module-global, so this file
// gets a fresh bucket set. TRUST_PROXY_HEADERS lets each case pick its own client IP.
process.env.TRUST_PROXY_HEADERS = 'true';

mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../../../../../db/client', () => ({
  db: { insert: () => ({ values: async () => {} }) },
}));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const auth = request.headers.get('authorization');
    return auth?.startsWith('Bearer user_')
      ? { user: { userId: auth.slice(7), plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { feedbackRoutes } = await import('../feedback.js');

const app = createRequestPipelineApp().use(feedbackRoutes);
const send = (ip: string, token?: string) =>
  app.handle(
    new Request('http://localhost/v1/feedback', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message: 'hi', page: '/app/account' }),
    }),
  );

describe('POST /v1/feedback rate limit', () => {
  it('limits a user to 10 per hour even when the IP changes', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await send(`10.0.1.${i}`, 'user_a')).status).toBe(201);
    }
    const res = await send('10.0.1.99', 'user_a');
    expect(res.status).toBe(429);
    expect((await res.json()).error.details.scope).toBe('user');
    // A different user from a fresh IP is unaffected.
    expect((await send('10.0.2.1', 'user_b')).status).toBe(201);
  });

  it('limits an IP to 20 per hour for signed-out callers', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await send('10.0.3.1')).status).toBe(201);
    }
    const res = await send('10.0.3.1');
    expect(res.status).toBe(429);
    expect((await res.json()).error.details.scope).toBe('ip');
    expect((await send('10.0.3.2')).status).toBe(201);
  });
});
