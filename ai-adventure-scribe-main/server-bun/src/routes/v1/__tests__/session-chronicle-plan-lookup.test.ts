/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Session-complete auto-chronicle gate must fail closed on a plan lookup DB error (#1344).
 *
 * The plan on the request is lenient (authenticateRequest fails open to 'free'),
 * so the complete handler re-resolves strictly before the Pro gate. A DB blip used
 * to silently skip a Pro chronicle (no row, no error). Now the failure is recorded
 * as a failed chronicle row — retryable via the chronicle endpoint — while the
 * session itself still completes, because the session IS completed by then and a
 * 503 would lie about it.
 *
 * What is real: the sessions route, resolveUserPlanStrict, UserPlanCache. What is
 * injected: the DB client (lib/db.js), whose plan query can throw, plus auth, the
 * session service, the drizzle client, the chronicle generator and the trackers.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_API_KEY: 'test-api-key',
    WORKOS_CLIENT_ID: 'test-client-id',
  },
}));

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    if (request.headers.get('authorization') === 'Bearer <redacted>') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'pro' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

// 'throw' makes the users-plan query reject; 'pro' returns a pro row.
const plan = { mode: 'pro' as 'throw' | 'pro' };
const planQueryError = (): Error => new Error('plan lookup db unavailable (test injection)');
mock.module('../../../lib/db.js', () => ({
  sql: async (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM users')) {
      if (plan.mode === 'throw') throw planQueryError();
      return [{ plan: 'pro' }];
    }
    return [];
  },
}));

mock.module('../../../../../db/client', () => ({
  db: {
    transaction: async (cb: any) =>
      cb({
        insert: () => ({
          values: () => ({
            returning: () => [{ id: 'chronicle-1' }],
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => [],
          }),
        }),
      }),
  },
}));

const generateProCalls: unknown[] = [];
const failureCalls: unknown[] = [];
mock.module('../../../services/chronicle-generator.js', () => ({
  chronicleGenerator: {
    generateProChronicle: async (...args: unknown[]) => {
      generateProCalls.push(args);
      return {
        chapterTitle: 'Chapter 1',
        previouslyOn: 'Previously...',
        chronicleText: 'A story...',
        illustrationPrompt: 'Draw a dragon...',
      };
    },
    generateIllustration: async () => 'https://example.com/art.png',
    generateShareToken: () => 'share-token-123',
  },
  persistChronicleFailure: async (...args: unknown[]) => {
    failureCalls.push(args);
  },
}));

mock.module('../../../services/session-service.js', () => {
  const mockSession = {
    id: 'valid-session-id',
    campaignId: 'camp-1',
    characterId: 'char-1',
    sessionNumber: 1,
    startTime: new Date(),
    endTime: null,
    status: 'active',
    currentSceneDescription: 'A dark cave',
    summary: 'The adventure begins',
    sessionNotes: '[]',
    turnCount: 0,
    sessionState: {},
    starterCampaignId: null,
    campaignVersion: 1,
    ruleset: 'dnd5e',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    SessionService: {
      getSessionById: async (sessionId: string, userId: string) => {
        if (sessionId === 'valid-session-id' && userId === 'user-1') {
          return mockSession;
        }
        const err = new Error('Session not found');
        err.name = 'NotFoundError';
        throw err;
      },
      completeSession: async (sessionId: string, userId: string, summary?: string) => {
        if (sessionId === 'valid-session-id' && userId === 'user-1') {
          return { ...mockSession, status: 'completed', summary: summary || null };
        }
        const err = new Error('Session not found');
        err.name = 'NotFoundError';
        throw err;
      },
    },
  };
});

const helpersPath = import.meta.resolve('../combat/helpers.js');
mock.module(helpersPath, () => ({
  verifySessionOwnership: async () => ({ success: true }),
  verifyEncounterOwnership: async () => ({ success: true }),
}));

mock.module('../../../services/dm/story-tracker.js', () => ({
  loadStoredStoryTrackers: async () => [],
}));

const { sessionsRoutes } = await import('../sessions.js');
const { UserPlanCache } = await import('../../../lib/user-plan-cache.js');

const app = new Elysia().use(sessionsRoutes);

const postComplete = (): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/sessions/valid-session-id/complete', {
      method: 'POST',
      headers: {
        authorization: 'Bearer <redacted>',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ summary: 'Finished' }),
    }),
  );

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  plan.mode = 'pro';
  generateProCalls.length = 0;
  failureCalls.length = 0;
  UserPlanCache.clear();
});

describe('session-complete auto-chronicle gate plan lookup (#1344)', () => {
  it('records a failed chronicle row instead of silently skipping, and still completes the session', async () => {
    plan.mode = 'throw';
    const response = await postComplete();
    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.status).toBe('completed');
    expect(failureCalls).toHaveLength(1);
    expect((failureCalls[0] as unknown[])[1]).toBe('chronicle-1');
    expect(generateProCalls).toHaveLength(0);
  });

  it('runs the Pro chronicle when the lookup succeeds', async () => {
    plan.mode = 'pro';
    const response = await postComplete();
    expect(response.status).toBe(200);
    for (let i = 0; i < 200 && generateProCalls.length === 0; i++) {
      await sleep(10);
    }
    expect(generateProCalls.length).toBeGreaterThan(0);
    expect(failureCalls).toHaveLength(0);
  });
});
