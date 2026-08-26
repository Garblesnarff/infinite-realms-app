/**
 * Issue #1910 regression: player initiative must come from the server-side character stats row.
 *
 * The entry payload has historically carried a client-computed modifier, but the actual session
 * context exposes character_stats as an array of flat database rows. The combat service already
 * joins that row to seat AC and HP; this test proves the same lookup writes DEX 14 as +2 even
 * when the request claims the modifier is zero.
 *
 * Real database, not a mock: the assertion is on the value that reaches
 * combat_participants.initiative_modifier. The suite only permits the dedicated local Postgres
 * at 127.0.0.1:55432 and skips when no database is configured.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
} from '../../../../db/schema/index';

const DEDICATED_REAL_DB_HOST = '127.0.0.1';
const DEDICATED_REAL_DB_PORT = '55432';

export function assertSafeCombatInitiativeDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[combat-initiative-modifier] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
    );
  }

  const isPostgres = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  if (
    !isPostgres ||
    parsed.hostname !== DEDICATED_REAL_DB_HOST ||
    parsed.port !== DEDICATED_REAL_DB_PORT
  ) {
    const target = parsed.hostname ? `${parsed.hostname}:${parsed.port || '(default)'}` : 'unknown';
    throw new Error(
      `[combat-initiative-modifier] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

if (hasRealDb) assertSafeCombatInitiativeDatabase(realDbUrl);

const { CombatEncounterService } = await importWithRealDb(
  () => import('../combat/combat-encounter-service.js'),
);

if (!hasRealDb) {
  console.warn(
    '[combat-initiative-modifier] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run this regression.',
  );
}

test('refuses a non-dedicated database target before fixture setup', () => {
  expect(() =>
    assertSafeCombatInitiativeDatabase('postgres://prod.example.test:5432/postgres'),
  ).toThrow('refusing real-DB fixtures');
});

test('accepts the dedicated CI database target', () => {
  expect(() =>
    assertSafeCombatInitiativeDatabase('postgres://postgres:postgres@127.0.0.1:55432/postgres'),
  ).not.toThrow();
});

describeWithDb('server-derived player initiative', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('initiative-modifier-user');
  const characterName = 'Dexterity Fourteen';

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('initiative-camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: characterName, level: 1, class: 'Rogue' })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      dexterity: 14,
      armorClass: 13,
      maxHitPoints: 24,
      currentHitPoints: 17,
      speed: 30,
    });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    const state = await CombatEncounterService.startCombat(
      sessionId,
      [
        {
          encounterId: '',
          characterId,
          name: characterName,
          // Deliberately stale/malicious client value: the joined character_stats row wins.
          initiativeModifier: 0,
        },
      ],
      false,
      userId,
    );
    encounterId = state.encounter.id;
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    if (encounterId) {
      await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    }
    if (sessionId) {
      await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    }
    if (characterId) {
      await db.delete(characters).where(eq(characters.id, characterId));
    }
    if (campaignId) {
      await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    }
    await closeRealDb();
  });

  test('seats DEX 14 at initiative_modifier 2 and uses server HP', async () => {
    const [participant] = await db
      .select({
        id: combatParticipants.id,
        initiativeModifier: combatParticipants.initiativeModifier,
      })
      .from(combatParticipants)
      .where(
        and(
          eq(combatParticipants.encounterId, encounterId),
          eq(combatParticipants.characterId, characterId),
        ),
      );

    expect(participant).toMatchObject({ initiativeModifier: 2 });
    if (!participant) throw new Error('DEX 14 participant was not seated');

    const [status] = await db
      .select({
        currentHp: combatParticipantStatus.currentHp,
        maxHp: combatParticipantStatus.maxHp,
      })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participant.id));

    expect(status).toEqual({ currentHp: 17, maxHp: 24 });
  });
});
