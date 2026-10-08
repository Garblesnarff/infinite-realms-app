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
  dialogueHistory,
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

if (hasRealDb) {
  process.env.PORT ??= '8893';
  process.env.CORS_ORIGIN ??= 'http://localhost:8891';
  process.env.WORKOS_API_KEY ??= 'test-workos-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
}

const { CompanionService } = await importWithRealDb(
  () => import('../session/companion-service.js'),
);
const authModule = await importWithRealDb(() => import('../../lib/auth.js'));
const { createRequestPipelineApp } = await importWithRealDb(() => import('../../http-pipeline.js'));
const { companionRoutes } = await importWithRealDb(() => import('../../routes/v1/companions.js'));

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

  describe('companion-route ownership characterization (#2674 step 2a)', () => {
    const otherUserId = `${COMPANION_FIXTURE_OWNER_PREFIX}other-${process.pid}`;
    let privateSessionId: string;
    let companionId: string;
    let otherCampaignId: string;
    let otherSessionId: string;
    let previousFeatureFlag: string | undefined;
    let restoreAuth: (() => void) | undefined;
    let app: { handle: (request: Request) => Response | Promise<Response> };

    const call = async (
      method: string,
      path: string,
      caller: string,
      body?: unknown,
    ): Promise<{ status: number; json: Record<string, unknown> }> => {
      const response = await app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: { authorization: `Bearer ${caller}`, 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
      return { status: response.status, json: (await response.json()) as Record<string, unknown> };
    };
    const snapshot = async (): Promise<{
      companions: (typeof sessionCompanions.$inferSelect)[];
      dialogue: (typeof dialogueHistory.$inferSelect)[];
      sessions: (typeof gameSessions.$inferSelect)[];
      characters: (typeof characters.$inferSelect)[];
      stats: (typeof characterStats.$inferSelect)[];
    }> => ({
      companions: await database
        .select()
        .from(sessionCompanions)
        .where(eq(sessionCompanions.sessionId, privateSessionId))
        .orderBy(sessionCompanions.id),
      dialogue: await database
        .select()
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, privateSessionId))
        .orderBy(dialogueHistory.id),
      sessions: await database
        .select()
        .from(gameSessions)
        .where(eq(gameSessions.id, privateSessionId)),
      characters: await database
        .select()
        .from(characters)
        .where(inArray(characters.id, characterIds))
        .orderBy(characters.id),
      stats: await database
        .select()
        .from(characterStats)
        .where(inArray(characterStats.characterId, characterIds))
        .orderBy(characterStats.characterId),
    });

    beforeEach(async () => {
      previousFeatureFlag = process.env.COMPANIONS_ENABLED;
      process.env.COMPANIONS_ENABLED = 'true';
      // Authentication alone is replaced. Keep the real auth middleware, ownership SQL,
      // route-wide beforeHandle hook and CompanionService; restore the spy after each case
      // because CI runs this file alongside other real-DB suites in one process.
      const authSpy = spyOn(authModule, 'authenticateRequest').mockImplementation(
        async (request) => {
          const caller = request.headers.get('authorization')?.replace(/^Bearer /, '');
          return caller === userId || caller === otherUserId
            ? {
                user: { userId: caller, email: 'companion@example.test', plan: 'free' },
                error: null,
              }
            : { user: null, error: 'Unauthorized' };
        },
      );
      restoreAuth = () => authSpy.mockRestore();
      app = createRequestPipelineApp().use(companionRoutes);
      [{ id: privateSessionId }] = await database
        .insert(gameSessions)
        .values({
          campaignId,
          characterId: mainCharacterId,
          sessionNumber: 2,
          status: 'active',
          currentSceneDescription: "A's private gate",
          summary: "A's private companion session",
        })
        .returning({ id: gameSessions.id });
      const companion = await CompanionService.join(privateSessionId, companionOneId, userId);
      companionId = companion.id;
      await database.insert(dialogueHistory).values({
        sessionId: privateSessionId,
        speakerType: 'dm',
        message: "A's private scene fact",
      });
      [{ id: otherCampaignId }] = await database
        .insert(campaigns)
        .values({
          userId: otherUserId,
          name: 'User B companion campaign',
        })
        .returning({ id: campaigns.id });
      [{ id: otherSessionId }] = await database
        .insert(gameSessions)
        .values({
          campaignId: otherCampaignId,
          sessionNumber: 1,
          status: 'active',
        })
        .returning({ id: gameSessions.id });
      // This 200 proves B is authenticated and the feature is enabled, so B's 404 on A's
      // session cannot be an invalid token, disabled feature or missing route.
      expect(await call('GET', `/v1/sessions/${otherSessionId}/companions`, otherUserId)).toEqual({
        status: 200,
        json: { companions: [] },
      });
      expect((await snapshot()).companions).toEqual([
        expect.objectContaining({ id: companionId, sessionId: privateSessionId, status: 'active' }),
      ]);
    });

    afterEach(async () => {
      try {
        await database
          .delete(gameSessions)
          .where(inArray(gameSessions.id, [privateSessionId, otherSessionId].filter(Boolean)));
        if (otherCampaignId)
          await database.delete(campaigns).where(eq(campaigns.id, otherCampaignId));
      } finally {
        restoreAuth?.();
        if (previousFeatureFlag === undefined) delete process.env.COMPANIONS_ENABLED;
        else process.env.COMPANIONS_ENABLED = previousFeatureFlag;
      }
    });

    test('documents #2674: another user CANNOT DELETE A’s companion today; A CAN mark it left', async () => {
      const before = await snapshot();
      const path = `/v1/sessions/${privateSessionId}/companions/${companionId}`;
      expect(await call('DELETE', path, otherUserId)).toEqual({
        status: 404,
        json: { error: 'Session not found' },
      });
      expect(await snapshot()).toEqual(before);
      const owned = await call('DELETE', path, userId);
      expect(owned.status).toBe(200);
      expect(owned.json.companion).toMatchObject({
        id: companionId,
        session_id: privateSessionId,
        character_id: companionOneId,
        status: 'left',
      });
      expect(await snapshot()).toEqual({
        ...before,
        companions: before.companions.map((row) => ({ ...row, status: 'left' })),
      });
    });

    const siblings = [
      {
        method: 'POST',
        suffix: '/companions',
        label: 'join a companion',
        body: () => ({ character_id: companionTwoId }),
      },
      { method: 'GET', suffix: '/companions', label: 'list A’s companions', body: () => undefined },
      { method: 'GET', suffix: '/scene', label: 'read A’s companion scene', body: () => undefined },
      {
        method: 'POST',
        suffix: '/companions/:companionId/say',
        label: 'speak as A’s companion',
        body: () => ({ text: 'I watch the gate.' }),
      },
      {
        method: 'POST',
        suffix: '/companions/:companionId/roll',
        label: 'roll for A’s companion',
        body: () => ({ kind: 'ability', name: 'wisdom', reason: 'Watch the gate' }),
      },
    ];
    for (const sibling of siblings) {
      test(`documents #2674: another user CANNOT ${sibling.label} today (${sibling.method} ${sibling.suffix})`, async () => {
        const before = await snapshot();
        const path = `/v1/sessions/${privateSessionId}${sibling.suffix.replace(':companionId', companionId)}`;
        expect(await call(sibling.method, path, otherUserId, sibling.body())).toEqual({
          status: 404,
          json: { error: 'Session not found' },
        });
        expect(await snapshot()).toEqual(before);
        const owned = await call(sibling.method, path, userId, sibling.body());
        expect(owned.status).toBe(200);
        const after = await snapshot();
        if (sibling.suffix === '/companions' && sibling.method === 'POST') {
          expect(owned.json.companion).toMatchObject({
            character_id: companionTwoId,
            status: 'active',
          });
          expect(after.companions).toHaveLength(2);
          expect(after.companions).toContainEqual(
            expect.objectContaining({
              characterId: companionTwoId,
              status: 'active',
            }),
          );
        } else if (sibling.method === 'GET') {
          expect(after).toEqual(before);
          if (sibling.suffix === '/companions')
            expect(owned.json.companions).toContainEqual(
              expect.objectContaining({ id: companionId, characterId: companionOneId }),
            );
          else
            expect(owned.json.dialogue_history).toContainEqual(
              expect.objectContaining({
                speaker_type: 'dm',
                text: "A's private scene fact",
              }),
            );
        } else {
          expect(after.dialogue).toHaveLength(before.dialogue.length + 1);
          expect(after.companions).toEqual(before.companions);
          if (sibling.suffix.endsWith('/say'))
            expect(after.dialogue).toContainEqual(
              expect.objectContaining({ speakerType: 'companion', message: 'I watch the gate.' }),
            );
          else {
            expect(owned.json).toMatchObject({
              d20: expect.any(Number),
              total: expect.any(Number),
            });
            expect(after.dialogue).toContainEqual(
              expect.objectContaining({
                context: expect.objectContaining({
                  source: 'companion-roll',
                  companion_id: companionId,
                  d20: owned.json.d20,
                  total: owned.json.total,
                }),
              }),
            );
          }
        }
      });
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
