/**
 * #2459 single spell-slot source, against a real database.
 *
 * The production state: a premade level-1 wizard whose `characters.spell_slots`
 * JSONB holds the seeder's wire value but who has no `character_spell_slots`
 * rows at all. The real engine (`SpellSlotsService.useSpellSlot`) must create
 * the missing rows from the real class progression table and resolve the cast,
 * and the sheet-facing payload must serve the engine's table so both read 2→1.
 * A non-caster in the same state gets a refusal that names the cause instead
 * of the generic "not found".
 *
 * Asserted through the real services, never hand-built rows: a constructed
 * slot object would pass whether or not the engine ever writes one.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import { closeRealDb, describeWithDb, hasRealDb, importWithRealDb, realDb, testId } from './fixtures/real-db.js';
import { campaigns, characters, characterSpellSlots, characterSubclasses } from '../../../../db/schema/index';
import { premadeWizardSpellSlotsWireValue } from '../../../../shared/test-fixtures/premade-wizard-spell-slots';

import type { CharacterSpellSlot } from '../../../../db/schema/index';

const stub = () => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});

mock.module('../../lib/logger.js', () => ({
  logger: stub(),
  combatLogger: stub(),
  spellLogger: stub(),
  progressionLogger: stub(),
  errorLogSerializers: {},
}));

// Do not link the real server modules when the suite is intentionally skipped.
// Their import graph reaches db/client, whose eager connection guard is an
// environment error rather than a test result.
const SpellSlotsService = hasRealDb
  ? (await import('../spell-slots-service.js')).SpellSlotsService
  : undefined;
const SpellSlotDataAccess = hasRealDb
  ? (await import('../spell-slots/spell-slot-data-access.js')).SpellSlotDataAccess
  : undefined;
const LevelUpService = hasRealDb
  ? (await import('../progression/level-up-service.js')).LevelUpService
  : undefined;
const ProgressionService = hasRealDb
  ? (await import('../progression-service.js')).ProgressionService
  : undefined;
const RestService = hasRealDb
  ? (await import('../rest-service.js')).RestService
  : undefined;
const SubclassService = hasRealDb
  ? (await import('../subclass-service.js')).SubclassService
  : undefined;
// The route module's import graph reaches services/workos.ts, which constructs
// its client at import time. This suite never calls WorkOS; the dummies only
// satisfy that import, the same way spell-slot-backfill.real-db.test.ts does.
if (hasRealDb) {
  process.env.PORT ??= '3100';
  process.env.CORS_ORIGIN ??= 'http://localhost:3100';
  process.env.WORKOS_API_KEY ??= 'test-dummy-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-dummy-client-id';
}
const routeExports = hasRealDb ? await import('../../routes/v1/characters.js') : undefined;
const { BusinessLogicError } = hasRealDb
  ? await import('../../lib/errors.js')
  : { BusinessLogicError: Error as unknown as new (...args: never[]) => Error };

// #270: the creation tests below POST through the real /v1/characters route.
// Auth is stubbed (the same shape as character-json-export-import.real-db.test.ts);
// CharacterService and the database are real.
let creationUserId = '';
mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer <redacted>'
      ? {
          user: { userId: creationUserId, email: 'user@example.test', plan: 'free' },
          error: null,
        }
      : { user: null, error: 'Unauthorized' },
}));

const creationPipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../http-pipeline.js');
  const { charactersRoutes } = await import('../../routes/v1/characters.js');
  return createRequestPipelineApp().use(charactersRoutes);
});

// #420 FIX round: the subclass route must grant slots at once, so the test
// goes through the real POST /v1/class-features/characters/:id/subclass.
const subclassPipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../http-pipeline.js');
  const { classFeaturesRoutes } = await import('../../routes/v1/class-features.js');
  return createRequestPipelineApp().use(classFeaturesRoutes);
});

if (!hasRealDb) {
  console.warn(
    '[spell-slot-single-source] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('single spell-slot source (#2459)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('slots-user');

  let campaignId: string;
  let wizardId: string;
  let fighterId: string;
  let multiclassId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    // The premade seed writes the wire value into characters.spell_slots at
    // creation, but no character_spell_slots rows exist — the production state
    // that refused every levelled cast.
    [{ id: wizardId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: 'The Scholar',
        class: 'Wizard',
        level: 1,
        spellSlots: premadeWizardSpellSlotsWireValue,
      })
      .returning({ id: characters.id });

    [{ id: fighterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('fighter'),
        class: 'Fighter',
        level: 1,
      })
      .returning({ id: characters.id });

    // Multiclass: Wizard 1 / Fighter 1. The missing row must come from the PHB
    // combined progression (caster level 1 → 2× L1), not the single-class
    // table at total level 2 (Wizard 2 → 3× L1).
    [{ id: multiclassId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('multiclass'),
        class: 'Wizard',
        level: 2,
        classLevels: [
          { className: 'Wizard', level: 1 },
          { className: 'Fighter', level: 1 },
        ],
      })
      .returning({ id: characters.id });
  });

  afterAll(async () => {
    await closeRealDb();
  });

  // One cohesive fixture chain: the cast in this test leaves the 2→1 state the
  // sheet assertions below read, the way the production cast precedes the
  // sheet refresh.
  it('casts Burning Hands with no slot rows: the row is created from the class table', async () => {
    const result = await SpellSlotsService!.useSpellSlot(
      {
        characterId: wizardId,
        spellName: 'Burning Hands',
        spellLevel: 1,
        slotLevelUsed: 1,
      },
      userId,
    );

    expect(result.success).toBe(true);
    expect(result.slot.spellLevel).toBe(1);
    // Wizard 1 from the real progression table, not a hardcoded 2.
    expect(result.slot.totalSlots).toBe(2);
    expect(result.slot.usedSlots).toBe(1);
  });

  it('engine and sheet-facing payload both read 2→1 from the same table', async () => {
    const { slots } = await SpellSlotDataAccess!.getCharacterSpellSlots(wizardId, userId);
    const level1 = slots.find((slot) => slot.spellLevel === 1);
    expect(level1?.totalSlots).toBe(2);
    expect(level1?.usedSlots).toBe(1);

    const row = await db.query.characters.findFirst({
      where: eq(characters.id, wizardId),
    });
    const routes = routeExports as NonNullable<typeof routeExports>;
    const mapped = routes.mapCharacterToApi(row as Parameters<typeof routes.mapCharacterToApi>[0]);
    const overlaid = await routes.overlayEngineSpellSlots(mapped, wizardId, userId);
    expect(overlaid?.spell_slots).toEqual({ '1': { max: 2, current: 1 } });
  });

  it('a non-caster with no slot rows gets a refusal that names the cause', async () => {
    const error = await SpellSlotsService!
      .useSpellSlot(
        {
          characterId: fighterId,
          spellName: 'Burning Hands',
          spellLevel: 1,
          slotLevelUsed: 1,
        },
        userId,
      )
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(BusinessLogicError);
    expect(String((error as Error).message)).toMatch(/has no level 1 spell slots/);
    expect(String((error as Error).message)).toMatch(/Fighter/);
  });

  it('a multiclass character gets the PHB combined progression, not the single-class table', async () => {
    const result = await SpellSlotsService!.useSpellSlot(
      {
        characterId: multiclassId,
        spellName: 'Burning Hands',
        spellLevel: 1,
        slotLevelUsed: 1,
      },
      userId,
    );

    expect(result.success).toBe(true);
    // Caster level 1 (Wizard 1) → 2× L1, not Wizard 2 → 3× L1.
    expect(result.slot.totalSlots).toBe(2);
    expect(result.slot.usedSlots).toBe(1);
  });
});

/**
 * #270: creation seeds slot rows from the single slot source, through the real
 * POST /v1/characters route (the wizard save, premade seeding and JSON import
 * all land on `CharacterService.create`). Auth is stubbed; the service and the
 * database are real.
 *
 * The expected totals come from the 2014 5e tables in
 * `SpellSlotMechanics` — the same tables the engine reads on a first cast —
 * not from hardcoded copies: the L3 cleric and L2 paladin cases pin the
 * full-caster and half-caster progressions.
 */
describeWithDb('creation seeds slot rows from the single slot source (#270)', () => {
  // Re-acquired in beforeAll: the block above closes the shared fixture client
  // in its afterAll, so a describe-body capture would point at an ended pool.
  let db: ReturnType<typeof realDb>;
  const createdIds: string[] = [];

  beforeAll(() => {
    creationUserId = testId('creation-user');
    db = realDb();
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    for (const id of createdIds) {
      try {
        await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, id));
        await db.delete(characters).where(eq(characters.id, id));
      } catch {
        /* fixture teardown is best-effort */
      }
    }
    await closeRealDb();
  });

  const createViaRoute = async (name: string, cls: string, level: number): Promise<string> => {
    const response = await creationPipeline.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: {
          authorization: 'Bearer <redacted>',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name,
          class: cls,
          level,
          stats: {
            strength: 10,
            dexterity: 14,
            constitution: 14,
            intelligence: 16,
            wisdom: 12,
            charisma: 10,
            armor_class: 12,
            max_hit_points: 10,
            current_hit_points: 10,
            speed: 30,
          },
        }),
      }),
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdIds.push(created.id);
    return created.id;
  };

  const slotRows = (characterId: string): Promise<CharacterSpellSlot[]> =>
    db
      .select()
      .from(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, characterId))
      .orderBy(characterSpellSlots.spellLevel);

  const totals = async (characterId: string): Promise<Array<[number, number, number]>> =>
    (await slotRows(characterId)).map(
      (row) => [row.spellLevel, row.totalSlots, row.usedSlots] as [number, number, number],
    );

  it('L1 wizard gets 2 first-level slots', async () => {
    const id = await createViaRoute(testId('wiz'), 'Wizard', 1);
    expect(await totals(id)).toEqual([[1, 2, 0]]);
  });

  it('L3 cleric gets the 2014 full-caster table', async () => {
    const id = await createViaRoute(testId('clr'), 'Cleric', 3);
    expect(await totals(id)).toEqual([
      [1, 4, 0],
      [2, 2, 0],
    ]);
  });

  it('L2 paladin gets the 2014 half-caster table', async () => {
    const id = await createViaRoute(testId('pal'), 'Paladin', 2);
    expect(await totals(id)).toEqual([[1, 2, 0]]);
  });

  it('L3 paladin gets 3 first-level slots (PHB single-class, ceil(3/2))', async () => {
    const id = await createViaRoute(testId('pal3'), 'Paladin', 3);
    expect(await totals(id)).toEqual([[1, 3, 0]]);
  });

  it('L5 paladin gets 4 first + 2 second (PHB single-class, ceil(5/2))', async () => {
    const id = await createViaRoute(testId('pal5'), 'Paladin', 5);
    expect(await totals(id)).toEqual([
      [1, 4, 0],
      [2, 2, 0],
    ]);
  });

  it('L2 ranger gets 2 first-level slots (PHB single-class, ceil(2/2))', async () => {
    const id = await createViaRoute(testId('rng2'), 'Ranger', 2);
    expect(await totals(id)).toEqual([[1, 2, 0]]);
  });

  it('L7 eldritch knight gets 4 first + 2 second (PHB single-class, ceil(7/3))', async () => {
    const id = await createViaRoute(testId('ek7'), 'Eldritch Knight', 7);
    expect(await totals(id)).toEqual([
      [1, 4, 0],
      [2, 2, 0],
    ]);
  });

  it('L5 wizard gets the 2014 full-caster table', async () => {
    const id = await createViaRoute(testId('wiz5'), 'Wizard', 5);
    expect(await totals(id)).toEqual([
      [1, 4, 0],
      [2, 3, 0],
      [3, 2, 0],
    ]);
  });

  it('a non-caster gets no rows', async () => {
    const id = await createViaRoute(testId('ftr'), 'Fighter', 1);
    expect(await totals(id)).toEqual([]);
  });

  it('L1 warlock gets 1 pact slot at level 1 (#397)', async () => {
    const id = await createViaRoute(testId('wlk1'), 'Warlock', 1);
    expect(await totals(id)).toEqual([[1, 1, 0]]);
  });

  it('L3 warlock gets 2 pact slots at level 2 (#397)', async () => {
    const id = await createViaRoute(testId('wlk3'), 'Warlock', 3);
    expect(await totals(id)).toEqual([[2, 2, 0]]);
  });

  it('L5 warlock gets 2 pact slots at level 3 (#397)', async () => {
    const id = await createViaRoute(testId('wlk5'), 'Warlock', 5);
    expect(await totals(id)).toEqual([[3, 2, 0]]);
  });

  it('L11 warlock gets 3 pact slots at level 5 (#397)', async () => {
    const id = await createViaRoute(testId('wlk11'), 'Warlock', 11);
    expect(await totals(id)).toEqual([[5, 3, 0]]);
  });

  it('a short rest restores a warlock\u2019s spent pact slot (#397)', async () => {
    const id = await createViaRoute(testId('wlkSr'), 'Warlock', 1);
    const spent = await SpellSlotsService!.useSpellSlot(
      { characterId: id, spellName: 'Hex', spellLevel: 1, slotLevelUsed: 1 },
      creationUserId,
    );
    expect(spent.success).toBe(true);
    expect(await totals(id)).toEqual([[1, 1, 1]]);

    await RestService!.takeShortRest(id, creationUserId);
    expect(await totals(id)).toEqual([[1, 1, 0]]);
  });

  it('level-up re-syncs a warlock\u2019s pact rows and prunes the old slot level (#397)', async () => {
    const id = await createViaRoute(testId('wlkLvl'), 'Warlock', 1);
    expect(await totals(id)).toEqual([[1, 1, 0]]);

    await ProgressionService!.initializeProgression(id, creationUserId);
    const first = await LevelUpService!.levelUp({ characterId: id }, creationUserId);
    expect(first.newLevel).toBe(2);
    // Warlock 2: 2 pact slots, still at slot level 1.
    expect(await totals(id)).toEqual([[1, 2, 0]]);

    const second = await LevelUpService!.levelUp({ characterId: id }, creationUserId);
    expect(second.newLevel).toBe(3);
    // Warlock 3: 2 pact slots at slot level 2; the level-1 row is pruned.
    expect(await totals(id)).toEqual([[2, 2, 0]]);
  });

  // #420: the app sends Fighter/Rogue with a subclass; the slot calculation
  // reads the subclass for third casters. The subclass row is written by the
  // real SubclassService (its producer), and setSubclass itself now runs the
  // re-sync — no hand-sync here, so these tests prove slots are granted at
  // subclass-pick time.
  const grantThirdCasterRows = async (
    name: string,
    cls: string,
    subclass: string,
    level: number,
  ): Promise<string> => {
    const id = await createViaRoute(testId(name), cls, level);
    await SubclassService!.setSubclass({
      characterId: id,
      className: cls,
      subclassName: subclass,
      level,
      userId: creationUserId,
    });
    return id;
  };

  it('Fighter + Eldritch Knight L3 gets 2 first-level slots (#420)', async () => {
    const id = await grantThirdCasterRows('ek3', 'Fighter', 'Eldritch Knight', 3);
    expect(await totals(id)).toEqual([[1, 2, 0]]);
  });

  it('Fighter + Eldritch Knight L7 gets 4 first + 2 second (#420)', async () => {
    const id = await grantThirdCasterRows('ek7', 'Fighter', 'Eldritch Knight', 7);
    expect(await totals(id)).toEqual([
      [1, 4, 0],
      [2, 2, 0],
    ]);
  });

  it('Rogue + Arcane Trickster L3 gets 2 first-level slots (#420)', async () => {
    const id = await grantThirdCasterRows('at3', 'Rogue', 'Arcane Trickster', 3);
    expect(await totals(id)).toEqual([[1, 2, 0]]);
  });

  it('the subclass route grants EK slots at once, no hand-sync (#420)', async () => {
    const id = await createViaRoute(testId('ekRoute'), 'Fighter', 3);
    const response = await subclassPipeline.handle(
      new Request(`http://localhost/v1/class-features/characters/${id}/subclass`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer <redacted>',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          className: 'Fighter',
          subclassName: 'Eldritch Knight',
          level: 3,
        }),
      }),
    );
    expect(response.status).toBe(201);
    // setSubclass ran the re-sync itself: the rows are there with no extra call.
    expect(await totals(id)).toEqual([[1, 2, 0]]);
  });

  it('Fighter without a subclass still gets no rows at L3 (#420)', async () => {
    const id = await createViaRoute(testId('ftr3'), 'Fighter', 3);
    await SpellSlotDataAccess!.syncSpellSlotTotals(id, creationUserId);
    expect(await totals(id)).toEqual([]);
  });

  it('a mismatched subclass grants no slots (#420)', async () => {
    // setSubclass would refuse this pairing, so the row is written directly:
    // the slot code must not trust a bad pairing.
    const id = await createViaRoute(testId('ekX'), 'Rogue', 3);
    await db
      .insert(characterSubclasses)
      .values({ characterId: id, className: 'Rogue', subclassName: 'Eldritch Knight', chosenAtLevel: 3 });
    await SpellSlotDataAccess!.syncSpellSlotTotals(id, creationUserId);
    expect(await totals(id)).toEqual([]);
  });

  it('a first cast with no rows still grants EK slots via the subclass (#420)', async () => {
    const id = await grantThirdCasterRows('ekEnsure', 'Fighter', 'Eldritch Knight', 3);
    // Simulate a character whose rows are missing: ensureSpellSlotRow must
    // read the subclass from character_subclasses instead of refusing.
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, id));
    expect(await totals(id)).toEqual([]);
    const cast = await SpellSlotsService!.useSpellSlot(
      { characterId: id, spellName: 'Booming Blade', spellLevel: 1, slotLevelUsed: 1 },
      creationUserId,
    );
    expect(cast.success).toBe(true);
    expect(await totals(id)).toEqual([[1, 2, 1]]);
  });

  it('level-up re-syncs totals from the table and keeps spent slots', async () => {
    const id = await createViaRoute(testId('lvl'), 'Wizard', 1);
    const spent = await SpellSlotsService!.useSpellSlot(
      { characterId: id, spellName: 'Burning Hands', spellLevel: 1, slotLevelUsed: 1 },
      creationUserId,
    );
    expect(spent.success).toBe(true);

    await ProgressionService!.initializeProgression(id, creationUserId);
    const result = await LevelUpService!.levelUp({ characterId: id }, creationUserId);
    expect(result.newLevel).toBe(2);

    // Wizard 2 → 3× L1 from the progression table; the spent slot survives
    // the level-up instead of resetting.
    expect(await totals(id)).toEqual([[1, 3, 1]]);
  });
});
