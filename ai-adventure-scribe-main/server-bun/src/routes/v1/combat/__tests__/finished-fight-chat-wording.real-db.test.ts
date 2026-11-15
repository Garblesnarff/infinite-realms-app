/**
 * #764 task 3: a finished fight shows no raw reason code in chat, through the live routes.
 *
 * The real `POST /v1/combat/:encounterId/end` and `/abandon` handlers run against the real
 * database and the real `concludeEncounter`. Only auth is injected, the same way the app
 * injects it. The chat text is built by the real chat-row writer (`buildNpcEngineMessage`) and
 * read back the way the chat reads a stored engine line (`playerFacingSentence`).
 */
import { networkInterfaces } from 'node:os';

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  campaigns,
  characters,
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
  gameSessions,
} from '../../../../../../db/schema/index';
import { buildNpcEngineMessage } from '../../../../../../shared/npc-engine-message';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from '../../../../services/__tests__/fixtures/real-db.js';

if (hasRealDb) {
  const url = new URL(realDbUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .some((entry) => entry.internal && entry.address === url.hostname.replace(/^\[|\]$/g, '')) ||
    url.port !== '55432' ||
    !/^test_migrations_\d+_\d+$/.test(url.pathname.slice(1))
  ) {
    throw new Error('Refusing fixture writes outside the dedicated local test database');
  }
  process.env.DATABASE_URL = realDbUrl;
}
process.env.PORT ??= '8895';
if (hasRealDb) process.env.CORS_ORIGIN ??= `http://${new URL(realDbUrl).host}`;
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const userId = testId('finished-fight-chat-user');
const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../../http-pipeline.js'),
);
const { createInitiativeRoutes } = await importWithRealDb(() => import('../initiative.js'));
const { Elysia } = await import('elysia');

describeWithDb('a finished fight shows no raw reason code in chat (#764)', () => {
  const database = hasRealDb ? realDb() : (null as never);
  const campaignId = crypto.randomUUID();
  const characterId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const app = hasRealDb
    ? createRequestPipelineApp().use(
        new Elysia({ prefix: '/v1/combat' }).use(
          createInitiativeRoutes({
            authenticateRequest: async () => ({ user: { userId, plan: 'free' }, error: null }),
          }),
        ),
      )
    : null;

  /** Fresh active encounter per test, because each ending destroys the one it ends. */
  async function freshEncounter(): Promise<{ encounterId: string; hero: string; foe: string }> {
    const encounterId = crypto.randomUUID();
    const hero = crypto.randomUUID();
    const foe = crypto.randomUUID();
    await database
      .insert(combatEncounters)
      .values({ id: encounterId, sessionId, status: 'active' });
    await database.insert(combatParticipants).values([
      { id: hero, encounterId, name: 'Hero', participantType: 'player', turnOrder: 0, maxHp: 10 },
      { id: foe, encounterId, name: 'Goblin', participantType: 'monster', turnOrder: 1, maxHp: 7 },
    ]);
    await database.insert(combatParticipantStatus).values([
      { participantId: hero, currentHp: 10, maxHp: 10, isConscious: true },
      { participantId: foe, currentHp: 7, maxHp: 7, isConscious: true },
    ]);
    return { encounterId, hero, foe };
  }

  beforeAll(async () => {
    await database
      .insert(campaigns)
      .values({ id: campaignId, userId, name: 'Fight wording fixture' });
    await database
      .insert(characters)
      .values({ id: characterId, userId, campaignId, name: 'Hero', class: 'Fighter', level: 1 });
    await database
      .insert(gameSessions)
      .values({ id: sessionId, campaignId, characterId, sessionNumber: 1, status: 'active' });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    try {
      await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      await database.delete(characters).where(eq(characters.id, characterId));
      await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    } finally {
      await closeRealDb();
    }
  });

  for (const [route, expectedWord] of [
    ['end', 'you ended the fight'],
    ['abandon', 'the party broke off and left the fight'],
  ] as const) {
    test(`POST /${route} returns a reason the chat line reads with no raw code`, async () => {
      const { encounterId, hero, foe } = await freshEncounter();
      const response = await app!.handle(
        new Request(`http://${new URL(realDbUrl).host}/v1/combat/${encounterId}/${route}`, {
          method: 'POST',
          headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
          body: '{}',
        }),
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { endedReason?: string | null };
      expect(typeof payload.endedReason).toBe('string');

      // The chat row the route's ending produces, as the chat reads it back.
      const built = buildNpcEngineMessage(
        [
          { id: hero, name: 'Hero', participantType: 'player' },
          { id: foe, name: 'Goblin', participantType: 'monster' },
        ],
        1,
        { type: 'end_turn', actorId: hero },
        { endedReason: payload.endedReason },
      );
      const endLine = built.text.split('\n\n').find((line) => line.includes('Combat ended'));
      expect(endLine).toBeDefined();

      expect(endLine).toContain(expectedWord);
      expect(endLine).not.toMatch(/\(reason/);
      expect(endLine).not.toMatch(/\b[a-z]+(?:_[a-z0-9]+)+\b/);
    });
  }
});
