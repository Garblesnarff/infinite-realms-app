import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db';
import { campaigns, dialogueHistory, gameSessions } from '../../../../db/schema';
import { ABILITY_CHECK_SAVE_BODY } from '../../../../shared/test-fixtures/ability-check-saves';

/**
 * #1477: `findIssuedRollRequest` and the check-outcome save path against real PostgreSQL. The
 * jsonb `@>` lookup and the owner join are not mocked here. Auth is stubbed (as in
 * roll-answer-dedupe.real-db.test.ts); the database is not.
 */

process.env.PORT ??= '8894';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';
// db/client reads DATABASE_URL at import time; point it at the test database.
if (hasRealDb) process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const authModule = await importWithRealDb(() => import('../../lib/auth'));
const { createRequestPipelineApp } = await importWithRealDb(() => import('../../http-pipeline'));
const { sessionMessageRoutes } = await importWithRealDb(
  () => import('../../routes/v1/session-messages'),
);
const { SessionMessageService } = await importWithRealDb(
  () => import('../session/session-message-service'),
);
const { sql } = await importWithRealDb(() => import('../../lib/db'));

describeWithDb('narrative check outcome against real PostgreSQL (#1477)', () => {
  const database = hasRealDb ? realDb() : (null as unknown as ReturnType<typeof realDb>);
  const userId = testId('check-user');
  const otherUserId = testId('check-other');
  let campaignId: string;
  let sessionId: string;
  let otherCampaignId: string;
  let otherSessionId: string;
  // The DM row that issued the check, and a second DM row that stores an explicit id.
  let dmId: string;
  let issuedId: string;
  const explicitId = testId('explicit-roll');

  beforeAll(async () => {
    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('check-outcome') })
      .returning();
    [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({ campaignId, sessionNumber: 1, status: 'active' })
      .returning();
    [{ id: otherCampaignId }] = await database
      .insert(campaigns)
      .values({ userId: otherUserId, name: testId('check-outcome-other') })
      .returning();
    [{ id: otherSessionId }] = await database
      .insert(gameSessions)
      .values({ campaignId: otherCampaignId, sessionNumber: 1, status: 'active' })
      .returning();

    dmId = crypto.randomUUID();
    issuedId = `${dmId}:roll:0`;
    await database.insert(dialogueHistory).values({
      id: dmId,
      sessionId,
      speakerType: 'dm',
      message: 'Climb the wall.',
      context: {
        rollRequests: [
          {
            type: 'skill_check',
            formula: '1d20+5',
            purpose: 'Athletics check',
            dc: 15,
            rollRequestId: issuedId,
          },
        ],
      },
    });
    // A DM row that stores its request under an explicit id (not the `:roll:` form).
    await database.insert(dialogueHistory).values({
      id: crypto.randomUUID(),
      sessionId,
      speakerType: 'dm',
      message: 'Hold on.',
      context: {
        rollRequests: [
          { type: 'check', formula: '1d20', purpose: 'Stealth', dc: 12, rollRequestId: explicitId },
        ],
      },
    });
  });

  afterAll(async () => {
    await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await database.delete(gameSessions).where(eq(gameSessions.id, otherSessionId));
    await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    await database.delete(campaigns).where(eq(campaigns.id, otherCampaignId));
    await sql.end({ timeout: 5 });
    await closeRealDb();
  });

  describe('findIssuedRollRequest', () => {
    test('finds the issued request by its reservation id, with its DC', async () => {
      const found = await SessionMessageService.findIssuedRollRequest(sessionId, userId, issuedId);
      expect(found).toMatchObject({ type: 'skill_check', dc: 15 });
    });

    test('finds a request stored under an explicit id through the jsonb containment lookup', async () => {
      const found = await SessionMessageService.findIssuedRollRequest(
        sessionId,
        userId,
        explicitId,
      );
      expect(found).toMatchObject({ type: 'check', dc: 12, rollRequestId: explicitId });
    });

    test('an unknown rollRequestId resolves to nothing', async () => {
      const found = await SessionMessageService.findIssuedRollRequest(
        sessionId,
        userId,
        `${crypto.randomUUID()}:roll:0`,
      );
      expect(found).toBeNull();
    });

    test('another user cannot see the issued request (owner join)', async () => {
      const found = await SessionMessageService.findIssuedRollRequest(
        sessionId,
        otherUserId,
        issuedId,
      );
      expect(found).toBeNull();
    });

    test('a session the user owns but that has no such DM row resolves to nothing', async () => {
      const found = await SessionMessageService.findIssuedRollRequest(
        otherSessionId,
        otherUserId,
        issuedId,
      );
      expect(found).toBeNull();
    });
  });

  describe('save through the real route', () => {
    let auth: { mockRestore: () => void } | undefined;
    const app = () => createRequestPipelineApp().use(sessionMessageRoutes);
    const post = (sid: string, body: unknown) =>
      app().handle(
        new Request(`http://localhost/v1/sessions/${sid}/messages`, {
          method: 'POST',
          headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    const playerRowsFor = async (rollRequestId: string) =>
      (
        await database
          .select()
          .from(dialogueHistory)
          .where(
            and(
              eq(dialogueHistory.sessionId, sessionId),
              eq(dialogueHistory.speakerType, 'player'),
            ),
          )
      ).filter((row) => (row.context as Record<string, unknown>)?.rollRequestId === rollRequestId);

    const answer = (rollRequestId: string, message: string) => ({
      ...ABILITY_CHECK_SAVE_BODY,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      message,
      context: { ...ABILITY_CHECK_SAVE_BODY.context, rollRequestId },
    });

    beforeEach(() => {
      auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
        user: { userId, email: 'check@example.test', plan: 'free' },
        error: null,
      } as never);
    });
    afterEach(() => {
      auth?.mockRestore();
    });

    test('a client line that says success on a total below the DC: the DM reads fail, and the card is FAIL', async () => {
      const body = answer(issuedId, 'Athletics check: 9 (nat 4+5) success');
      const response = await post(sessionId, body);
      expect(response.status).toBe(200);

      const [row] = await playerRowsFor(issuedId);
      expect(row!.message).toBe('Athletics check: 9 (nat 4+5) fail');
      expect((row!.context as Record<string, unknown>).engineCards).toMatchObject([
        { kind: 'check', badge: { word: 'FAIL', tone: 'red' } },
      ]);

      // The DM-facing read: what the next turn is built from.
      const page = await SessionMessageService.getRecentMessages(sessionId, userId, 200, 0);
      const seen = page.messages.find((m) => m.id === row!.id);
      expect(seen?.message).toBe('Athletics check: 9 (nat 4+5) fail');
      expect(seen?.message).not.toMatch(/success/);
    });

    test('a replayed id writes one card, not a second row', async () => {
      const replayId = `${crypto.randomUUID()}:roll:0`;
      // Same DM row and DC, so the issued id must be a real issued id: store one first.
      await database.insert(dialogueHistory).values({
        id: replayId.split(':roll:')[0] as string,
        sessionId,
        speakerType: 'dm',
        message: 'Pull yourself up.',
        context: {
          rollRequests: [
            { type: 'skill_check', formula: '1d20+5', purpose: 'Athletics check', dc: 10 },
          ],
        },
      });
      const first = await post(
        sessionId,
        answer(replayId, 'Athletics check: 14 (nat 9+5) success'),
      );
      const replay = await post(
        sessionId,
        answer(replayId, 'Athletics check: 14 (nat 9+5) success'),
      );
      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);

      const rows = await playerRowsFor(replayId);
      expect(rows).toHaveLength(1);
      expect((rows[0]!.context as Record<string, unknown>).engineCards).toMatchObject([
        { badge: { word: 'SUCCESS', tone: 'gold' } },
      ]);
    });

    test('an unknown rollRequestId: saved with no card, and the client word is kept', async () => {
      const unknown = `${crypto.randomUUID()}:roll:0`;
      const response = await post(
        sessionId,
        answer(unknown, 'Athletics check: 30 (nat 25+5) fail'),
      );
      expect(response.status).toBe(200);
      const [row] = await playerRowsFor(unknown);
      expect(row).toBeDefined();
      expect((row!.context as Record<string, unknown>).engineCards).toBeUndefined();
      expect(row!.message).toBe('Athletics check: 30 (nat 25+5) fail');
    });

    test('another user’s session: 404 and no row written', async () => {
      const foreignId = `${crypto.randomUUID()}:roll:0`;
      auth?.mockRestore();
      auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
        user: { userId: otherUserId, email: 'other@example.test', plan: 'free' },
        error: null,
      } as never);
      const response = await post(
        sessionId,
        answer(foreignId, 'Athletics check: 17 (nat 12+5) success'),
      );
      expect(response.status).toBe(404);
      expect(await playerRowsFor(foreignId)).toHaveLength(0);
    });
  });
});
