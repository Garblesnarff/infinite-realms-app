import { beforeEach, describe, expect, it, mock } from 'bun:test';

const logged: Array<Record<string, unknown>> = [];
const inserted: Array<Record<string, unknown>> = [];
let insertShouldFail = false;

mock.module('../../../lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: (entry: unknown) => {
      if (entry && typeof entry === 'object') logged.push(entry as Record<string, unknown>);
    },
    warn: () => {},
    error: () => {},
  },
}));
mock.module('../../../../../db/client', () => ({
  db: {
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        if (insertShouldFail) throw new Error('relation "feedback" does not exist');
        inserted.push(row);
      },
    }),
  },
}));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer good'
      ? { user: { userId: 'user_abc', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { feedbackRoutes } = await import('../feedback.js');
const { feedbackWireBody: validBody } =
  await import('../../../../../shared/test-fixtures/feedback-wire-body');

// validBody is the exact body the client modal posts (shared fixture, asserted by its test).
// Each test builds its own app but the rate-limit store is module-global, so every test uses its
// own client IP header only where it needs to; the default IP bucket is "unknown" (proxy headers
// are not trusted), shared by all tests. Limits are 20/h per IP, so keep the shared count low.
function post(body: unknown, headers: Record<string, string> = {}) {
  const app = createRequestPipelineApp().use(feedbackRoutes);
  return app.handle(
    new Request('http://localhost/v1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  logged.length = 0;
  inserted.length = 0;
  insertShouldFail = false;
});

describe('POST /v1/feedback validation', () => {
  it('stores a signed-out submission with a null user and logs ANALYTICS_FEEDBACK', async () => {
    const res = await post(validBody);
    expect(res.status).toBe(201);
    expect(inserted).toEqual([
      {
        message: validBody.message,
        page: validBody.page,
        build: validBody.build,
        campaignSlug: validBody.campaignSlug,
        sessionId: validBody.sessionId,
        userId: null,
      },
    ]);
    const entry = logged.find((e) => e.msg === 'ANALYTICS_FEEDBACK');
    expect(entry).toMatchObject({ page: validBody.page, userId: null, message: validBody.message });
  });

  it('attaches the user id when a valid token is sent', async () => {
    const res = await post(
      { message: 'Nice', page: '/app/account' },
      { authorization: 'Bearer good' },
    );
    expect(res.status).toBe(201);
    expect(inserted[0]).toMatchObject({ userId: 'user_abc', build: null, campaignSlug: null });
    expect(logged.find((e) => e.msg === 'ANALYTICS_FEEDBACK')).toMatchObject({
      userId: 'user_abc',
    });
  });

  it('ignores an invalid token instead of rejecting', async () => {
    const res = await post(
      { message: 'Nice', page: '/app/account' },
      { authorization: 'Bearer bad' },
    );
    expect(res.status).toBe(201);
    expect(inserted[0]).toMatchObject({ userId: null });
  });

  it('rejects a missing message', async () => {
    const res = await post({ page: '/app/account' });
    expect(res.status).toBe(422);
    expect(inserted).toHaveLength(0);
  });

  it('rejects an empty or whitespace-only message', async () => {
    expect((await post({ message: '', page: '/app/account' })).status).toBe(422);
    expect((await post({ message: '   ', page: '/app/account' })).status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it('rejects a message over 4000 characters', async () => {
    const res = await post({ message: 'x'.repeat(4_001), page: '/app/account' });
    expect(res.status).toBe(422);
  });

  it('rejects a missing page', async () => {
    const res = await post({ message: 'hello' });
    expect(res.status).toBe(422);
  });

  it('returns 503 when the table is missing, after logging the feedback', async () => {
    insertShouldFail = true;
    const res = await post(validBody);
    expect(res.status).toBe(503);
    expect(logged.some((e) => e.msg === 'ANALYTICS_FEEDBACK')).toBe(true);
  });
});
