/**
 * #975 (Hark T3-001, build b68eb041): a premade Fighter at 12/28 HP was offered Action Surge
 * but not Second Wind. The sheet showed "Action Surge (1 use)" -- the spelling only the
 * generated SRD seed (`supabase/migrations/20261009_seed_srd_class_features.sql`) writes -- so
 * the live library carries the generated Fighter rows, and the generated "Second Wind" row has
 * `uses_count` NULL. A character granted that row holds Second Wind with no count anywhere:
 * the legal-action list read it as no use left (never offered), and the spend read it as
 * unlimited (a second use never refused).
 *
 * This suite reproduces that shape through the real paths, not a hand-built sheet:
 * - the library row is the generated seed's own Second Wind row, read from the migration file;
 * - the replayed test library also holds the legacy 20251112_06 "Second Wind" row (count 1),
 *   which a library seeded like prod does not, so that row is set aside while the characters
 *   are created and restored right after;
 * - a premade (the seeder's level-3 Fighter body) and a wizard-made Fighter (the pinned
 *   wizard payload) are created through the real POST /v1/characters route, whose feature
 *   grant picks the generated row;
 * - the offer is read from the real GET legal-actions route, and Second Wind is spent through
 *   the real intent route with the exact chip body.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { and, eq, inArray, ne } from 'drizzle-orm';
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
import { fighterFeatureChipIntentBody } from '../../../../../../shared/test-fixtures/fighter-feature-intent';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../../services/__tests__/fixtures/real-db.js';

let userId = '';

mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId, email: 'second-wind-975@example.test', plan: 'free' },
    error: null,
  }),
}));

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

const here = dirname(fileURLToPath(import.meta.url));

/** The generated seed's Second Wind row, parsed from the migration file itself. */
const GENERATED_SECOND_WIND_ID = 'a43cba29-7da0-5840-c801-28b7ddb889de';
function generatedSecondWindRow(): {
  id: string;
  description: string;
  usageType: string;
  usesPerRest: string;
  usesCount: number | null;
} {
  const sqlText = readFileSync(
    resolve(here, '../../../../../../supabase/migrations/20261009_seed_srd_class_features.sql'),
    'utf8',
  );
  const match = new RegExp(
    `\\('${GENERATED_SECOND_WIND_ID}', 'Fighter', NULL, 'Second Wind', 1, '((?:[^']|'')*)', '(\\w+)', '(\\w+)', (NULL|\\d+)\\)`,
  ).exec(sqlText);
  if (!match) throw new Error('generated Second Wind row not found in the seed migration');
  return {
    id: GENERATED_SECOND_WIND_ID,
    description: match[1].replace(/''/g, "'"),
    usageType: match[2],
    usesPerRest: match[3],
    usesCount: match[4] === 'NULL' ? null : Number(match[4]),
  };
}

/** The pinned real wizard payload for a level-1 Half-Orc Fighter (#898). */
const wizardFighterPayload = JSON.parse(
  readFileSync(
    resolve(here, '../../../../../../shared/test-fixtures/fighter-898-create-payload.json'),
    'utf8',
  ),
) as Record<string, unknown>;

/**
 * The wire body the premade seeder emits for a level-3 Champion Fighter (the same shape the
 * #829 starter-template suite pins); Half-Orc, CON 14, like Hark's Nacha Ferro.
 */
const premadeBody = (campaignId: string): Record<string, unknown> => ({
  name: 'Nacha Ferro',
  race: 'Half-Orc',
  subrace: null,
  class: 'Fighter',
  subclass: 'Champion',
  level: 3,
  background: 'Soldier',
  backstory_elements: null,
  description: null,
  campaign_id: campaignId,
  skill_proficiencies: 'Athletics, Intimidation',
  languages: ['Common', 'Orc'],
  image_url: null,
  avatar_url: null,
  background_image: null,
  cantrips: '',
  known_spells: '',
  prepared_spells: '',
  total_level: 3,
  stats: {
    strength: 16,
    dexterity: 12,
    constitution: 14,
    intelligence: 8,
    wisdom: 12,
    charisma: 10,
  },
  equipment: [
    { item_name: 'Chain Mail', item_type: 'armor', quantity: 1, equipped: true },
    { item_name: 'Greatsword', item_type: 'weapon', quantity: 1, equipped: true },
  ],
});

describeWithDb('Second Wind from the generated seed row (#975, Hark T3-001)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let campaignId = '';
  let insertedGeneratedRow = false;
  const createdCharacterIds: string[] = [];
  const createdSessionIds: string[] = [];

  type Hero = {
    characterId: string;
    level: number;
    encounterId: string;
    participantId: string;
    sessionId: string;
    maxHp: number;
  };
  let premade: Hero;
  let wizardMade: Hero;

  const api = async (path: string, method: string, body?: unknown) => {
    const response: Response = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : {} };
  };

  const createCharacter = async (body: Record<string, unknown>): Promise<string> => {
    const created = await api('/v1/characters', 'POST', body);
    expect(created.status).toBeLessThan(300);
    const id = (created.body.id ?? created.body.character?.id) as string;
    expect(typeof id).toBe('string');
    createdCharacterIds.push(id);
    return id;
  };

  /** A fight for one created character: the hero first, hurt, and one foe out of reach. */
  const seatInFight = async (characterId: string, level: number, name: string): Promise<Hero> => {
    const [stats] = await db
      .select({ maxHp: characterStats.maxHitPoints })
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId));
    const maxHp = stats.maxHp;
    const currentHp = Math.max(1, maxHp - 16);
    await db
      .update(characterStats)
      .set({ currentHitPoints: currentHp })
      .where(eq(characterStats.characterId, characterId));
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    createdSessionIds.push(sessionId);
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 2, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    const rows = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name,
          participantType: 'player',
          turnOrder: 0,
          initiative: 15,
          armorClass: 16,
          maxHp,
          speed: 30,
        },
        {
          encounterId,
          name: 'Red Hand Rider',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 13,
          maxHp: 30,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    const participantId = rows.find((row) => row.turnOrder === 0)!.id;
    const foeId = rows.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId, currentHp, maxHp, isConscious: true },
      { participantId: foeId, currentHp: 30, maxHp: 30, isConscious: true },
    ]);
    await db.insert(tacticalMaps).values({
      sessionId,
      state: {
        id: testId('975-sw-map'),
        sessionId,
        width: 6,
        height: 6,
        // A full grid: the legal-action list plans a move across it.
        cells: Array.from({ length: 6 }, () =>
          Array.from({ length: 6 }, () => ({
            terrain: 'floor',
            blocksMovement: false,
            blocksSight: false,
            cover: 0,
            elevation: 0,
          })),
        ),
        entities: [
          {
            id: participantId,
            name,
            type: 'pc',
            x: 0,
            y: 0,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: foeId,
            name: 'Red Hand Rider',
            type: 'monster',
            x: 5,
            y: 5,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
        round: 2,
        sceneDescription: '975 generated-seed fixture',
      },
      active: true,
    });
    return { characterId, level, encounterId, participantId, sessionId, maxHp };
  };

  const legalActionTypes = async (hero: Hero): Promise<string[]> => {
    const res = await api(`/v1/combat/${hero.encounterId}/legal-actions`, 'GET');
    expect(res.status).toBe(200);
    return (res.body.actions as Array<{ type: string }>).map((action) => action.type);
  };

  const postSecondWind = async (hero: Hero) => {
    const body = fighterFeatureChipIntentBody('second_wind');
    return api(`/v1/combat/${hero.encounterId}/intent`, 'POST', {
      ...body,
      intent: { ...body.intent, actorId: hero.participantId },
    });
  };

  /** A new turn for the hero: the bonus action is back, nothing else changes. */
  const freshBonusAction = async (hero: Hero) => {
    await db
      .update(combatParticipants)
      .set({ bonusActionUsed: false, actionUsed: false })
      .where(eq(combatParticipants.id, hero.participantId));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0 })
      .where(eq(combatEncounters.id, hero.encounterId));
  };

  const secondWindGrant = async (characterId: string) =>
    db
      .select({
        featureId: characterFeatures.featureId,
        usesRemaining: characterFeatures.usesRemaining,
        usesCount: classFeaturesLibrary.usesCount,
      })
      .from(characterFeatures)
      .innerJoin(classFeaturesLibrary, eq(characterFeatures.featureId, classFeaturesLibrary.id))
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(classFeaturesLibrary.featureName, 'Second Wind'),
        ),
      );

  const hp = async (hero: Hero) => {
    const [status] = await db
      .select({ currentHp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, hero.participantId));
    return status.currentHp;
  };

  beforeAll(async () => {
    if (!hasRealDb) return;
    userId = testId('user-975-sw');
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
      const { charactersRoutes } = await import('../../characters.js');
      const { intentRoutes } = await import('../intents.js');
      return { createRequestPipelineApp, charactersRoutes, intentRoutes };
    });
    app = pipeline
      .createRequestPipelineApp()
      .use(pipeline.charactersRoutes)
      .use(new Elysia({ prefix: '/v1/combat' }).use(pipeline.intentRoutes));

    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('975-sw-campaign') })
      .returning({ id: campaigns.id });

    // The generated seed's own Second Wind row (count NULL, as the migration writes it).
    const generated = generatedSecondWindRow();
    expect(generated.usesCount).toBeNull();
    const present = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(eq(classFeaturesLibrary.id, generated.id));
    if (present.length === 0) {
      await db.insert(classFeaturesLibrary).values({
        id: generated.id,
        className: 'Fighter',
        subclassName: null,
        featureName: 'Second Wind',
        levelAcquired: 1,
        description: generated.description,
        usageType: generated.usageType,
        usesPerRest: generated.usesPerRest,
        usesCount: generated.usesCount,
      } as typeof classFeaturesLibrary.$inferInsert);
      insertedGeneratedRow = true;
    }

    // A library seeded like prod holds no legacy "Second Wind" beside the generated one: set
    // the legacy row aside for the creates (its class name no longer matches the grant), and
    // put it back right after, whatever happens.
    const legacy = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Fighter'),
          eq(classFeaturesLibrary.featureName, 'Second Wind'),
          ne(classFeaturesLibrary.id, generated.id),
        ),
      );
    const legacyIds = legacy.map((row) => row.id);
    if (legacyIds.length > 0) {
      await db
        .update(classFeaturesLibrary)
        .set({ className: 'Fighter-set-aside-975' })
        .where(inArray(classFeaturesLibrary.id, legacyIds));
    }
    try {
      const premadeId = await createCharacter(premadeBody(campaignId));
      const wizardId = await createCharacter({ ...wizardFighterPayload, campaign_id: campaignId });
      premade = await seatInFight(premadeId, 3, 'Nacha Ferro');
      wizardMade = await seatInFight(wizardId, 1, 'Probe Fighter 898');
    } finally {
      if (legacyIds.length > 0) {
        await db
          .update(classFeaturesLibrary)
          .set({ className: 'Fighter' })
          .where(inArray(classFeaturesLibrary.id, legacyIds));
      }
    }
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    // Safety net for the set-aside rows if the try/finally above never ran to its end.
    await db
      .update(classFeaturesLibrary)
      .set({ className: 'Fighter' })
      .where(eq(classFeaturesLibrary.className, 'Fighter-set-aside-975'));
    for (const sessionId of createdSessionIds) {
      await db
        .delete(tacticalMaps)
        .where(eq(tacticalMaps.sessionId, sessionId))
        .catch(() => {});
      const encounters = await db
        .select({ id: combatEncounters.id })
        .from(combatEncounters)
        .where(eq(combatEncounters.sessionId, sessionId));
      for (const encounter of encounters) {
        const participants = await db
          .select({ id: combatParticipants.id })
          .from(combatParticipants)
          .where(eq(combatParticipants.encounterId, encounter.id));
        if (participants.length > 0) {
          await db
            .delete(combatParticipantStatus)
            .where(
              inArray(
                combatParticipantStatus.participantId,
                participants.map((p) => p.id),
              ),
            )
            .catch(() => {});
        }
        await db
          .delete(combatParticipants)
          .where(eq(combatParticipants.encounterId, encounter.id))
          .catch(() => {});
      }
      await db
        .delete(combatEncounters)
        .where(eq(combatEncounters.sessionId, sessionId))
        .catch(() => {});
      await db
        .delete(gameSessions)
        .where(eq(gameSessions.id, sessionId))
        .catch(() => {});
    }
    if (createdCharacterIds.length > 0) {
      await db
        .delete(characterFeatures)
        .where(inArray(characterFeatures.characterId, createdCharacterIds))
        .catch(() => {});
      await db
        .delete(characters)
        .where(inArray(characters.id, createdCharacterIds))
        .catch(() => {});
    }
    if (insertedGeneratedRow) {
      await db
        .delete(classFeaturesLibrary)
        .where(eq(classFeaturesLibrary.id, GENERATED_SECOND_WIND_ID))
        .catch(() => {});
    }
    await db
      .delete(campaigns)
      .where(eq(campaigns.id, campaignId))
      .catch(() => {});
    await closeRealDb();
  });

  test('the real create path grants the generated Second Wind row with no count anywhere', async () => {
    for (const hero of [premade, wizardMade]) {
      expect(await secondWindGrant(hero.characterId)).toEqual([
        { featureId: GENERATED_SECOND_WIND_ID, usesRemaining: null, usesCount: null },
      ]);
    }
  });

  for (const which of ['premade', 'wizard-made'] as const) {
    test(`${which} Fighter: Second Wind is offered while hurt, heals 1d10 + level, and a second use is refused`, async () => {
      const hero = which === 'premade' ? premade : wizardMade;
      const before = await hp(hero);
      expect(before).toBeLessThan(hero.maxHp);

      // Offered below full HP while a use remains (Hark's More menu had no Second Wind).
      expect(await legalActionTypes(hero)).toContain('second_wind');

      const first = await postSecondWind(hero);
      expect(first.status).toBe(200);
      const result = first.body.result as {
        applied?: boolean;
        roll?: number;
        healed?: number;
        newHp?: number;
        usesRemaining?: number;
      };
      expect(result.applied).toBe(true);
      expect(result.roll).toBeGreaterThanOrEqual(1);
      expect(result.roll).toBeLessThanOrEqual(10);
      expect(result.healed).toBe(Math.min(result.roll! + hero.level, hero.maxHp - before));
      expect(result.newHp).toBe(before + result.healed!);
      expect(await hp(hero)).toBe(before + result.healed!);
      expect(result.usesRemaining).toBe(0);
      const [map] = await db
        .select()
        .from(tacticalMaps)
        .where(eq(tacticalMaps.sessionId, hero.sessionId));
      expect((map.state as { pendingDmFacts?: string[] }).pendingDmFacts ?? []).toContainEqual(
        expect.stringContaining(`used Second Wind and regained ${result.healed} HP.`),
      );

      // Next turn, still hurt, bonus action back: no use left, so no offer and a refusal.
      await freshBonusAction(hero);
      const afterSpend = await hp(hero);
      if (afterSpend < hero.maxHp) {
        expect(await legalActionTypes(hero)).not.toContain('second_wind');
      }
      await db
        .update(combatParticipantStatus)
        .set({ currentHp: Math.max(1, hero.maxHp - 16) })
        .where(eq(combatParticipantStatus.participantId, hero.participantId));
      expect(await legalActionTypes(hero)).not.toContain('second_wind');
      const second = await postSecondWind(hero);
      expect(second.status).toBe(422);
      expect((second.body.details as { reason?: string } | undefined)?.reason).toBe(
        'feature_uses_exhausted',
      );
      expect(await hp(hero)).toBe(Math.max(1, hero.maxHp - 16));
    });
  }

  test('a short rest gives the generated-row Second Wind back', async () => {
    const { RestService } = await importWithRealDb(
      () => import('../../../../services/rest-service.js'),
    );
    const { fighterFeatureUses } = await importWithRealDb(
      () => import('../../../../services/combat/fighter-features-service.js'),
    );
    expect((await fighterFeatureUses(premade.characterId)).secondWind).toBe(0);
    await RestService.takeShortRest(premade.characterId, userId, 0);
    expect((await fighterFeatureUses(premade.characterId)).secondWind).toBe(1);
  });
});
