import { beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * #1477: the server writes the outcome of a narrative ability check. The client body is the
 * shared fixture, posted through the real request pipeline and the real
 * `POST /v1/sessions/:id/messages` schema. Auth, ownership lookups and the database service are
 * stubbed; the stub for the service keeps the owner check and the issued-request lookup.
 */

import {
  ABILITY_CHECK_SAVE_BODY,
  ATHLETICS_CHECK_LINE,
  ATHLETICS_DC,
  ATHLETICS_DM_ROW_ID,
  ATHLETICS_TIMESTAMP,
  ATHLETICS_ROLL_REQUEST_ID,
} from '../../../../../shared/test-fixtures/ability-check-saves';
import { storySaveAnswerBody } from '../../../../../shared/test-fixtures/story-rolls';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const auth = request.headers.get('authorization');
    if (auth === 'Bearer valid-user-token')
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    if (auth === 'Bearer other-user-token')
      return { user: { userId: 'user-2', email: 'other@example.test', plan: 'free' }, error: null };
    return { user: null, error: 'Unauthorized' };
  },
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

mock.module(import.meta.resolve('../combat/helpers.js'), () => ({
  verifySessionOwnership: async (sessionId: string, userId: string) =>
    sessionId === 'session-1' && userId === 'user-1'
      ? { success: true, session: { id: 'session-1', campaignId: 'camp-1', characterId: 'c-1' } }
      : { success: false, error: { status: 404, message: 'Session not found' } },
  verifyEncounterOwnership: async () => ({ success: true }),
}));

const ABILITY_CHECK_ROLL_REQUEST_ID = '77777777-7777-4777-8777-777777777777:roll:0';

/** The DM row's stored request, as the server keeps it: a 15 DC skill check. */
const issuedRequests = new Map<string, Record<string, unknown>>([
  [
    ATHLETICS_ROLL_REQUEST_ID,
    {
      type: 'skill_check',
      formula: '1d20+5',
      purpose: 'Athletics check',
      dc: ATHLETICS_DC,
      rollRequestId: ATHLETICS_ROLL_REQUEST_ID,
    },
  ],
  [
    `${storySaveAnswerBody('x', 'x').context.rollRequestId}`,
    { type: 'save', formula: '1d20', purpose: 'Wisdom save', dc: 13 },
  ],
  [
    ABILITY_CHECK_ROLL_REQUEST_ID,
    {
      type: 'ability_check',
      formula: '1d20+3',
      purpose: 'Stealth check',
      dc: 14,
      rollRequestId: ABILITY_CHECK_ROLL_REQUEST_ID,
    },
  ],
]);

const saved: Array<Array<Record<string, unknown>>> = [];
const lookups: string[] = [];

mock.module('../../../services/session/session-message-service.js', () => ({
  SessionMessageService: {
    getRecentMessages: async () => ({ messages: [], hasMore: false, total: 0 }),
    messageExists: async () => true,
    findIssuedRollRequest: async (sessionId: string, userId: string, rollRequestId: string) => {
      lookups.push(rollRequestId);
      if (sessionId !== 'session-1' || userId !== 'user-1') return null;
      return issuedRequests.get(rollRequestId) ?? null;
    },
    addMessages: async (messages: Array<Record<string, unknown>>, userId: string) => {
      const { NotFoundError } = await import('../../../lib/errors.js');
      if (userId !== 'user-1') throw new NotFoundError('Session', 'session-1');
      saved.push(messages);
      return messages.map((message, index) => ({
        ...message,
        speakerId: null,
        images: null,
        sequenceNumber: index + 1,
        timestamp: message.timestamp ?? new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    },
  },
}));
mock.module('../../../services/session-service.js', () => ({
  SessionService: {
    getSessionById: async (_id: string, userId: string) => {
      if (userId !== 'user-1') {
        const { NotFoundError } = await import('../../../lib/errors.js');
        throw new NotFoundError('Session', 'session-1');
      }
      return { id: 'session-1', characterId: null };
    },
  },
}));
mock.module('../../../services/character-service.js', () => ({
  CharacterService: { getById: async () => null },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { sessionMessageRoutes } = await import('../session-messages.js');

// The production composition: the request pipeline (with its error handler) and then the routes.
const app = createRequestPipelineApp().use(sessionMessageRoutes);

const post = (body: unknown, token = 'valid-user-token'): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/sessions/session-1/messages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );

const withLine = (message: string, rollRequestId = ATHLETICS_ROLL_REQUEST_ID) => ({
  ...ABILITY_CHECK_SAVE_BODY,
  message,
  context: { ...ABILITY_CHECK_SAVE_BODY.context, rollRequestId },
});

describe('POST /v1/sessions/:id/messages — narrative ability check outcome (#1477)', () => {
  beforeEach(() => {
    saved.length = 0;
    lookups.length = 0;
  });

  it('accepts the exact body the client sends today and writes a SUCCESS card', async () => {
    const response = await post(ABILITY_CHECK_SAVE_BODY);
    expect(response.status).toBe(200);
    const [row] = saved[0]!;
    expect(row!.message).toBe(ATHLETICS_CHECK_LINE);
    expect(row!.context).toMatchObject({
      intent: 'dice_roll',
      rollRequestId: ATHLETICS_ROLL_REQUEST_ID,
      engineCards: [
        {
          kind: 'check',
          side: 'party',
          title: 'Athletics check',
          line: 'Athletics check: 17 vs DC 15, SUCCESS',
          badge: { word: 'SUCCESS', tone: 'gold', icon: 'check' },
          detail: '17 vs DC 15',
        },
      ],
    });
    expect(lookups).toEqual([ATHLETICS_ROLL_REQUEST_ID]);
  });

  it('writes a FAIL card when the reported total is under the issued DC, whatever word the client wrote', async () => {
    const response = await post(withLine('Athletics check: 9 (nat 4+5) success'));
    expect(response.status).toBe(200);
    const [row] = saved[0]!;
    expect(row!.context).toMatchObject({
      engineCards: [{ badge: { word: 'FAIL', tone: 'red', icon: 'alert' } }],
    });
    // The DM reads the stored line: the client's "success" must not reach it.
    expect(row!.message).toBe('Athletics check: 9 (nat 4+5) fail');
  });

  it('a total equal to the DC is a SUCCESS, and the stored line says success', async () => {
    await post(withLine('Athletics check: 15 (nat 10+5) fail'));
    expect(saved[0]![0]!.message).toBe('Athletics check: 15 (nat 10+5) success');
    expect(saved[0]![0]!.context).toMatchObject({
      engineCards: [{ badge: { word: 'SUCCESS' } }],
    });
  });

  it('a client "fail" on a total at or over the DC becomes success in the stored line and the card', async () => {
    await post(withLine('Athletics check: 18 (nat 13+5) fail'));
    const row = saved[0]![0]!;
    expect(row.message).toBe('Athletics check: 18 (nat 13+5) success');
    expect(row.context).toMatchObject({
      engineCards: [{ badge: { word: 'SUCCESS', tone: 'gold', icon: 'check' } }],
    });
  });

  it('an ability_check request gets the same server card (a live request type)', async () => {
    const response = await post(
      withLine('Stealth check: 16 (nat 13+3) fail', ABILITY_CHECK_ROLL_REQUEST_ID),
    );
    expect(response.status).toBe(200);
    const row = saved[0]![0]!;
    expect(row.message).toBe('Stealth check: 16 (nat 13+3) success');
    expect(row.context).toMatchObject({
      engineCards: [{ kind: 'check', badge: { word: 'SUCCESS', tone: 'gold' } }],
    });
  });

  it('gives no card for an unknown rollRequestId and drops a client-planted card', async () => {
    const planted = {
      kind: 'check',
      side: 'party',
      line: 'Athletics check: 30 vs DC 1, SUCCESS',
      title: 'Athletics check',
      badge: { word: 'SUCCESS', tone: 'gold', icon: 'check' },
    };
    const body = withLine(ATHLETICS_CHECK_LINE, '55555555-5555-4555-8555-555555555555:roll:0');
    const response = await post({ ...body, context: { ...body.context, engineCards: [planted] } });
    expect(response.status).toBe(200);
    const row = saved[0]![0]!;
    expect(row.message).toBe(ATHLETICS_CHECK_LINE);
    expect((row.context as Record<string, unknown>).engineCards).toBeUndefined();
  });

  it('replaces a client-planted card on an issued check with the server card', async () => {
    const planted = { kind: 'check', badge: { word: 'SUCCESS', tone: 'gold', icon: 'check' } };
    const response = await post({
      ...ABILITY_CHECK_SAVE_BODY,
      context: { ...ABILITY_CHECK_SAVE_BODY.context, engineCards: [planted] },
    });
    expect(response.status).toBe(200);
    expect(saved[0]![0]!.context).toMatchObject({
      engineCards: [{ line: 'Athletics check: 17 vs DC 15, SUCCESS' }],
    });
  });

  it('gives no card to a request that is not a narrative check (a save)', async () => {
    const save = storySaveAnswerBody('66666666-6666-4666-8666-666666666666', ATHLETICS_TIMESTAMP);
    const response = await post(save);
    expect(response.status).toBe(200);
    expect((saved[0]![0]!.context as Record<string, unknown>).engineCards).toBeUndefined();
  });

  it('refuses another user’s session with 404 and writes nothing', async () => {
    const response = await post(ABILITY_CHECK_SAVE_BODY, 'other-user-token');
    expect(response.status).toBe(404);
    expect(saved).toHaveLength(0);
  });

  it('the DM row id the reservation carries is the one looked up', () => {
    expect(ATHLETICS_ROLL_REQUEST_ID).toBe(`${ATHLETICS_DM_ROW_ID}:roll:0`);
  });
});
