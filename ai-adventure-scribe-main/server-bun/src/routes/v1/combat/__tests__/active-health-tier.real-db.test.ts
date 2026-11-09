/** The active-combat route publishes the engine's health tier from persisted status rows. */
import { networkInterfaces } from 'node:os';

import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  campaigns,
  characters,
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
  gameSessions,
} from '../../../../../../db/schema/index';
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
process.env.PORT ??= '8894';
if (hasRealDb) process.env.CORS_ORIGIN ??= `http://${new URL(realDbUrl).host}`;
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';
const userId = testId('table-tier-user');
mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId, plan: 'free' },
    error: null,
  }),
}));
await importWithRealDb(() => import('../../../../lib/drizzle.js'));
const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../../http-pipeline.js'),
);
const { intentRoutes } = await importWithRealDb(() => import('../intents.js'));
const { Elysia } = await import('elysia');

describeWithDb('active combat health tier (#1421)', () => {
  const database = hasRealDb ? realDb() : (null as never);
  const campaignId = crypto.randomUUID();
  const characterId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const encounterId = crypto.randomUUID();
  const foeId = crypto.randomUUID();
  const missingId = crypto.randomUUID();
  const app = hasRealDb
    ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
    : null;
  beforeAll(async () => {
    await database.insert(campaigns).values({ id: campaignId, userId, name: 'Tier fixture' });
    await database
      .insert(characters)
      .values({ id: characterId, userId, campaignId, name: 'Hero', class: 'Fighter', level: 1 });
    await database
      .insert(gameSessions)
      .values({ id: sessionId, campaignId, characterId, sessionNumber: 1, status: 'active' });
    await database
      .insert(combatEncounters)
      .values({ id: encounterId, sessionId, status: 'active' });
    await database.insert(combatParticipants).values([
      { id: foeId, encounterId, name: 'Foe', participantType: 'monster', turnOrder: 0, maxHp: 30 },
      {
        id: missingId,
        encounterId,
        name: 'Unknown',
        participantType: 'monster',
        turnOrder: 1,
        maxHp: 30,
      },
    ]);
    await database
      .insert(combatParticipantStatus)
      .values({ participantId: foeId, currentHp: 30, maxHp: 30, isConscious: true });
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
  test('tracks current persisted HP and leaves missing status unknown', async () => {
    for (const [hp, expected] of [
      [30, 'unharmed'],
      [20, 'wounded'],
      [14, 'bloodied'],
      [5, 'near death'],
    ] as const) {
      await database
        .update(combatParticipantStatus)
        .set({ currentHp: hp })
        .where(eq(combatParticipantStatus.participantId, foeId));
      const response = await app!.handle(
        new Request(`http://${new URL(realDbUrl).host}/v1/combat/sessions/${sessionId}/active`, {
          headers: { authorization: 'Bearer test' },
        }),
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        combat: { participants: Array<{ id: string; healthCondition?: string }> };
      };
      expect(
        payload.combat.participants.find((participant) => participant.id === foeId)
          ?.healthCondition,
      ).toBe(expected);
      expect(
        payload.combat.participants.find((participant) => participant.id === missingId)
          ?.healthCondition,
      ).toBeUndefined();
    }
  });
});
