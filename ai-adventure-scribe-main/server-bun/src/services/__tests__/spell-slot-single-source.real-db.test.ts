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
import { campaigns, characters, characterSpellSlots } from '../../../../db/schema/index';
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

  it('a warlock gets no rows: pact magic is a separate pool the rows do not track', async () => {
    const id = await createViaRoute(testId('wlk'), 'Warlock', 1);
    expect(await totals(id)).toEqual([]);
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
