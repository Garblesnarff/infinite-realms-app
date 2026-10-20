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
 * QA-041 symptom ("Spells 0 / No spells learned"): GET /v1/characters/:id/spells
 * reads the legacy columns. If the sync writes ALL leveled spells (the bug) or
 * nothing (if the sync fails), the sheet shows wrong counts. This test verifies
 * the sync writes exactly the prepared names.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characters,
  characterSpells,
  characterStats,
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

// HTTP-level test: stub auth so the routes see our test user.
let httpUserId = '';
mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer <redacted>'
      ? { user: { userId: httpUserId, email: 'spell-prep@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

if (hasRealDb) {
  process.env.PORT ??= '3100';
  process.env.CORS_ORIGIN ??= 'http://localhost:3100';
  process.env.WORKOS_API_KEY ??= 'test-dummy-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-dummy-client-id';
}

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../http-pipeline.js');
  const { charactersRoutes } = await import('../../routes/v1/characters.js');
  return createRequestPipelineApp().use(charactersRoutes);
});

const authHeaders = {
  authorization: 'Bearer <redacted>',
  'content-type': 'application/json',
};

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

  let characterId: string;
  let campaignId: string;
  let wizardClassId: string;
  let fireBoltId: string;
  let magicMissileId: string;
  let shieldId: string;
  let mageArmorId: string;
  // Tracked for afterAll cleanup (the HTTP test creates its character through
  // the route, which also writes a character_stats row).
  let httpCharacterId = '';

  beforeAll(async () => {
    // Seed a campaign and character. IDs are DB-generated UUIDs (the id columns
    // are uuid type; testId() strings are not valid UUIDs).
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: 'Spell Prep Test Campaign' })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        campaignId,
        name: 'Test Wizard',
        class: 'Wizard',
        level: 1,
      })
      .returning({ id: characters.id });

    // The scratch DB has schema but no seed data. Insert our own Wizard class
    // and test spells (1 cantrip + 3 level-1).
    [{ id: wizardClassId }] = await db
      .insert(classes)
      .values({ name: 'TestWizard211', hitDie: 6 })
      .returning({ id: classes.id });

    const spellDefs = [
      { name: 'Test Fire Bolt 211', level: 0, school: 'Evocation', castingTime: '1 action', rangeText: '120 feet', duration: 'Instantaneous', description: 'Test cantrip' },
      { name: 'Test Magic Missile 211', level: 1, school: 'Evocation', castingTime: '1 action', rangeText: '120 feet', duration: 'Instantaneous', description: 'Test spell' },
      { name: 'Test Shield 211', level: 1, school: 'Abjuration', castingTime: '1 reaction', rangeText: 'Self', duration: '1 round', description: 'Test spell' },
      { name: 'Test Mage Armor 211', level: 1, school: 'Abjuration', castingTime: '1 action', rangeText: 'Touch', duration: '8 hours', description: 'Test spell' },
    ];
    const spellIds: string[] = [];
    for (const def of spellDefs) {
      const [{ id }] = await db
        .insert(spells)
        .values(def)
        .returning({ id: spells.id });
      spellIds.push(id);
    }
    [fireBoltId, magicMissileId, shieldId, mageArmorId] = spellIds;

    // Link spells to the class (spell_level is required).
    const spellLevels: Array<[string, number]> = [
      [fireBoltId, 0],
      [magicMissileId, 1],
      [shieldId, 1],
      [mageArmorId, 1],
    ];
    for (const [spellId, spellLevel] of spellLevels) {
      await db
        .insert(classSpells)
        .values({ classId: wizardClassId, spellId, spellLevel })
        .onConflictDoNothing();
    }
  });

  afterAll(async () => {
    // Delete every row this suite created, in reverse dependency order, so a
    // re-run against the same scratch DB does not hit unique constraints.
    const characterIds = [characterId, httpCharacterId].filter(Boolean);
    if (characterIds.length > 0) {
      await db.delete(characterSpells).where(inArray(characterSpells.characterId, characterIds));
      await db.delete(characterStats).where(inArray(characterStats.characterId, characterIds));
      await db.delete(characters).where(inArray(characters.id, characterIds));
    }
    const spellIds = [fireBoltId, magicMissileId, shieldId, mageArmorId].filter(Boolean);
    if (spellIds.length > 0) {
      await db.delete(classSpells).where(inArray(classSpells.spellId, spellIds));
      await db.delete(spells).where(inArray(spells.id, spellIds));
    }
    if (wizardClassId) {
      await db.delete(classes).where(eq(classes.id, wizardClassId));
    }
    if (campaignId) {
      await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    }
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
      'TestWizard211',
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
    // Without the fix, this would contain all 3 leveled spell names.
    const preparedNames = (char.preparedSpells || '').split(',').filter(Boolean);
    expect(preparedNames).toHaveLength(2);
    expect(preparedNames).toContain('Test Magic Missile 211');
    expect(preparedNames).toContain('Test Shield 211');
    expect(preparedNames).not.toContain('Test Mage Armor 211');

    // knownSpells has all 3 leveled.
    const knownNames = (char.knownSpells || '').split(',').filter(Boolean);
    expect(knownNames).toHaveLength(3);

    // Cantrips column has the 1 cantrip.
    const cantripNames = (char.cantrips || '').split(',').filter(Boolean);
    expect(cantripNames).toHaveLength(1);
    expect(cantripNames).toContain('Test Fire Bolt 211');
  });

  it('wizard HTTP path: the 2 prepared spells survive create → save → sheet read (#211 QA-041)', async () => {
    // QA-041: the player prepares 2 spells in Advanced Spellcasting and completes
    // the wizard, but the sheet showed no prepared marker ("Spells 0"). The sheet's
    // GET /v1/characters/:id/spells builds is_prepared from the legacy
    // characters.preparedSpells column, so the user-visible prepared state lives
    // or dies by that column. This test walks the real user path:
    //   POST /v1/characters (wizard Complete, 2 prepared)
    //   → POST /v1/characters/:id/spells (spell save, would clobber without the fix)
    //   → GET /v1/characters/:id/spells (the sheet's read)
    // and asserts the sheet shows exactly the 2 prepared spells.
    httpUserId = userId;
    const app = await pipeline;
    expect(app).toBeTruthy();

    // 1. Wizard "Complete": the create payload carries the prepared selection.
    //    This write is authoritative for the legacy column.
    const createRes = await app.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'HTTP Test Wizard 211',
          class: 'Wizard',
          level: 1,
          campaign_id: campaignId,
          cantrips: 'Test Fire Bolt 211',
          known_spells: 'Test Magic Missile 211,Test Shield 211,Test Mage Armor 211',
          prepared_spells: 'Test Magic Missile 211,Test Shield 211',
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };
    httpCharacterId = created.id;
    expect(typeof httpCharacterId).toBe('string');

    // 2. The wizard's spell save. Without the fillEmptyOnly fix, this sync would
    //    overwrite preparedSpells with ALL 3 leveled names.
    const saveRes = await app.handle(
      new Request(`http://localhost/v1/characters/${httpCharacterId}/spells`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          spells: [fireBoltId, magicMissileId, shieldId, mageArmorId],
          className: 'TestWizard211',
          prepared: [magicMissileId, shieldId],
        }),
      }),
    );
    expect(saveRes.status).toBe(200);
    expect(((await saveRes.json()) as { success: boolean }).success).toBe(true);

    // 3. fillEmptyOnly proof: the legacy column still holds exactly the 2
    //    create-time names — the sync did not clobber a non-empty column.
    const [httpChar] = await db
      .select({ preparedSpells: characters.preparedSpells })
      .from(characters)
      .where(eq(characters.id, httpCharacterId));
    const legacyNames = (httpChar.preparedSpells || '').split(',').filter(Boolean);
    expect(legacyNames).toHaveLength(2);
    expect(legacyNames).toContain('Test Magic Missile 211');
    expect(legacyNames).toContain('Test Shield 211');
    expect(legacyNames).not.toContain('Test Mage Armor 211');

    // 4. The sheet's read: exactly the 2 prepared spells are marked prepared.
    const getRes = await app.handle(
      new Request(`http://localhost/v1/characters/${httpCharacterId}/spells`, {
        headers: authHeaders,
      }),
    );
    expect(getRes.status).toBe(200);
    const sheet = (await getRes.json()) as {
      spells: Array<{ name: string; is_prepared: boolean }>;
      cantrips: Array<{ name: string }>;
    };
    expect(sheet.spells).toHaveLength(3);
    const prepared = sheet.spells.filter((s) => s.is_prepared);
    expect(prepared).toHaveLength(2);
    expect(prepared.map((s) => s.name).sort()).toEqual([
      'Test Magic Missile 211',
      'Test Shield 211',
    ]);
    expect(
      sheet.spells.find((s) => s.name === 'Test Mage Armor 211')?.is_prepared,
    ).toBe(false);
    expect(sheet.cantrips).toHaveLength(1);
  });
});

describeWithDb('Life Domain domain spells (#899)', () => {
  // Lazily (re)created in beforeAll: the suite above closes the shared
  // fixture client in its afterAll, and realDb() recreates it on demand.
  let db: ReturnType<typeof realDb>;
  const userId = testId('life-domain-user');

  let campaignId: string;
  let clericClassId: string;
  let characterId = '';
  const spellIdsByName = new Map<string, string>();

  // The L1 Life Domain cleric from the audit (D20-003): WIS 16, so the
  // preparation cap is WIS mod (+3) + level (1) = 4 chosen spells. The
  // domain spells Bless and Cure Wounds are always prepared ON TOP of the
  // cap — the saved character carries 6 prepared spells, not 4.
  const CHOSEN = ['Guiding Bolt', 'Healing Word', 'Sanctuary', 'Shield of Faith'];
  const DOMAIN = ['Bless', 'Cure Wounds'];

  beforeAll(async () => {
    db = realDb();
    httpUserId = userId;
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: 'Life Domain Test Campaign' })
      .returning({ id: campaigns.id });

    // saveCharacterSpells resolves the class by the name the client sends.
    [{ id: clericClassId }] = await db
      .insert(classes)
      .values({ name: 'Cleric', hitDie: 8 })
      .returning({ id: classes.id });

    const spellDefs = [
      { name: 'Guidance', level: 0, school: 'Divination', castingTime: '1 action', rangeText: 'Touch', duration: 'Concentration, up to 1 minute', description: 'Test cantrip' },
      ...[...CHOSEN, ...DOMAIN].map((name) => ({
        name,
        level: 1,
        school: 'Abjuration',
        castingTime: '1 action',
        rangeText: '30 feet',
        duration: 'Instantaneous',
        description: 'Test spell',
      })),
    ];
    for (const def of spellDefs) {
      const [{ id }] = await db
        .insert(spells)
        .values(def)
        .returning({ id: spells.id });
      spellIdsByName.set(def.name, id);
      await db
        .insert(classSpells)
        .values({ classId: clericClassId, spellId: id, spellLevel: def.level })
        .onConflictDoNothing();
    }
  });

  afterAll(async () => {
    if (characterId) {
      await db.delete(characterSpells).where(eq(characterSpells.characterId, characterId));
      await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
      await db.delete(characters).where(eq(characters.id, characterId));
    }
    const ids = [...spellIdsByName.values()];
    if (ids.length > 0) {
      await db.delete(classSpells).where(inArray(classSpells.spellId, ids));
      await db.delete(spells).where(inArray(spells.id, ids));
    }
    if (clericClassId) {
      await db.delete(classes).where(eq(classes.id, clericClassId));
    }
    if (campaignId) {
      await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    }
  });

  it('persists chosen + domain spells as prepared: 6 prepared, none duplicated, cap untouched', async () => {
    const app = await pipeline;
    expect(app).toBeTruthy();

    // 1. Wizard "Complete": the create payload carries the prepared list the
    //    advanced-spellcasting step produced — 4 chosen + 2 domain names.
    const allPreparedNames = [...CHOSEN, ...DOMAIN];
    const createRes = await app.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'Life Cleric 899',
          class: 'Cleric',
          level: 1,
          campaign_id: campaignId,
          cantrips: 'Guidance',
          known_spells: allPreparedNames.join(','),
          prepared_spells: allPreparedNames.join(','),
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    characterId = ((await createRes.json()) as { id: string }).id;

    // 2. The wizard's spell save: the client sends every spell id with the
    //    prepared set — chosen and domain ids alike (the hook appends the
    //    domain ids to preparedSpellIds, deduped).
    const allIds = [...spellIdsByName.values()];
    const preparedIds = allPreparedNames.map((name) => {
      const id = spellIdsByName.get(name);
      if (!id) throw new Error(`spell not seeded: ${name}`);
      return id;
    });
    const saveRes = await app.handle(
      new Request(`http://localhost/v1/characters/${characterId}/spells`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ spells: allIds, className: 'Cleric', prepared: preparedIds }),
      }),
    );
    expect(saveRes.status).toBe(200);
    expect(((await saveRes.json()) as { success: boolean }).success).toBe(true);

    // 3. Junction rows: one row per spell (no duplicates), the 6 leveled
    //    spells prepared, the cantrip never prepared.
    const rows = await db
      .select({ spellId: characterSpells.spellId, isPrepared: characterSpells.isPrepared })
      .from(characterSpells)
      .where(eq(characterSpells.characterId, characterId));
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((r) => r.spellId)).size).toBe(7);
    const preparedRows = rows.filter((r) => r.isPrepared);
    expect(preparedRows).toHaveLength(6);
    expect(preparedRows.map((r) => r.spellId).sort()).toEqual([...preparedIds].sort());

    // 4. The sheet's read: exactly the 6 prepared spells come back prepared —
    //    the 4 chosen (the cap) plus both domain spells on top of it.
    const getRes = await app.handle(
      new Request(`http://localhost/v1/characters/${characterId}/spells`, {
        headers: authHeaders,
      }),
    );
    expect(getRes.status).toBe(200);
    const sheet = (await getRes.json()) as {
      spells: Array<{ name: string; is_prepared: boolean }>;
      cantrips: Array<{ name: string }>;
    };
    expect(sheet.spells).toHaveLength(6);
    const preparedNames = sheet.spells.filter((s) => s.is_prepared).map((s) => s.name);
    expect(new Set(preparedNames).size).toBe(6);
    expect(preparedNames.sort()).toEqual([...allPreparedNames].sort());
    expect(preparedNames.filter((n) => !DOMAIN.includes(n))).toHaveLength(4);
    expect(preparedNames.filter((n) => DOMAIN.includes(n)).sort()).toEqual([...DOMAIN].sort());
    expect(sheet.cantrips).toHaveLength(1);
  });
});
