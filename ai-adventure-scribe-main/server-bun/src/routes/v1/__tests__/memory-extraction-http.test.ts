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
const quotaConsumeCalls: unknown[] = [];

// #846: the accepted job is persisted before the 202, so the store mock keeps
// the rows with the same guarded claim semantics as the real store.
const jobRows = new Map<string, Record<string, unknown>>();
const STALE_MS = 15 * 60 * 1000;
mock.module('../../../services/memory-extraction-job-store.js', () => ({
  STALE_RUNNING_JOB_MS: STALE_MS,
  persistMemoryExtractionJob: async (r: Record<string, any>) => {
    const stored: Record<string, any> = {
      ...r,
      attempts: 0,
      charged: false,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
    };
    jobRows.set(stored.id as string, stored);
    return { ...stored };
  },
  claimMemoryExtractionJob: async (id: string, expected: 'pending' | 'running') => {
    const r = jobRows.get(id);
    if (!r || r.status !== expected) return null;
    if (expected === 'running' && Date.now() - +(r.updatedAt as Date) < STALE_MS) return null;
    const claimed = {
      ...r,
      status: 'running',
      attempts: (r.attempts as number) + 1,
      updatedAt: new Date(),
    };
    jobRows.set(id, claimed);
    return { ...claimed };
  },
  getMemoryExtractionJob: async (id: string) => {
    const r = jobRows.get(id);
    return r ? { ...r } : null;
  },
  listRunnableMemoryExtractionJobs: async (limit: number) =>
    [...jobRows.values()]
      .filter(
        (r) =>
          r.status === 'pending' ||
          (r.status === 'running' && Date.now() - +(r.updatedAt as Date) >= STALE_MS),
      )
      .slice(0, limit)
      .map((r) => ({ ...r })),
  completeMemoryExtractionJob: async (id: string, charged: boolean) => {
    const r = jobRows.get(id);
    if (!r || r.status !== 'running') return false;
    jobRows.set(id, { ...r, status: 'completed', charged, updatedAt: new Date() });
    return true;
  },
  markMemoryExtractionJobCharged: async (id: string) => {
    const r = jobRows.get(id);
    if (!r || r.status !== 'completed' || r.charged) return false;
    jobRows.set(id, { ...r, charged: true, updatedAt: new Date() });
    return true;
  },
  releaseMemoryExtractionJob: async (id: string, error: string) => {
    const r = jobRows.get(id);
    if (!r || r.status !== 'running') return false;
    jobRows.set(id, { ...r, status: 'pending', error, updatedAt: new Date() });
    return true;
  },
  failMemoryExtractionJob: async (id: string, error: string) => {
    const r = jobRows.get(id);
    if (!r || r.status !== 'running') return false;
    jobRows.set(id, { ...r, status: 'failed', error, updatedAt: new Date() });
    return true;
  },
  failExhaustedMemoryExtractionJobs: async () => 0,
  countActiveMemoryExtractionJobs: async (userId: string) =>
    [...jobRows.values()].filter(
      (r) => r.userId === userId && (r.status === 'pending' || r.status === 'running'),
    ).length,
}));

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
// #846: the route checks quota availability without consuming at accept; the
// unit is consumed when the job completes.
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    getQuotaStatus: async () => ({
      plan: 'free',
      limits: { daily: { llm: 15, llm_system: 500, image: 1, voice: 0 } },
      usage: quotaAllowed ? 0 : 500,
      remaining: quotaAllowed ? 10 : 0,
      resetAt: '2026-09-23T00:00:00.000Z',
    }),
    checkQuotaAndConsume: async (opts: unknown) => {
      quotaConsumeCalls.push(opts);
      return {
        allowed: quotaAllowed,
        remaining: quotaAllowed ? 10 : 0,
        resetAt: '2026-09-23T00:00:00.000Z',
        usageId: 1,
      };
    },
    assertUsageStoreAvailable: async () => {},
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
    // #846: the executor skips re-running when the job's rows already exist.
    existsByExtractionJobId: async () => false,
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
    quotaConsumeCalls.length = 0;
    jobRows.clear();
  });

  it('returns 202 with a job id before the model answers, then persists with no client waiting', async () => {
    const response = await app.handle(
      jobRequest({
        session_id: SESSION,
        kind: 'memories',
        // #353: the model's quote must be verbatim from the prompt.
        prompt: 'extract this: Find the lost bell',
      }),
    );

    // The model call is still pending: the response did not wait for it.
    expect(response.status).toBe(202);
    const body = (await response.json()) as { jobId: string; status: string };
    expect(body.status).toBe('accepted');
    expect(body.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(extractCalls).toBe(1);
    expect(insertCalls).toHaveLength(0);

    // #846: the job was persisted before the 202, and accepting it consumed no
    // quota — the unit is charged when the job completes.
    expect(jobRows.get(body.jobId)).toMatchObject({ sessionId: SESSION, status: 'running' });
    expect(quotaConsumeCalls).toHaveLength(0);

    // The response has been fully consumed; nobody is listening any more. Finish the model call.
    resolveExtract!({
      text: '{"memories":[{"type":"quest","content":"Find the lost bell","importance":4,"quote":"Find the lost bell"}]}',
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

    // #846: the unit is charged exactly once, at completion — not at accept.
    expect(quotaConsumeCalls).toHaveLength(1);
    expect(quotaConsumeCalls[0]).toMatchObject({
      userId: 'user-1',
      type: 'llm_system',
      units: 1,
    });
    expect(jobRows.get(body.jobId)).toMatchObject({ status: 'completed', charged: true });
  });

  it('a model failure after the 202 leaves no rows and is never charged (#846)', async () => {
    const response = await app.handle(
      jobRequest({ session_id: SESSION, kind: 'memories', prompt: 'extract this' }),
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as { jobId: string };

    resolveExtract!({ error: 'All extraction models failed', text: '' });
    await flush();
    await flush();

    expect(insertCalls).toHaveLength(0);
    expect(quotaConsumeCalls).toHaveLength(0);
    // Released back to pending for its next attempt, not dropped.
    expect(jobRows.get(body.jobId)).toMatchObject({ status: 'pending', charged: false });
    jobRows.clear();
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

  it('reserves quota for accepted-but-unfinished jobs at accept (#846)', async () => {
    // remaining is 10 in this suite's quota mock; seed 10 active jobs for the
    // user so the burst cannot promise more extractions than the quota will
    // pay for at completion.
    for (let i = 0; i < 10; i += 1) {
      jobRows.set(`seeded-active-${i}`, {
        id: `seeded-active-${i}`,
        userId: 'user-1',
        plan: 'free',
        sessionId: SESSION,
        campaignId: CAMPAIGN,
        characterId: null,
        kind: 'memories',
        prompt: 'seeded',
        payloadHash: 'b'.repeat(64),
        maxTokens: 1000,
        turn: null,
        status: 'pending',
        attempts: 0,
        charged: false,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
      });
    }

    const response = await app.handle(
      jobRequest({ session_id: SESSION, kind: 'memories', prompt: 'extract this' }),
    );

    expect(response.status).toBe(402);
    expect(extractCalls).toBe(0);
    expect(jobRows.size).toBe(10);
    jobRows.clear();
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
