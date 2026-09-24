import { beforeEach, describe, expect, it, mock } from 'bun:test';

// #2148: POST /v1/memory-extraction/jobs answers 202 before the model call finishes, and the
// server writes the memories when it does — with the HTTP exchange already over.

const SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN = '22222222-2222-4222-8222-222222222222';

let resolveExtract: ((value: Record<string, unknown>) => void) | null = null;
let extractCalls = 0;
let quotaAllowed = true;
const insertCalls: Array<Array<Record<string, unknown>>> = [];

const testLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => testLogger,
};
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));
mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_CLIENT_ID: 'client_test',
  },
}));
mock.module('../../../lib/alerting.js', () => ({ alert: () => {} }));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const auth = request.headers.get('authorization');
    if (auth === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    // A separate user for the rate-limit test, so its window starts empty.
    if (auth === 'Bearer burst-user-token') {
      return {
        user: { userId: 'user-burst', email: 'burst@example.test', plan: 'free' },
        error: null,
      };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

const { NotFoundError } = await import('../../../lib/errors.js');

mock.module('../../../services/session-service.js', () => ({
  SessionService: {
    getSessionById: async (sessionId: string) => {
      if (sessionId !== SESSION) throw new NotFoundError('Session', sessionId);
      return { id: SESSION, campaignId: CAMPAIGN };
    },
  },
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({
      allowed: quotaAllowed,
      remaining: quotaAllowed ? 10 : 0,
      resetAt: '2026-09-23T00:00:00.000Z',
    }),
    recordProviderUsage: async () => {},
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    extract: () => {
      extractCalls += 1;
      return new Promise((resolve) => {
        resolveExtract = resolve;
      });
    },
  },
}));
mock.module('../../../services/memory-service.js', () => ({
  MemoryService: {
    insert: async (rows: Array<Record<string, unknown>>) => {
      insertCalls.push(rows);
      return rows;
    },
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { memoryExtractionRoutes, MEMORY_EXTRACTION_PROMPT_MAX_CHARS } =
  await import('../memory-extraction.js');
const app = createRequestPipelineApp().use(memoryExtractionRoutes);

const jobRequest = (
  body: Record<string, unknown>,
  token = 'valid-user-token',
  extraHeaders: Record<string, string> = {},
) =>
  new Request('http://localhost/v1/memory-extraction/jobs', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('POST /v1/memory-extraction/jobs (#2148)', () => {
  beforeEach(() => {
    resolveExtract = null;
    extractCalls = 0;
    quotaAllowed = true;
    insertCalls.length = 0;
  });

  it('returns 202 with a job id before the model answers, then persists with no client waiting', async () => {
    const response = await app.handle(
      jobRequest({ session_id: SESSION, kind: 'memories', prompt: 'extract this' }),
    );

    // The model call is still pending: the response did not wait for it.
    expect(response.status).toBe(202);
    const body = (await response.json()) as { jobId: string; status: string };
    expect(body.status).toBe('accepted');
    expect(body.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(extractCalls).toBe(1);
    expect(insertCalls).toHaveLength(0);

    // The response has been fully consumed; nobody is listening any more. Finish the model call.
    resolveExtract!({
      text: '{"memories":[{"type":"quest","content":"Find the lost bell","importance":4}]}',
      provider: 'openrouter',
      model: 'extract/model',
    });
    await flush();
    await flush();

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toEqual([
      expect.objectContaining({
        sessionId: SESSION,
        campaignId: CAMPAIGN,
        type: 'quest',
        content: 'Find the lost bell',
        importance: 4,
        metadata: expect.objectContaining({ jobId: body.jobId, source: 'llm_extraction' }),
      }),
    ]);
  });

  it('a model failure after the 202 leaves no rows', async () => {
    const response = await app.handle(
      jobRequest({ session_id: SESSION, kind: 'memories', prompt: 'extract this' }),
    );
    expect(response.status).toBe(202);

    resolveExtract!({ error: 'All extraction models failed', text: '' });
    await flush();
    await flush();

    expect(insertCalls).toHaveLength(0);
  });

  it('refuses a session the caller does not own before starting any job', async () => {
    const response = await app.handle(
      jobRequest({ session_id: OTHER_SESSION, kind: 'memories', prompt: 'extract this' }),
    );

    expect(response.status).toBe(404);
    expect(extractCalls).toBe(0);
  });

  it('refuses when the system quota is spent, before starting any job', async () => {
    quotaAllowed = false;

    const response = await app.handle(
      jobRequest({ session_id: SESSION, kind: 'summary', prompt: 'summarize' }),
    );

    expect(response.status).toBe(402);
    expect(extractCalls).toBe(0);
  });

  it('requires auth', async () => {
    const response = await app.handle(
      jobRequest({ session_id: SESSION, kind: 'memories', prompt: 'x' }, 'bad-token'),
    );

    expect(response.status).toBe(401);
    expect(extractCalls).toBe(0);
  });

  it('refuses a prompt over the cap before starting any job', async () => {
    const response = await app.handle(
      jobRequest({
        session_id: SESSION,
        kind: 'summary',
        prompt: 'x'.repeat(MEMORY_EXTRACTION_PROMPT_MAX_CHARS + 1),
      }),
    );

    expect(response.status).toBe(422);
    expect(extractCalls).toBe(0);
  });

  it('answers 429 past the per-user window limit, with no job started (#2186)', async () => {
    // A fresh IP so earlier tests' requests do not count against the per-IP window; the proxy
    // header is only read when TRUST_PROXY_HEADERS is set.
    const previousTrustProxy = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = 'true';
    const burst = () =>
      app.handle(
        jobRequest(
          { session_id: SESSION, kind: 'memories', prompt: 'extract this' },
          'burst-user-token',
          {
            'x-forwarded-for': '198.51.100.186',
          },
        ),
      );

    try {
      // Free plan: 10 per user per minute on the 'llm' bucket (middleware/rate-limit.ts).
      for (let i = 0; i < 10; i += 1) {
        expect((await burst()).status).toBe(202);
      }
      expect(extractCalls).toBe(10);

      const limited = await burst();

      expect(limited.status).toBe(429);
      expect(limited.headers.get('Retry-After')).toBeTruthy();
      const body = (await limited.json()) as {
        error: { code: string; details: { scope: string } };
      };
      expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(body.error.details.scope).toBe('user');
      // The refused request never reached the handler: no job, no model call.
      expect(extractCalls).toBe(10);
    } finally {
      if (previousTrustProxy === undefined) delete process.env.TRUST_PROXY_HEADERS;
      else process.env.TRUST_PROXY_HEADERS = previousTrustProxy;
    }
  });
});
