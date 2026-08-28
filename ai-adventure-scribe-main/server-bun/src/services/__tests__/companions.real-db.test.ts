/* eslint-disable max-lines -- one fixture covers the join transaction and scene projection. */
/**
 * Issue #1930 post-deploy regressions: companion joins must execute against PostgreSQL, and a
 * scene without a companion identity must not turn a null-character monster into that identity.
 *
 * This suite deliberately uses the real database. The unit suite's db mock cannot compile or
 * execute the nullable-outer-join lock or the unique-key upsert, which is exactly the seam these
 * regressions crossed. It refuses every target except the dedicated local/CI Postgres because it
 * writes fixtures and performs startup cleanup.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { and, eq, inArray, like } from 'drizzle-orm';

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
  sessionCompanions,
} from '../../../../db/schema/index';

const DEDICATED_REAL_DB_HOST = '127.0.0.1';
const DEDICATED_REAL_DB_PORT = '55432';
const COMPANION_FIXTURE_OWNER_PREFIX = 'companion-smoke-user-';
const COMPANION_FIXTURE_OWNER_PATTERN = `${COMPANION_FIXTURE_OWNER_PREFIX}%`;

/**
 * The suite deletes stale rows before setup. Keep this guard before realDb() and before importing
 * the service so an accidentally supplied production URL cannot receive fixture writes.
 */
export function assertSafeCompanionDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[companions] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
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
      `[companions] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

type RealDb = ReturnType<typeof realDb>;

/** Remove only this suite's owner-scoped rows left by a crashed prior run. */
export async function preCleanCompanionFixtures(database: RealDb): Promise<void> {
  await database.delete(characters).where(like(characters.userId, COMPANION_FIXTURE_OWNER_PATTERN));
  await database.delete(campaigns).where(like(campaigns.userId, COMPANION_FIXTURE_OWNER_PATTERN));
}

if (hasRealDb) assertSafeCompanionDatabase(realDbUrl);

const { CompanionService } = await importWithRealDb(
  () => import('../session/companion-service.js'),
);

if (!hasRealDb) {
  console.warn(
    '[companions] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run these.',
  );
}

test('refuses a non-dedicated database target before fixture cleanup', () => {
  expect(() => assertSafeCompanionDatabase('postgres://prod.example.test:5432/postgres')).toThrow(
    'refusing real-DB fixtures',
  );
});

test('accepts the dedicated CI database target', () => {
  expect(() =>
    assertSafeCompanionDatabase('postgres://postgres:postgres@127.0.0.1:55432/postgres'),
  ).not.toThrow();
});

describeWithDb('WebMCP companion membership and scene projections', () => {
  const database = hasRealDb ? realDb() : (null as never as RealDb);
  const userId = `${COMPANION_FIXTURE_OWNER_PREFIX}${process.pid}`;

  let campaignId: string;
  let mainCharacterId: string;
  let companionOneId: string;
  let companionTwoId: string;
  let companionThreeId: string;
  let sessionId: string;
  let encounterId: string;
  let characterIds: string[] = [];

  beforeAll(async () => {
    await preCleanCompanionFixtures(database);

    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('companion-campaign') })
      .returning({ id: campaigns.id });

    const createdCharacters = await database
      .insert(characters)
      .values([
        {
          userId,
          campaignId,
          name: 'Companion Smoke Main',
          class: 'Wizard',
          level: 4,
        },
        {
          userId,
          campaignId,
          name: 'Companion Smoke One',
          class: 'Cleric',
          level: 4,
        },
        {
          userId,
          campaignId,
          name: 'Companion Smoke Two',
          class: 'Fighter',
          level: 4,
        },
        {
          userId,
          campaignId,
          name: 'Companion Smoke Three',
          class: 'Rogue',
          level: 4,
        },
      ])
      .returning({ id: characters.id });

    [mainCharacterId, companionOneId, companionTwoId, companionThreeId] = createdCharacters.map(
      (character) => character.id,
    );
    characterIds = createdCharacters.map((character) => character.id);

    await database.insert(characterStats).values(
      characterIds.map((characterId) => ({
        characterId,
        armorClass: 14,
        maxHitPoints: 24,
        currentHitPoints: 24,
      })),
    );

    [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({
        campaignId,
        characterId: mainCharacterId,
        sessionNumber: 1,
        status: 'active',
        currentSceneDescription: 'The smoke-test gate is shut.',
        summary: 'The smoke-test party waits at the gate.',
      })
      .returning({ id: gameSessions.id });
  });

  beforeEach(async () => {
    await database.delete(sessionCompanions).where(eq(sessionCompanions.sessionId, sessionId));
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    try {
      if (sessionId) {
        await database.delete(sessionCompanions).where(eq(sessionCompanions.sessionId, sessionId));
      }
      if (encounterId) {
        await database.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
      }
      if (sessionId) {
        await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      }
      if (characterIds.length > 0) {
        await database.delete(characters).where(inArray(characters.id, characterIds));
      }
      if (campaignId) {
        await database.delete(campaigns).where(eq(campaigns.id, campaignId));
      }
    } finally {
      await closeRealDb();
    }
  });

  test('joins, enforces the cap, and reactivates the same unique row', async () => {
    const first = await CompanionService.join(sessionId, companionOneId, userId);
    const second = await CompanionService.join(sessionId, companionTwoId, userId);

    await expect(CompanionService.join(sessionId, companionThreeId, userId)).rejects.toMatchObject({
      statusCode: 422,
    });

    await CompanionService.leave(sessionId, first.id);
    const rejoined = await CompanionService.join(sessionId, companionOneId, userId);

    expect(rejoined.id).toBe(first.id);
    expect(rejoined.characterId).toBe(companionOneId);
    expect(rejoined.status).toBe('active');

    const rows = await database
      .select({ id: sessionCompanions.id, characterId: sessionCompanions.characterId })
      .from(sessionCompanions)
      .where(
        and(eq(sessionCompanions.sessionId, sessionId), eq(sessionCompanions.status, 'active')),
      );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.characterId).sort()).toEqual(
      [companionOneId, companionTwoId].sort(),
    );
    expect(second.status).toBe('active');
  });

  test('returns no companion participant id without identity and the exact id with identity', async () => {
    const companion = await CompanionService.join(sessionId, companionOneId, userId);

    [{ id: encounterId }] = await database
      .insert(combatEncounters)
      .values({
        sessionId,
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        version: 1,
      })
      .returning({ id: combatEncounters.id });

    const [companionParticipant, monsterParticipant] = await database
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId: companionOneId,
          npcId: null,
          name: 'Companion Smoke One',
          participantType: 'player',
          initiative: 12,
          turnOrder: 0,
          maxHp: 24,
        },
        {
          encounterId,
          characterId: null,
          npcId: null,
          name: 'Null Character Monster',
          participantType: 'monster',
          initiative: 10,
          turnOrder: 1,
          maxHp: 30,
        },
      ])
      .returning({ id: combatParticipants.id, characterId: combatParticipants.characterId });

    await database.insert(combatParticipantStatus).values([
      { participantId: companionParticipant.id, currentHp: 24, maxHp: 24 },
      { participantId: monsterParticipant.id, currentHp: 15, maxHp: 30 },
    ]);

    const anonymousScene = await CompanionService.scene(sessionId, userId);
    expect(anonymousScene.combat?.your_companion_participant_id).toBeNull();
    expect(anonymousScene.combat?.your_companion_participant_id).not.toBe(monsterParticipant.id);

    const companionScene = await CompanionService.scene(sessionId, userId, companion.id);
    expect(companionScene.combat?.your_companion_participant_id).toBe(companionParticipant.id);
  });
});
