/**
 * #1907 PR1: pending combat intent must be an owned, server-timed declaration.
 *
 * This suite uses PostgreSQL because a mocked Drizzle object cannot prove that the JSONB column,
 * encounter state, participant roster, and session owner all agree. It refuses every database
 * target except the dedicated local/CI Postgres and skips honestly when no target is configured.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';

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
const FIXTURE_OWNER_PREFIX = 'pending-intent-user-';

export function assertSafeCombatPendingIntentDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[combat-pending-intent] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
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
      `[combat-pending-intent] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

if (hasRealDb) assertSafeCombatPendingIntentDatabase(realDbUrl);

type RealDb = ReturnType<typeof realDb>;

/** Remove only this suite's owner-scoped rows left by a crashed prior run. */
export async function preCleanPendingIntentFixtures(database: RealDb): Promise<void> {
  await database.delete(characters).where(like(characters.userId, `${FIXTURE_OWNER_PREFIX}%`));
  await database.delete(campaigns).where(like(campaigns.userId, `${FIXTURE_OWNER_PREFIX}%`));
}

const { setPendingCombatIntent } = await importWithRealDb(
  () => import('../combat/combat-pending-intent-service.js'),
);
const { CombatEncounterService } = await importWithRealDb(
  () => import('../combat/combat-encounter-service.js'),
);

if (!hasRealDb) {
  console.warn(
    '[combat-pending-intent] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run this suite.',
  );
}

test('refuses a non-dedicated database target before fixture setup', () => {
  expect(() =>
    assertSafeCombatPendingIntentDatabase('postgres://prod.example.test:5432/postgres'),
  ).toThrow('refusing real-DB fixtures');
});

test('accepts the dedicated CI database target', () => {
  expect(() =>
    assertSafeCombatPendingIntentDatabase('postgres://postgres:postgres@127.0.0.1:55432/postgres'),
  ).not.toThrow();
});

describeWithDb('server-owned pending combat intent', () => {
  const database = hasRealDb ? realDb() : (null as never as RealDb);
  const userId = testId(FIXTURE_OWNER_PREFIX);
  const createdEncounterIds: string[] = [];

  let campaignId: string;
  let characterId: string;
  let sessionId: string;

  beforeAll(async () => {
    await preCleanPendingIntentFixtures(database);
    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('pending-intent-campaign') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await database
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: 'Pending Intent Player',
        class: 'Rogue',
        level: 1,
      })
      .returning({ id: characters.id });

    await database.insert(characterStats).values({
      characterId,
      dexterity: 14,
      armorClass: 14,
      maxHitPoints: 20,
      currentHitPoints: 20,
      speed: 30,
    });

    [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({
        campaignId,
        characterId,
        sessionNumber: 1,
        status: 'active',
        summary: 'Pending intent test session.',
        currentSceneDescription: 'A test encounter waits in a stone hall.',
      })
      .returning({ id: gameSessions.id });
  });

  const createEncounter = async (currentTurnOrder = 0) => {
    const [{ id: encounterId }] = await database
      .insert(combatEncounters)
      .values({
        sessionId,
        status: 'active',
        currentRound: 2,
        currentTurnOrder,
        version: 1,
      })
      .returning({ id: combatEncounters.id });
    createdEncounterIds.push(encounterId);

    const participants = await database
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId: null,
          npcId: null,
          name: 'Geometrist',
          participantType: 'monster',
          initiative: 15,
          initiativeModifier: 1,
          turnOrder: 0,
          maxHp: 10,
          armorClass: 12,
        },
        {
          encounterId,
          characterId,
          npcId: null,
          name: 'Pending Intent Player',
          participantType: 'player',
          initiative: 18,
          initiativeModifier: 2,
          turnOrder: 1,
          maxHp: 20,
          armorClass: 14,
        },
      ])
      .returning({ id: combatParticipants.id, characterId: combatParticipants.characterId });

    await database.insert(combatParticipantStatus).values(
      participants.map((participant) => ({
        participantId: participant.id,
        currentHp: participant.characterId ? 20 : 10,
        maxHp: participant.characterId ? 20 : 10,
      })),
    );

    const player = participants.find((participant) => participant.characterId === characterId);
    const monster = participants.find((participant) => participant.characterId === null);
    if (!player || !monster)
      throw new Error('pending intent fixture participants were not created');
    return { encounterId, playerId: player.id, monsterId: monster.id };
  };

  afterAll(async () => {
    if (!hasRealDb) return;
    try {
      if (createdEncounterIds.length) {
        await database
          .delete(combatEncounters)
          .where(inArray(combatEncounters.id, createdEncounterIds));
      }
      if (sessionId) await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      if (characterId) await database.delete(characters).where(eq(characters.id, characterId));
      if (campaignId) await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    } finally {
      await closeRealDb();
    }
  });

  test('stores the declared action with the server-owned round and turn coordinates', async () => {
    const { encounterId, playerId, monsterId } = await createEncounter();
    const pending = await setPendingCombatIntent(
      encounterId,
      {
        actorId: playerId,
        actionType: 'attack',
        targetIds: [monsterId],
        sourceText: 'I strike the Geometrist.',
      },
      userId,
    );

    expect(pending).toEqual({
      actorId: playerId,
      actionType: 'attack',
      targetIds: [monsterId],
      sourceText: 'I strike the Geometrist.',
      queuedOnTurn: 0,
      queuedOnRound: 2,
    });

    const [row] = await database
      .select({ pendingIntent: combatEncounters.pendingIntent })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    expect(row?.pendingIntent).toEqual(pending);

    const state = await CombatEncounterService.getCombatState(encounterId, userId);
    expect(state.encounter.pendingIntent).toEqual(pending);
  });

  test('rejects a declaration for the current-turn player', async () => {
    const { encounterId, playerId, monsterId } = await createEncounter(1);
    await expect(
      setPendingCombatIntent(
        encounterId,
        {
          actorId: playerId,
          actionType: 'attack',
          targetIds: [monsterId],
          sourceText: 'I strike now.',
        },
        userId,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  test('rejects an NPC or monster declaration even when the caller owns the encounter', async () => {
    const { encounterId, monsterId, playerId } = await createEncounter();
    await expect(
      setPendingCombatIntent(
        encounterId,
        {
          actorId: monsterId,
          actionType: 'attack',
          targetIds: [playerId],
          sourceText: 'The Geometrist attacks.',
        },
        userId,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});
