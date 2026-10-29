/**
 * #975: the More-menu Fighter feature body through the real intent route.
 *
 * The client sends the versionless DM envelope produced by
 * executeAuthoritativeCombatIntent for both chips. Keep this suite on the
 * real route and the real database so feature ownership, HP writes, use
 * tracking, rest reset, and the pending DM fact are exercised together.
 * #1181 extends the coverage: the deterministic L17 row choice, the L1
 * case, refusals that spend nothing, the no-DM-narration shape, and the
 * suffix-row case the old test named without setting up.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  campaigns,
  characterFeatures,
  characterStats,
  characters,
  classFeaturesLibrary,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  tacticalMaps,
} from '../../../../../../db/schema/index';
import {
  FIGHTER_FEATURE_ACTOR_ID,
  fighterFeatureChipIntentBody,
} from '../../../../../../shared/test-fixtures/fighter-feature-intent';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../../services/__tests__/fixtures/real-db.js';

const userId = `fighter-feature-route-${process.pid}`;

mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === `Bearer ${userId}`
      ? { user: { userId, email: 'fighter-feature@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../../http-pipeline.js'),
);
const { intentRoutes } = await importWithRealDb(() => import('../intents.js'));
const { RestService } = await importWithRealDb(
  () => import('../../../../services/rest-service.js'),
);
const { fighterFeatureUses } = await importWithRealDb(
  () => import('../../../../services/combat/fighter-features-service.js'),
);
const { clearActionSurgeMark } = await importWithRealDb(
  () => import('../../../../services/combat/combat-turn-resources.js'),
);

const app = hasRealDb
  ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
  : null;

if (!hasRealDb) {
  console.warn('[fighter-feature-route] SKIPPED: set TEST_DATABASE_URL to run this suite.');
}

describeWithDb('Fighter feature More-menu bodies resolve through the real route (#975)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let foeId: string;
  let secondWindId: string;
  let actionSurgeId: string;
  let level17SurgeId: string;
  let suffixSurgeId: string;
  const insertedLibraryIds: string[] = [];
  type SeededHero = {
    characterId: string;
    sessionId: string;
    encounterId: string;
    heroId: string;
    actorId: string;
  };
  const seededHeroes: SeededHero[] = [];
  let level17Hero: SeededHero;
  let level1Hero: SeededHero;
  let suffixHero: SeededHero;
  let bothRowsHero: SeededHero;
  let oneRowL17Hero: SeededHero;

  const postChip = async (type: 'second_wind' | 'action_surge') => {
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: JSON.stringify(fighterFeatureChipIntentBody(type)),
      }),
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    return JSON.parse(text) as { result?: Record<string, unknown>; engineRows?: unknown[] };
  };

  const setFeatureUses = async (featureId: string, usesRemaining: number) => {
    await db
      .update(characterFeatures)
      .set({ usesRemaining })
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, featureId),
        ),
      );
  };

  const resetTurn = async () => {
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.id, heroId));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, currentRound: 1, version: 1 })
      .where(eq(combatEncounters.id, encounterId));
  };

  type ChipAnswer = {
    result?: Record<string, unknown>;
    engineRows?: unknown[];
    error?: string;
    details?: { reason?: string; featureName?: string };
    [key: string]: unknown;
  };

  // postChip without the 200 assertion, for any hero's encounter: refusals
  // answer 422 with the reason in details, and the tests assert that shape.
  const postChipFor = async (
    targetEncounterId: string,
    actorId: string,
    type: 'second_wind' | 'action_surge',
  ): Promise<{ status: number; body: ChipAnswer }> => {
    const body = fighterFeatureChipIntentBody(type);
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${targetEncounterId}/intent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, intent: { ...body.intent, actorId } }),
      }),
    );
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text) as ChipAnswer };
  };

  // A second Fighter with its own session/encounter/map, so the armed-mark
  // and version state of one hero's posts never leak into another's
  // session/encounter (the heroes still share the feature library and
  // the test user). The grants are explicit per hero: the L17 hero holds
  // both Action Surge rows, the L1 hero holds no Action Surge row, the
  // suffix hero holds only the suffix row, and the both-rows hero holds
  // both surge rows at level 2.
  const seedHero = async (input: {
    actorId: string;
    name: string;
    level: number;
    maxHp: number;
    currentHp: number;
    grants: Array<{ featureId: string; usesRemaining: number; acquiredAtLevel: number }>;
  }): Promise<SeededHero> => {
    const [{ id: heroCharacterId }] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        campaignId,
        name: input.name,
        class: 'Fighter',
        level: input.level,
        classLevels: [{ className: 'Fighter', level: input.level }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: heroCharacterId,
      strength: 16,
      constitution: 14,
      maxHitPoints: input.maxHp,
      currentHitPoints: input.currentHp,
      speed: 30,
      armorClass: 15,
    });
    await db.insert(characterFeatures).values(
      input.grants.map((grant) => ({
        characterId: heroCharacterId,
        featureId: grant.featureId,
        usesRemaining: grant.usesRemaining,
        isActive: true,
        acquiredAtLevel: grant.acquiredAtLevel,
      })),
    );
    const [{ id: heroSessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId: heroCharacterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    const [{ id: heroEncounterId }] = await db
      .insert(combatEncounters)
      .values({
        sessionId: heroSessionId,
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        version: 1,
      })
      .returning({ id: combatEncounters.id });
    const participants = await db
      .insert(combatParticipants)
      .values([
        {
          id: input.actorId,
          encounterId: heroEncounterId,
          characterId: heroCharacterId,
          name: input.name,
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 15,
          maxHp: input.maxHp,
          speed: 30,
        },
        {
          encounterId: heroEncounterId,
          name: 'Training Golem',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 1,
          maxHp: 200,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    const heroParticipantId = participants.find((row) => row.turnOrder === 0)!.id;
    const foeParticipantId = participants.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      {
        participantId: heroParticipantId,
        currentHp: input.currentHp,
        maxHp: input.maxHp,
        isConscious: true,
      },
      { participantId: foeParticipantId, currentHp: 200, maxHp: 200, isConscious: true },
    ]);
    await db.insert(tacticalMaps).values({
      sessionId: heroSessionId,
      state: {
        id: testId(`975-map-${input.actorId.slice(0, 8)}`),
        sessionId: heroSessionId,
        width: 3,
        height: 3,
        cells: [],
        entities: [
          {
            id: heroParticipantId,
            name: input.name,
            type: 'pc',
            x: 0,
            y: 0,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: foeParticipantId,
            name: 'Training Golem',
            type: 'monster',
            x: 2,
            y: 2,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
        round: 1,
        sceneDescription: '975 route fixture',
      },
      active: true,
    });
    const hero: SeededHero = {
      characterId: heroCharacterId,
      sessionId: heroSessionId,
      encounterId: heroEncounterId,
      heroId: heroParticipantId,
      actorId: input.actorId,
    };
    seededHeroes.push(hero);
    return hero;
  };

  const resetHero = async (
    hero: SeededHero,
    hp: number,
    uses: Array<{ featureId: string; usesRemaining: number }>,
  ) => {
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.id, hero.heroId));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, currentRound: 1, version: 1 })
      .where(eq(combatEncounters.id, hero.encounterId));
    for (const use of uses) {
      await db
        .update(characterFeatures)
        .set({ usesRemaining: use.usesRemaining })
        .where(
          and(
            eq(characterFeatures.characterId, hero.characterId),
            eq(characterFeatures.featureId, use.featureId),
          ),
        );
    }
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: hp, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, hero.heroId));
    await db
      .update(characterStats)
      .set({ currentHitPoints: hp })
      .where(eq(characterStats.characterId, hero.characterId));
  };

  // The pending DM facts on a session's map, for the refusal tests'
  // nothing-else-happened assertions.
  const pendingFacts = async (targetSessionId: string): Promise<string[]> => {
    const [map] = await db
      .select()
      .from(tacticalMaps)
      .where(eq(tacticalMaps.sessionId, targetSessionId));
    return (map.state as { pendingDmFacts?: string[] }).pendingDmFacts ?? [];
  };

  beforeAll(async () => {
    if (!hasRealDb) return;
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('975-route-campaign') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        campaignId,
        name: testId('975-route-fighter'),
        class: 'Fighter',
        level: 2,
        classLevels: [{ className: 'Fighter', level: 2 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      constitution: 14,
      maxHitPoints: 12,
      currentHitPoints: 4,
      speed: 30,
      armorClass: 15,
    });

    const fighterFeatures = await db
      .select({ id: classFeaturesLibrary.id, name: classFeaturesLibrary.featureName })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Fighter'),
          inArray(classFeaturesLibrary.featureName, [
            'Second Wind',
            'Action Surge',
            'Action Surge (1 use)',
          ]),
        ),
      );
    secondWindId = fighterFeatures.find((row) => row.name === 'Second Wind')?.id ?? '';
    actionSurgeId =
      fighterFeatures.find((row) => row.name === 'Action Surge')?.id ??
      fighterFeatures.find((row) => row.name === 'Action Surge (1 use)')?.id ??
      '';
    expect(secondWindId).toBeTruthy();
    expect(actionSurgeId).toBeTruthy();
    await db.insert(characterFeatures).values([
      {
        characterId,
        featureId: secondWindId,
        usesRemaining: 1,
        isActive: true,
        acquiredAtLevel: 1,
      },
      {
        characterId,
        featureId: actionSurgeId,
        usesRemaining: 1,
        isActive: true,
        acquiredAtLevel: 2,
      },
    ]);

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    const participants = await db
      .insert(combatParticipants)
      .values([
        {
          id: FIGHTER_FEATURE_ACTOR_ID,
          encounterId,
          characterId,
          name: 'Fighter Hero',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 15,
          maxHp: 12,
          speed: 30,
        },
        {
          encounterId,
          name: 'Training Golem',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 1,
          maxHp: 200,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    heroId = participants.find((row) => row.turnOrder === 0)!.id;
    foeId = participants.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 4, maxHp: 12, isConscious: true },
      { participantId: foeId, currentHp: 200, maxHp: 200, isConscious: true },
    ]);
    await db.insert(tacticalMaps).values({
      sessionId,
      state: {
        id: testId('975-map'),
        sessionId,
        width: 3,
        height: 3,
        cells: [],
        entities: [
          {
            id: heroId,
            name: 'Fighter Hero',
            type: 'pc',
            x: 0,
            y: 0,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: foeId,
            name: 'Training Golem',
            type: 'monster',
            x: 2,
            y: 2,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
        round: 1,
        sceneDescription: '975 route fixture',
      },
      active: true,
    });

    // #1181 Required 1 — the L17 row and the suffix spelling, inserted only
    // when the test database does not already carry them, so the cases the
    // new tests name exist whatever seed the database was built from.
    const surgeLibrary = await db
      .select({
        id: classFeaturesLibrary.id,
        name: classFeaturesLibrary.featureName,
        levelAcquired: classFeaturesLibrary.levelAcquired,
      })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Fighter'),
          inArray(classFeaturesLibrary.featureName, [
            'Action Surge',
            'Action Surge (1 use)',
            'Action Surge (2 uses)',
            'Action Surge (two uses)',
          ]),
        ),
      );
    const canonicalSurge = (name: string) =>
      name
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim()
        .toLowerCase();
    const level17Row = surgeLibrary.find(
      (row) => row.levelAcquired === 17 && canonicalSurge(row.name) === 'action surge',
    );
    level17SurgeId = level17Row?.id ?? '';
    if (!level17SurgeId) {
      [{ id: level17SurgeId }] = await db
        .insert(classFeaturesLibrary)
        .values({
          className: 'Fighter',
          featureName: 'Action Surge (two uses)',
          levelAcquired: 17,
          // Test-only row: the description is never asserted, only the
          // NOT NULL column it fills.
          description:
            'Test-only Action Surge row (two uses at 17th level), inserted by the #1181 suite.',
          usageType: 'limited_use',
          usesPerRest: 'short_rest',
          usesCount: 2,
        })
        .returning({ id: classFeaturesLibrary.id });
      insertedLibraryIds.push(level17SurgeId);
    }
    suffixSurgeId =
      surgeLibrary.find((row) => row.name === 'Action Surge (1 use)' && row.levelAcquired === 2)
        ?.id ?? '';
    if (!suffixSurgeId) {
      [{ id: suffixSurgeId }] = await db
        .insert(classFeaturesLibrary)
        .values({
          className: 'Fighter',
          featureName: 'Action Surge (1 use)',
          levelAcquired: 2,
          description: 'Test-only Action Surge row (suffix spelling), inserted by the #1181 suite.',
          usageType: 'limited_use',
          usesPerRest: 'short_rest',
          usesCount: 1,
        })
        .returning({ id: classFeaturesLibrary.id });
      insertedLibraryIds.push(suffixSurgeId);
    }
    expect(level17SurgeId, 'L17 Action Surge library row').toBeTruthy();
    expect(suffixSurgeId, 'suffix Action Surge library row').toBeTruthy();

    // The L17 hero holds BOTH Action Surge rows; the L1 hero holds no
    // Action Surge row at all; the suffix hero holds ONLY the suffix row;
    // the both-rows hero holds both surge rows at level 2 (the skip
    // branch: the L2 row must win over the too-high L17 row).
    level17Hero = await seedHero({
      actorId: 'e7e569df-0000-4000-8000-000000000002',
      name: 'L17 Fighter',
      level: 17,
      maxHp: 100,
      currentHp: 50,
      grants: [
        { featureId: secondWindId, usesRemaining: 1, acquiredAtLevel: 1 },
        { featureId: actionSurgeId, usesRemaining: 1, acquiredAtLevel: 2 },
        { featureId: level17SurgeId, usesRemaining: 2, acquiredAtLevel: 17 },
      ],
    });
    level1Hero = await seedHero({
      actorId: 'e7e569df-0000-4000-8000-000000000003',
      name: 'L1 Fighter',
      level: 1,
      maxHp: 12,
      currentHp: 4,
      grants: [{ featureId: secondWindId, usesRemaining: 1, acquiredAtLevel: 1 }],
    });
    suffixHero = await seedHero({
      actorId: 'e7e569df-0000-4000-8000-000000000004',
      name: 'Suffix Fighter',
      level: 2,
      maxHp: 12,
      currentHp: 4,
      grants: [
        { featureId: secondWindId, usesRemaining: 1, acquiredAtLevel: 1 },
        { featureId: suffixSurgeId, usesRemaining: 1, acquiredAtLevel: 2 },
      ],
    });
    bothRowsHero = await seedHero({
      actorId: 'e7e569df-0000-4000-8000-000000000005',
      name: 'Both Rows Fighter',
      level: 2,
      maxHp: 12,
      currentHp: 4,
      grants: [
        { featureId: secondWindId, usesRemaining: 1, acquiredAtLevel: 1 },
        { featureId: actionSurgeId, usesRemaining: 1, acquiredAtLevel: 2 },
        { featureId: level17SurgeId, usesRemaining: 2, acquiredAtLevel: 17 },
      ],
    });
    // #1187: a level-17 Fighter holding only the level-2 Action Surge row -- the one-row
    // library after the #1187 data migration. Starts spent, so the rest is what refills it.
    oneRowL17Hero = await seedHero({
      actorId: 'e7e569df-0000-4000-8000-000000000006',
      name: 'One Row L17 Fighter',
      level: 17,
      maxHp: 100,
      currentHp: 50,
      grants: [
        { featureId: secondWindId, usesRemaining: 1, acquiredAtLevel: 1 },
        { featureId: actionSurgeId, usesRemaining: 0, acquiredAtLevel: 2 },
      ],
    });
  });

  beforeEach(async () => {
    await resetTurn();
    await setFeatureUses(secondWindId, 1);
    await setFeatureUses(actionSurgeId, 1);
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 4, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, heroId));
    await db
      .update(characterStats)
      .set({ currentHitPoints: 4 })
      .where(eq(characterStats.characterId, characterId));
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    await db.delete(characterFeatures).where(eq(characterFeatures.characterId, characterId));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    for (const hero of seededHeroes) {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, hero.sessionId));
      await db.delete(characterFeatures).where(eq(characterFeatures.characterId, hero.characterId));
      await db
        .delete(combatParticipants)
        .where(eq(combatParticipants.encounterId, hero.encounterId));
      await db.delete(combatEncounters).where(eq(combatEncounters.id, hero.encounterId));
      await db.delete(gameSessions).where(eq(gameSessions.id, hero.sessionId));
      await db.delete(characters).where(eq(characters.id, hero.characterId));
    }
    for (const libraryId of insertedLibraryIds) {
      await db.delete(classFeaturesLibrary).where(eq(classFeaturesLibrary.id, libraryId));
    }
    await closeRealDb();
  });

  test('Second Wind uses the exact bar body, heals, spends the feature, and leaves an engine fact', async () => {
    const response = await postChip('second_wind');
    const result = response.result as { applied?: boolean; healed?: number; newHp?: number };
    expect(result.applied).toBe(true);
    expect(result.healed).toBeGreaterThan(0);
    expect(result.newHp).toBeGreaterThan(4);
    const [feature] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, secondWindId),
        ),
      );
    expect(feature.usesRemaining).toBe(0);
    const [map] = await db.select().from(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    expect((map.state as { pendingDmFacts?: string[] }).pendingDmFacts).toContain(
      'Fighter Hero used Second Wind and regained ' + result.healed + ' HP.',
    );
  });

  test('Action Surge resolves through the real route and arms one extra action', async () => {
    const response = await postChip('action_surge');
    expect(response.result).toMatchObject({
      applied: true,
      action: 'action_surge',
      extraActionArmed: true,
    });
    const [feature] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, actionSurgeId),
        ),
      );
    expect(feature.usesRemaining).toBe(0);
    const [session] = await db
      .select({ state: gameSessions.sessionState })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId));
    expect((session.state as { actionSurgeArmed?: unknown }).actionSurgeArmed).toBeTruthy();
  });

  test('a short rest restores both More-menu features', async () => {
    await setFeatureUses(secondWindId, 0);
    await setFeatureUses(actionSurgeId, 0);
    await RestService.takeShortRest(characterId, userId, 0);
    const rows = await db
      .select({ id: characterFeatures.featureId, uses: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(eq(characterFeatures.characterId, characterId));
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: secondWindId, uses: 1 },
        { id: actionSurgeId, uses: 1 },
      ]),
    );
  });

  test('level 17: the spend and the displayed count follow the L17 row, not the L2 row (#1181 Required 1)', async () => {
    await resetHero(level17Hero, 50, [
      { featureId: secondWindId, usesRemaining: 1 },
      { featureId: actionSurgeId, usesRemaining: 1 },
      { featureId: level17SurgeId, usesRemaining: 2 },
    ]);
    expect(await fighterFeatureUses(level17Hero.characterId)).toEqual({
      secondWind: 1,
      actionSurge: 2,
    });
    const { status, body } = await postChipFor(
      level17Hero.encounterId,
      level17Hero.actorId,
      'action_surge',
    );
    expect(status).toBe(200);
    expect(body.result).toMatchObject({
      applied: true,
      action: 'action_surge',
      usesRemaining: 1,
    });
    expect(await fighterFeatureUses(level17Hero.characterId)).toEqual({
      secondWind: 1,
      actionSurge: 1,
    });
    const rows = await db
      .select({ featureId: characterFeatures.featureId, uses: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(eq(characterFeatures.characterId, level17Hero.characterId));
    expect(rows).toContainEqual({ featureId: level17SurgeId, uses: 1 });
    expect(rows).toContainEqual({ featureId: actionSurgeId, uses: 1 });
  });

  test('level 2 holding both rows: the L2 row is spent and the L17 row untouched (#1181)', async () => {
    // The skip branch: at level 2 the pick must pass over the too-high
    // L17 row instead of always taking the highest row held.
    await resetHero(bothRowsHero, 4, [
      { featureId: secondWindId, usesRemaining: 1 },
      { featureId: actionSurgeId, usesRemaining: 1 },
      { featureId: level17SurgeId, usesRemaining: 2 },
    ]);
    expect(await fighterFeatureUses(bothRowsHero.characterId)).toEqual({
      secondWind: 1,
      actionSurge: 1,
    });
    const { status, body } = await postChipFor(
      bothRowsHero.encounterId,
      bothRowsHero.actorId,
      'action_surge',
    );
    expect(status).toBe(200);
    expect(body.result).toMatchObject({
      applied: true,
      action: 'action_surge',
      usesRemaining: 0,
    });
    expect(await fighterFeatureUses(bothRowsHero.characterId)).toEqual({
      secondWind: 1,
      actionSurge: 0,
    });
    const rows = await db
      .select({ featureId: characterFeatures.featureId, uses: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(eq(characterFeatures.characterId, bothRowsHero.characterId));
    expect(rows).toContainEqual({ featureId: actionSurgeId, uses: 0 });
    expect(rows).toContainEqual({ featureId: level17SurgeId, uses: 2 });
  });

  test('level 1: Second Wind resolves and Action Surge is refused with no row to spend (#1181)', async () => {
    expect(await fighterFeatureUses(level1Hero.characterId)).toEqual({
      secondWind: 1,
      actionSurge: null,
    });
    const wind = await postChipFor(level1Hero.encounterId, level1Hero.actorId, 'second_wind');
    expect(wind.status).toBe(200);
    const windResult = wind.body.result as { applied?: boolean; healed?: number; newHp?: number };
    expect(windResult.applied).toBe(true);
    expect(windResult.healed).toBeGreaterThan(0);
    expect(windResult.newHp).toBeGreaterThan(4);
    const [windRow] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, level1Hero.characterId),
          eq(characterFeatures.featureId, secondWindId),
        ),
      );
    expect(windRow.usesRemaining).toBe(0);
    const surge = await postChipFor(level1Hero.encounterId, level1Hero.actorId, 'action_surge');
    expect(surge.status).toBe(422);
    expect(surge.body.details?.reason).toBe('feature_not_on_sheet');
    const rows = await db
      .select({ featureId: characterFeatures.featureId })
      .from(characterFeatures)
      .where(eq(characterFeatures.characterId, level1Hero.characterId));
    expect(rows).toEqual([{ featureId: secondWindId }]);
  });

  test('Action Surge with no uses left is refused and spends nothing (#1181)', async () => {
    // The earlier Action Surge test arms the surge mark in this session;
    // clear it through the module's own guarded delete (a snapshot
    // read-modify-write of session_state is forbidden — see
    // combat-turn-resources.ts) so the refusal measures the spend.
    await clearActionSurgeMark(sessionId, heroId);
    await setFeatureUses(actionSurgeId, 0);
    const factsBefore = await pendingFacts(sessionId);
    const { status, body } = await postChipFor(
      encounterId,
      FIGHTER_FEATURE_ACTOR_ID,
      'action_surge',
    );
    expect(status).toBe(422);
    expect(body.details?.reason).toBe('feature_uses_exhausted');
    const [feature] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, actionSurgeId),
        ),
      );
    expect(feature.usesRemaining).toBe(0);
    expect(await pendingFacts(sessionId)).toEqual(factsBefore);
  });

  test('Second Wind with no uses left is refused and spends nothing (#1181)', async () => {
    await setFeatureUses(secondWindId, 0);
    const factsBefore = await pendingFacts(sessionId);
    const { status, body } = await postChipFor(
      encounterId,
      FIGHTER_FEATURE_ACTOR_ID,
      'second_wind',
    );
    expect(status).toBe(422);
    expect(body.details?.reason).toBe('feature_uses_exhausted');
    const [feature] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, secondWindId),
        ),
      );
    expect(feature.usesRemaining).toBe(0);
    expect(await pendingFacts(sessionId)).toEqual(factsBefore);
  });

  test('Second Wind at full health is refused before anything is spent (#1181)', async () => {
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 12 })
      .where(eq(combatParticipantStatus.participantId, heroId));
    await db
      .update(characterStats)
      .set({ currentHitPoints: 12 })
      .where(eq(characterStats.characterId, characterId));
    const factsBefore = await pendingFacts(sessionId);
    const { status, body } = await postChipFor(
      encounterId,
      FIGHTER_FEATURE_ACTOR_ID,
      'second_wind',
    );
    expect(status).toBe(422);
    expect(body.details?.reason).toBe('already_full_health');
    const [feature] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, secondWindId),
        ),
      );
    expect(feature.usesRemaining).toBe(1);
    const [statusRow] = await db
      .select({ currentHp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, heroId));
    expect(statusRow.currentHp).toBe(12);
    expect(await pendingFacts(sessionId)).toEqual(factsBefore);
  });

  test('the route answer carries no narration; the fact is deferred (#1181)', async () => {
    // The route answer must carry no DM text of its own: the DM narrates
    // on its next generate call, from the fact the engine leaves in
    // pendingDmFacts. This pins the answer shape (no narration keys at
    // the top level or in the result) and the deferred fact. It does not
    // spy on the DM entry point, so it cannot prove no DM call occurred.
    const { status, body } = await postChipFor(
      encounterId,
      FIGHTER_FEATURE_ACTOR_ID,
      'second_wind',
    );
    expect(status).toBe(200);
    const result = body.result as { applied?: boolean; healed?: number };
    expect(result.applied).toBe(true);
    expect(Object.keys(body)).not.toContain('dmReply');
    expect(Object.keys(body)).not.toContain('narration');
    const forbidden = ['dmReply', 'narration', 'dmNarration', 'dmText'];
    for (const key of Object.keys(result)) expect(forbidden).not.toContain(key);
    const [map] = await db.select().from(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    expect((map.state as { pendingDmFacts?: string[] }).pendingDmFacts).toContain(
      'Fighter Hero used Second Wind and regained ' + result.healed + ' HP.',
    );
  });

  test('Action Surge spends the suffix-named row when the legacy row was never granted (#1181)', async () => {
    // The case the old suffix test names but never sets up: this hero holds
    // ONLY "Action Surge (1 use)" — no legacy "Action Surge" row at all.
    const granted = await db
      .select({
        name: classFeaturesLibrary.featureName,
        uses: characterFeatures.usesRemaining,
      })
      .from(characterFeatures)
      .innerJoin(classFeaturesLibrary, eq(characterFeatures.featureId, classFeaturesLibrary.id))
      .where(eq(characterFeatures.characterId, suffixHero.characterId));
    const surgeRows = granted.filter(
      (row) =>
        row.name
          .replace(/\s*\([^)]*\)\s*$/, '')
          .trim()
          .toLowerCase() === 'action surge',
    );
    expect(surgeRows).toEqual([{ name: 'Action Surge (1 use)', uses: 1 }]);
    expect(await fighterFeatureUses(suffixHero.characterId)).toEqual({
      secondWind: 1,
      actionSurge: 1,
    });
    const { status, body } = await postChipFor(
      suffixHero.encounterId,
      suffixHero.actorId,
      'action_surge',
    );
    expect(status).toBe(200);
    expect(body.result).toMatchObject({
      applied: true,
      action: 'action_surge',
      extraActionArmed: true,
    });
    const [spent] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, suffixHero.characterId),
          eq(characterFeatures.featureId, suffixSurgeId),
        ),
      );
    expect(spent.usesRemaining).toBe(0);
    expect(await fighterFeatureUses(suffixHero.characterId)).toEqual({
      secondWind: 1,
      actionSurge: 0,
    });
  });

  test('#1187: the replayed library holds both Action Surge rows until the follow-up merge (step 1 only)', async () => {
    // Step 1 only (option (a)): the level-17 "two uses" row stays until the follow-up
    // migration merges it (db/migrations/20261027_merge_action_surge_rows.sql). Rows this
    // suite inserts for the #1181 backstop cases are marked "Test-only" and are not the seed.
    const rows = await db
      .select({
        name: classFeaturesLibrary.featureName,
        levelAcquired: classFeaturesLibrary.levelAcquired,
        usesCount: classFeaturesLibrary.usesCount,
        description: classFeaturesLibrary.description,
      })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Fighter'),
          inArray(classFeaturesLibrary.featureName, [
            'Action Surge',
            'Action Surge (1 use)',
            'Action Surge (2 uses)',
            'Action Surge (two uses)',
          ]),
        ),
      )
      .orderBy(asc(classFeaturesLibrary.levelAcquired));
    const seeded = rows.filter((row) => !row.description.startsWith('Test-only'));
    expect(
      seeded.map(({ name, levelAcquired, usesCount }) => ({ name, levelAcquired, usesCount })),
    ).toEqual([
      { name: 'Action Surge', levelAcquired: 2, usesCount: 1 },
      { name: 'Action Surge (two uses)', levelAcquired: 17, usesCount: 2 },
    ]);
  });

  test('#1187: a level-17 sheet with only the level-2 row rests to two uses and spends one', async () => {
    await RestService.takeShortRest(oneRowL17Hero.characterId, userId, 0);
    const [refilled] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, oneRowL17Hero.characterId),
          eq(characterFeatures.featureId, actionSurgeId),
        ),
      );
    expect(refilled.usesRemaining).toBe(2);
    expect(await fighterFeatureUses(oneRowL17Hero.characterId)).toEqual({
      secondWind: 1,
      actionSurge: 2,
    });

    const { status, body } = await postChipFor(
      oneRowL17Hero.encounterId,
      oneRowL17Hero.actorId,
      'action_surge',
    );
    expect(status).toBe(200);
    expect(body.result).toMatchObject({ applied: true, action: 'action_surge', usesRemaining: 1 });
    expect(await fighterFeatureUses(oneRowL17Hero.characterId)).toEqual({
      secondWind: 1,
      actionSurge: 1,
    });
  });

  test('#1187: an untracked level-2 row reads as two uses at level 17', async () => {
    await db
      .update(characterFeatures)
      .set({ usesRemaining: null })
      .where(
        and(
          eq(characterFeatures.characterId, oneRowL17Hero.characterId),
          eq(characterFeatures.featureId, actionSurgeId),
        ),
      );
    expect(await fighterFeatureUses(oneRowL17Hero.characterId)).toEqual({
      secondWind: 1,
      actionSurge: 2,
    });
  });
});
