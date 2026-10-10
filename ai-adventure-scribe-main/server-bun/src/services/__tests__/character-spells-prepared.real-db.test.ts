/**
 * #211 QA-041: the wizard saves prepared spells, against a real database.
 *
 * Hark's retest showed a prepared caster with "Spells 0" after Complete.
 * The save path (POST /v1/characters/:id/spells → saveCharacterSpells)
 * writes to the character_spells table with is_prepared flags, then syncs
 * the legacy characters.preparedSpells column. The old sync copied ALL
 * leveled spells into preparedSpells instead of just the prepared ones.
 *
 * This suite proves: save 2 prepared + 1 unprepared leveled + 1 cantrip,
 * then read back the character_spells rows (is_prepared flags correct,
 * cantrip never prepared) and the legacy columns (preparedSpells has
 * only the 2 prepared names).
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, mock } from 'bun:test';
import { eq, and } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characters,
  characterSpells,
  classes,
  spells,
  classSpells,
} from '../../../../db/schema/index';

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

if (hasRealDb) {
  process.env.PORT ??= '3100';
  process.env.CORS_ORIGIN ??= 'http://localhost:3100';
  process.env.WORKOS_API_KEY ??= 'test-dummy-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-dummy-client-id';
}

const { CharacterSpellService } = hasRealDb
  ? await import('../character/character-spell-service.js')
  : ({} as never);

if (!hasRealDb) {
  console.warn(
    '[character-spells-prepared] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('character spell prepared flags (#211 QA-041)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('spell-prep-user');
  const characterId = testId('spell-prep-char');
  const campaignId = testId('spell-prep-camp');

  let wizardClassId: string;
  let fireBoltId: string;
  let magicMissileId: string;
  let shieldId: string;
  let mageArmorId: string;

  beforeAll(async () => {
    // Seed a campaign and character.
    await db.insert(campaigns).values({
      id: campaignId,
      userId,
      name: 'Spell Prep Test Campaign',
    });
    await db.insert(characters).values({
      id: characterId,
      userId,
      ownerId: userId,
      campaignId,
      name: 'Test Wizard',
      class: 'Wizard',
      level: 1,
    });

    // Get the Wizard class id.
    const [wizard] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(eq(classes.name, 'Wizard'))
      .limit(1);
    if (!wizard) throw new Error('Wizard class not found in test DB');
    wizardClassId = wizard.id;

    // Get spell IDs: 1 cantrip + 3 leveled.
    const spellRows = await db
      .select({ id: spells.id, name: spells.name, level: spells.level })
      .from(spells)
      .where(eq(spells.name, 'Fire Bolt'))
      .limit(1);
    // Fallback: use any cantrip and leveled spells if Fire Bolt not found.
    const [cantrip] = spellRows.length
      ? spellRows
      : await db.select({ id: spells.id }).from(spells).where(eq(spells.level, 0)).limit(1);
    fireBoltId = cantrip.id;

    const leveled = await db
      .select({ id: spells.id })
      .from(spells)
      .where(eq(spells.level, 1))
      .limit(3);
    if (leveled.length < 3) throw new Error('Not enough level-1 spells in test DB');
    [magicMissileId, shieldId, mageArmorId] = leveled.map((s) => s.id);

    // Ensure class_spells rows exist for these spells.
    for (const spellId of [fireBoltId, magicMissileId, shieldId, mageArmorId]) {
      await db
        .insert(classSpells)
        .values({ classId: wizardClassId, spellId })
        .onConflictDoNothing();
    }
  });

  afterAll(async () => {
    await closeRealDb();
  });

  it('saves prepared flags correctly and syncs legacy columns', async () => {
    // Save: 1 cantrip + 3 leveled, with 2 of the leveled prepared.
    const allSpellIds = [fireBoltId, magicMissileId, shieldId, mageArmorId];
    const preparedIds = [magicMissileId, shieldId];

    const result = await CharacterSpellService.saveCharacterSpells(
      characterId,
      userId,
      allSpellIds,
      'Wizard',
      preparedIds,
    );
    expect(result.success).toBe(true);

    // Read back the character_spells rows.
    const rows = await db
      .select({
        spellId: characterSpells.spellId,
        isPrepared: characterSpells.isPrepared,
      })
      .from(characterSpells)
      .where(eq(characterSpells.characterId, characterId));

    expect(rows).toHaveLength(4);

    const byId = new Map(rows.map((r) => [r.spellId, r.isPrepared]));
    // Cantrip never prepared (#243 rule).
    expect(byId.get(fireBoltId)).toBe(false);
    // The 2 prepared spells.
    expect(byId.get(magicMissileId)).toBe(true);
    expect(byId.get(shieldId)).toBe(true);
    // The unprepared leveled spell.
    expect(byId.get(mageArmorId)).toBe(false);

    // Read back the legacy columns (what GET /v1/characters/:id/spells reads).
    const [char] = await db
      .select({
        preparedSpells: characters.preparedSpells,
        knownSpells: characters.knownSpells,
        cantrips: characters.cantrips,
      })
      .from(characters)
      .where(eq(characters.id, characterId));

    // preparedSpells legacy column has ONLY the 2 prepared names (#211 fix).
    const preparedNames = (char.preparedSpells || '').split(',').filter(Boolean);
    expect(preparedNames).toHaveLength(2);

    // knownSpells has all 3 leveled.
    const knownNames = (char.knownSpells || '').split(',').filter(Boolean);
    expect(knownNames).toHaveLength(3);

    // Cantrips column has the 1 cantrip.
    const cantripNames = (char.cantrips || '').split(',').filter(Boolean);
    expect(cantripNames).toHaveLength(1);
  });
});
