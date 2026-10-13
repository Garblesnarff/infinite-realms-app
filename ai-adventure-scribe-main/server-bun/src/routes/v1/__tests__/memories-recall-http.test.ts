import { beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * POST /v1/memories/recall through the real request pipeline.
 * The embedder is stubbed. The route and MemoryService.recall are not.
 */

const SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';

const importanceRow = {
  id: 'high',
  campaignId: null,
  sessionId: SESSION,
  type: 'event',
  memoryType: null,
  subcategory: null,
  content: 'An unrelated feast',
  importance: 10,
  narrativeWeight: 1,
  context: null,
  metadata: null,
  emotionalTone: null,
  storyArc: null,
  proseQuality: false,
  chapterMarker: false,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
};

const debugLines: Array<Record<string, unknown>> = [];
let embedCalls = 0;
let matchCalls = 0;
let embedDelayMs = 0;

const testLogger = {
  debug: (entry: Record<string, unknown>) => {
    debugLines.push(entry);
  },
  info: (entry: Record<string, unknown>) => {
    debugLines.push(entry);
  },
  warn: () => {},
  error: () => {},
  child: () => testLogger,
};

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_CLIENT_ID: 'client_test',
    WORKOS_API_KEY: 'test',
  },
}));
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));
mock.module('../../../lib/alerting.js', () => ({ alert: () => {} }));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    if (request.headers.get('authorization') === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

const { NotFoundError } = await import('../../../lib/errors.js');

mock.module('../../../services/session-service.js', () => ({
  SessionService: {
    getSessionById: async (sessionId: string, userId: string) => {
      if (sessionId === SESSION && userId === 'user-1') return { id: SESSION };
      throw new NotFoundError('Session', sessionId);
    },
  },
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: { recordProviderUsage: async () => {} },
}));
mock.module('../../../services/embedding-service.js', () => ({
  generateEmbedding: async () => [1, 0],
  generateEmbeddingDetailed: async () => {
    embedCalls += 1;
    if (embedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, embedDelayMs));
    }
    return { values: [1, ...new Array(767).fill(0)], inputTokens: 4 };
  },
}));
mock.module('../../../../../db/client', () => ({
  db: {
    query: {
      memories: {
        findMany: async () => [importanceRow],
      },
    },
    transaction: async (fn: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<unknown>) =>
      fn({
        execute: async (query: unknown) => {
          if (JSON.stringify(query).includes('match_memories')) matchCalls += 1;
          return [
            {
              id: 'npc',
              session_id: SESSION,
              content: 'Captain Reeves keeps the line',
              importance: 3,
            },
          ];
        },
      }),
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { memoryRoutes } = await import('../memories.js');
const { resetRecallRateLimit } = await import('../../../services/memory-recall.js');
const app = createRequestPipelineApp().use(memoryRoutes);

const recall = (body: Record<string, unknown>) =>
  app.handle(
    new Request('http://localhost/v1/memories/recall', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-user-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );

describe('POST /v1/memories/recall', () => {
  beforeEach(() => {
    embedCalls = 0;
    matchCalls = 0;
    embedDelayMs = 0;
    debugLines.length = 0;
    resetRecallRateLimit();
  });

  it('returns the merged list for { session_id, query, limit }', async () => {
    const response = await recall({ session_id: SESSION, query: 'Captain Reeves', limit: 8 });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{ id: string; content: string }>;
    expect(body.map((row) => row.id)).toEqual(['npc', 'high']);
    expect(embedCalls).toBe(1);
    expect(matchCalls).toBe(1);
    expect(debugLines.some((line) => line.msg === 'MEMORY_RECALL_MS')).toBe(true);
  });

  it('rejects a query over 8,000 characters with readable issues', async () => {
    const query = 'a'.repeat(8_001);
    const response = await recall({ session_id: SESSION, query, limit: 8 });
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error?: string;
      issues?: Array<{ path: string; message: string }>;
    };
    expect(body.error).toBe('Validation failed');
    expect(body.issues?.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain(query);
    expect(embedCalls).toBe(0);
  });

  it("returns 404 for another user's session", async () => {
    const response = await recall({ session_id: OTHER, query: 'Captain Reeves', limit: 8 });
    expect(response.status).toBe(404);
    expect(embedCalls).toBe(0);
  });

  it('falls back to importance without embedding once the user is past 30 a minute', async () => {
    for (let i = 0; i < 30; i += 1) {
      const response = await recall({ session_id: SESSION, query: 'Captain Reeves', limit: 8 });
      expect(response.status).toBe(200);
    }
    expect(embedCalls).toBe(30);
    const blocked = await recall({ session_id: SESSION, query: 'Captain Reeves', limit: 8 });
    expect(blocked.status).toBe(200);
    const body = (await blocked.json()) as Array<{ id: string }>;
    expect(body.map((row) => row.id)).toEqual(['high']);
    expect(embedCalls).toBe(30);
  });

  it('does not call match_memories when the embed uses up the budget', async () => {
    embedDelayMs = 320;
    const response = await recall({ session_id: SESSION, query: 'Captain Reeves', limit: 8 });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{ id: string }>;
    expect(body.map((row) => row.id)).toEqual(['high']);
    // The response returns at the 300 ms race. Wait for the late embed to finish
    // so this proves the match is skipped, not just not reached yet.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(embedCalls).toBe(1);
    expect(matchCalls).toBe(0);
  });
});
