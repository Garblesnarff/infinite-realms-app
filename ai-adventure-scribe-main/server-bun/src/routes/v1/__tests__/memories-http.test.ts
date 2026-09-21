import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const insertCalls: unknown[][] = [];

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_CLIENT_ID: 'client_test',
  },
}));

mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    if (request.headers.get('authorization') === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

mock.module('../../../services/memory-service.js', () => ({
  MemoryService: {
    insert: async (records: unknown[]) => {
      insertCalls.push(records);
      return records.map((record, index) => ({
        id: `memory-${index + 1}`,
        campaignId: null,
        sessionId: 'session-1',
        type: (record as { type?: string }).type ?? null,
        memoryType: null,
        subcategory: null,
        content: (record as { content: string }).content,
        importance: 3,
        narrativeWeight: 3,
        context: null,
        metadata: null,
        embedding: null,
        emotionalTone: null,
        storyArc: null,
        proseQuality: false,
        chapterMarker: false,
        createdAt: new Date('2026-08-11T00:00:00Z'),
        updatedAt: new Date('2026-08-11T00:00:00Z'),
      }));
    },
  },
}));

const { memoryRoutes } = await import('../memories.js');
const app = new Elysia().use(memoryRoutes);

const memoryRequest = (body: unknown) =>
  new Request('http://localhost/v1/memories/', {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-user-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

describe('POST /v1/memories type boundary', () => {
  it('no bearer and no body currently returns 422 (desired 401)', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/memories/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
    // Desired: 401. TypeBox body schema currently runs before requireAuth (#2120).
    expect(response.status).toBe(422);
  });

  it('returns 422 with a reason for compound extractor types', async () => {
    insertCalls.length = 0;

    const response = await app.handle(
      memoryRequest({
        session_id: 'session-1',
        type: 'event|npc|combat',
        content: 'The guard joined the battle.',
      }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error?: string; reason?: string };
    expect(body.error).toBe('Invalid memory type');
    expect(body.reason).toContain('event|npc|combat');
    expect(insertCalls).toEqual([]);
  });

  it('still accepts an allowed type and passes it to the service', async () => {
    insertCalls.length = 0;

    const response = await app.handle(
      memoryRequest({
        session_id: 'session-1',
        type: 'event',
        content: 'The guard joined the battle.',
      }),
    );

    expect(response.status).toBe(200);
    expect((insertCalls[0][0] as { type: string }).type).toBe('event');
  });
});
