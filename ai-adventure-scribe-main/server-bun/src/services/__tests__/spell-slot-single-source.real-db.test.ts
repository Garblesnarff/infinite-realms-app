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

import { closeRealDb, describeWithDb, hasRealDb, realDb, testId } from './fixtures/real-db.js';
import { campaigns, characters } from '../../../../db/schema/index';
import { premadeWizardSpellSlotsWireValue } from '../../../../shared/test-fixtures/premade-wizard-spell-slots';

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
const routeExports = hasRealDb ? await import('../../routes/v1/characters.js') : undefined;
const { BusinessLogicError } = hasRealDb
  ? await import('../../lib/errors.js')
  : { BusinessLogicError: Error as unknown as new (...args: never[]) => Error };

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
    const mapped = routes.mapCharacterToApi(
      row as Parameters<typeof routes.mapCharacterToApi>[0],
    );
    const overlaid = await routes.overlayEngineSpellSlots(mapped, wizardId, userId);
    expect(overlaid?.spell_slots).toEqual({ '1': { max: 2, current: 1 } });
  });

  it('a non-caster with no slot rows gets a refusal that names the cause', async () => {
    const error = await SpellSlotsService!.useSpellSlot(
      {
        characterId: fighterId,
        spellName: 'Burning Hands',
        spellLevel: 1,
        slotLevelUsed: 1,
      },
      userId,
    ).catch((cause: unknown) => cause);

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
