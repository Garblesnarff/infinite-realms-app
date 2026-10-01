/**
 * #2386: the opening memories, posted exactly as the client's memory hook posts them (one record
 * per request, in an array), through the real request pipeline and the real `POST /v1/memories`
 * schema.
 *
 * The service's once-per-session check reads `metadata.is_initial_memory` and the record's
 * (type, subcategory); a route that dropped or renamed any of them would turn that check off
 * without failing anything else. The shared fixture is what `createInitialMemories` hands out
 * (asserted by the client test). Only auth and the database service are stubbed; the
 * one-set-per-session outcome itself is `session-init-once.real-db.test.ts`.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { initialMemoryWireBodies } from '../../../../../shared/test-fixtures/continuation-session-init-save';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer valid-user-token'
      ? { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test.invalid/unused',
    PORT: '8892',
    CORS_ORIGIN: 'http://localhost:8891',
    WORKOS_API_KEY: 'test-workos-key',
    WORKOS_CLIENT_ID: 'test-workos-client',
    NODE_ENV: 'test',
  },
}));

mock.module('../../../lib/logger.js', () => ({
  logger: noopLogger,
  combatLogger: noopLogger,
  spellLogger: noopLogger,
  progressionLogger: noopLogger,
  errorLogSerializers: {},
  default: noopLogger,
}));

const inserted: Array<Array<Record<string, unknown>>> = [];
mock.module('../../../services/memory-service.js', () => ({
  MemoryService: {
    insert: async (records: Array<Record<string, unknown>>) => {
      inserted.push(records);
      return records.map((record, index) => ({
        id: `memory-${index + 1}`,
        campaignId: null,
        memoryType: null,
        embedding: null,
        ...record,
      }));
    },
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { memoryRoutes } = await import('../memories.js');

// The production composition: the request pipeline (with its error handler) and then the routes.
const app = createRequestPipelineApp().use(memoryRoutes);

const post = (body: unknown): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/memories', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-user-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );

describe('POST /v1/memories — opening memories (#2386)', () => {
  beforeEach(() => {
    inserted.length = 0;
  });

  it('accepts each opening memory the client saves and passes its mark, type and subcategory to the service', async () => {
    const bodies = initialMemoryWireBodies('session-1');

    for (const body of bodies) {
      const response = await post([body]);
      expect(response.status).toBe(200);
    }

    expect(inserted).toHaveLength(bodies.length);
    bodies.forEach((body, index) => {
      const [record] = inserted[index] ?? [];
      expect(record).toEqual(
        expect.objectContaining({
          sessionId: 'session-1',
          type: body.type,
          subcategory: body.subcategory,
          content: body.content,
          importance: body.importance,
        }),
      );
      expect((record?.metadata as { is_initial_memory?: unknown }).is_initial_memory).toBe(true);
    });
  });
});
