/**
 * Proves that the writes converted away from Drizzle insert-select actually land.
 *
 * Every table below was silently unwritable in production. The insert-select
 * projections named a subset of each table's columns, Drizzle rejected the
 * statement while building it, and the exception surfaced as a 500 or, worse, as
 * a caught-and-shrugged-off failure. character_spells, experience_events and
 * character_features are the three called out by the 2026-07-25 schema-drift
 * audit: the audit fixed the missing tables, but the projections were a *second*
 * independent cause, so those writes were still failing afterwards.
 *
 * These tests run the real service methods against a real Postgres and then read
 * the row back. Asserting "insert was called" is what let the bug survive; the
 * assertion here is "the row is in the table".
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  characterEquipment,
  characterFeatures,
  characterSpells,
  characters,
  classFeaturesLibrary,
  classSpells,
  classes,
  experienceEvents,
  levelProgression,
  spells,
} from '../../../../db/schema/index';

if (!hasRealDb) {
  // Say it out loud. A silently-skipped suite reads exactly like a passing one.
  console.warn(
    '[insert-select-writes-land] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('converted insert-select writes actually land', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('user');

  let characterId: string;
  let classId: string;
  let spellId: string;
  let featureId: string;

  beforeAll(async () => {
    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, name: testId('char'), level: 1 })
      .returning({ id: characters.id });

    [{ id: classId }] = await db
      .insert(classes)
      .values({ name: testId('Wizard'), hitDie: 6 })
      .returning({ id: classes.id });

    [{ id: spellId }] = await db
      .insert(spells)
      .values({
        name: testId('Magic Missile'),
        level: 1,
        school: 'evocation',
        castingTime: '1 action',
        rangeText: '120 feet',
        duration: 'Instantaneous',
        description: 'Three darts of magical force.',
      })
      .returning({ id: spells.id });

    await db.insert(classSpells).values({ classId, spellId, spellLevel: 1 });

    [{ id: featureId }] = await db
      .insert(classFeaturesLibrary)
      .values({
        className: 'Wizard',
        featureName: testId('Arcane Recovery'),
        levelAcquired: 1,
        description: 'Recover expended spell slots on a short rest.',
        usesCount: 3,
      })
      .returning({ id: classFeaturesLibrary.id });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    // Best-effort and individually guarded: if beforeAll died partway through, some
    // of these ids are undefined, and one throw would otherwise abandon the rest of
    // the cleanup and leave rows behind for the next run to trip over.
    const drop = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch {
        /* fixture teardown is best-effort */
      }
    };

    if (characterId) {
      await drop(() =>
        db.delete(characterSpells).where(eq(characterSpells.characterId, characterId)),
      );
      await drop(() =>
        db.delete(characterFeatures).where(eq(characterFeatures.characterId, characterId)),
      );
      await drop(() =>
        db.delete(experienceEvents).where(eq(experienceEvents.characterId, characterId)),
      );
      await drop(() =>
        db.delete(levelProgression).where(eq(levelProgression.characterId, characterId)),
      );
    }
    if (classId) await drop(() => db.delete(classSpells).where(eq(classSpells.classId, classId)));
    if (featureId) {
      await drop(() =>
        db.delete(classFeaturesLibrary).where(eq(classFeaturesLibrary.id, featureId)),
      );
    }
    if (spellId) await drop(() => db.delete(spells).where(eq(spells.id, spellId)));
    if (classId) await drop(() => db.delete(classes).where(eq(classes.id, classId)));
    if (characterId) await drop(() => db.delete(characters).where(eq(characters.id, characterId)));
    await closeRealDb();
  });

  it('character_spells: a row lands', async () => {
    const { CharacterSpellService } = await import('../character/character-spell-service.js');
    const className = (
      await db.select({ name: classes.name }).from(classes).where(eq(classes.id, classId))
    )[0].name;

    await CharacterSpellService.saveCharacterSpells(characterId, userId, [spellId], className);

    const rows = await db
      .select()
      .from(characterSpells)
      .where(
        and(eq(characterSpells.characterId, characterId), eq(characterSpells.spellId, spellId)),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].sourceClassId).toBe(classId);
    expect(rows[0].isPrepared).toBe(true);
    // Columns the old projection omitted entirely, now supplied by table defaults.
    expect(rows[0].id).toBeTruthy();
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it('experience_events: a row lands when XP is awarded', async () => {
    const { ProgressionService } = await import('../progression-service.js');

    await ProgressionService.initializeProgression(characterId, userId);
    await ProgressionService.awardXP(characterId, 50, 'combat', userId, 'killed a goblin');

    const rows = await db
      .select()
      .from(experienceEvents)
      .where(eq(experienceEvents.characterId, characterId));

    expect(rows).toHaveLength(1);
    expect(rows[0].xpGained).toBe(50);
    expect(rows[0].source).toBe('combat');
    expect(rows[0].description).toBe('killed a goblin');
    expect(rows[0].id).toBeTruthy();
    expect(rows[0].timestamp).toBeInstanceOf(Date);
  });

  it('character_features: a row lands when a feature is granted', async () => {
    const { ClassFeaturesService } = await import('../class-features-service.js');

    const granted = await ClassFeaturesService.grantFeature({
      characterId,
      featureId,
      acquiredAtLevel: 1,
      userId,
    });

    expect(granted.id).toBeTruthy();

    const rows = await db
      .select()
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, featureId),
        ),
      );

    expect(rows).toHaveLength(1);
    // usesRemaining came from classFeaturesLibrary.usesCount in the old subquery;
    // the conversion has to keep reading it from there, not default it to null.
    expect(rows[0].usesRemaining).toBe(3);
    expect(rows[0].acquiredAtLevel).toBe(1);
    expect(rows[0].isActive).toBe(true);
  });

  it('character_features: granting the same feature twice conflicts rather than duplicating', async () => {
    const { ClassFeaturesService } = await import('../class-features-service.js');

    await expect(
      ClassFeaturesService.grantFeature({ characterId, featureId, acquiredAtLevel: 1, userId }),
    ).rejects.toThrow();

    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, featureId),
        ),
      );

    expect(rows[0].count).toBe(1);
  });

  it('rejects a write for a character the caller does not own', async () => {
    const { ClassFeaturesService } = await import('../class-features-service.js');

    // The authorization the insert-select used to carry in its WHERE clause has to
    // survive the conversion -- an unowned character must still be refused.
    await expect(
      ClassFeaturesService.grantFeature({
        characterId,
        featureId,
        acquiredAtLevel: 1,
        userId: testId('intruder'),
      }),
    ).rejects.toThrow();
  });
});

// Only authentication is faked: a `Bearer <SHEET_USER_PREFIX>...` token is that
// user, mirroring playthrough-scope.real-db.test.ts. Everything else — the real
// charactersRoutes, the real CharacterService.update, the real Postgres — runs.
const SHEET_USER_PREFIX = 'sheet-update-user-';
mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/, '');
    return token?.startsWith(SHEET_USER_PREFIX)
      ? { user: { userId: token, email: 'player@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));

describeWithDb('character-sheet updates persist through PUT /v1/characters/:id (#2701)', () => {
  // Fresh client per block: the block above closes the shared one in its
  // afterAll, and realDb() reconnects when the cached client is gone.
  let db: ReturnType<typeof realDb>;
  const userId = `${SHEET_USER_PREFIX}${testId('sheet')}`;
  let characterId: string;
  let app: { handle: (request: Request) => Promise<Response> };

  const putCharacter = async (body: unknown) => {
    const res = await app.handle(
      new Request(`http://localhost/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status };
  };

  const readRow = async () =>
    (await db.select().from(characters).where(eq(characters.id, characterId)))[0];

  beforeAll(async () => {
    db = realDb();
    const { charactersRoutes } = await importWithRealDb(
      () => import('../../routes/v1/characters.js'),
    );
    app = new Elysia().use(charactersRoutes);

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, name: testId('sheet-char'), level: 1 })
      .returning({ id: characters.id });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    try {
      if (characterId) await db.delete(characters).where(eq(characters.id, characterId));
    } catch {
      /* fixture teardown is best-effort */
    }
    await closeRealDb();
  });

  it('award XP persists experience_points', async () => {
    // The exact wire body the client sends for Award XP: buildSheetUpdatePayload
    // produces { experience_points: 100 }, userDataApi.updateCharacter runs it
    // through prepareCharacterPayload and PUTs it. Pinned by the client unit
    // test in src/hooks/__tests__/use-character-data.sheet-update.test.ts.
    const { status } = await putCharacter({ experience_points: 100 });
    expect(status).toBe(200);
    expect((await readRow()).experiencePoints).toBe(100);
  });

  it('adding a trait persists the personality envelope in personality_notes', async () => {
    // The exact wire body for "add trait": the trait arrays have no dedicated
    // columns, so the client serializes them as the JSON personality envelope
    // (serializePersonalityEnvelope) into personality_notes.
    const envelope = JSON.stringify({
      traits: ['Brave'],
      ideals: [],
      bonds: [],
      flaws: [],
      inspiration: false,
      lastInspiration: null,
      inspirationHistory: [],
    });
    const { status } = await putCharacter({ personality_notes: envelope });
    expect(status).toBe(200);
    const row = await readRow();
    expect(row.personalityNotes).toBe(envelope);
    expect(JSON.parse(row.personalityNotes!).traits).toEqual(['Brave']);
  });

  it('saving appearance persists appearance', async () => {
    const { status } = await putCharacter({ appearance: 'Tall, scarred, silver hair.' });
    expect(status).toBe(200);
    expect((await readRow()).appearance).toBe('Tall, scarred, silver hair.');
  });
});

// #2710: the wizard saves equipment, gold, and prepared spells.
// POSTs the exact bodies the wizard save sends through the real routes
// (via createRequestPipelineApp), then reads the DB. Equipment rows,
// gold, and exactly 2 prepared flags must be present.
describeWithDb('wizard completion saves equipment, gold, spells (#2710)', () => {
  let db: ReturnType<typeof realDb>;
  const userId = `${SHEET_USER_PREFIX}${testId('wizard')}`;
  const className = testId('Wizard2710');
  let characterId: string;
  let wizardClassId: string;
  let magicMissileUuid: string;
  let shieldUuid: string;
  let fireBoltUuid: string;
  let app: { handle: (request: Request) => Promise<Response> };

  const postJson = async (path: string, body: unknown) => {
    const res = await app.handle(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  beforeAll(async () => {
    db = realDb();
    const { createRequestPipelineApp } = await importWithRealDb(
      () => import('../../http-pipeline.js'),
    );
    const { charactersRoutes } = await importWithRealDb(
      () => import('../../routes/v1/characters.js'),
    );
    app = createRequestPipelineApp().use(charactersRoutes);

    // Setup: wizard class and spells in the DB
    [{ id: wizardClassId }] = await db
      .insert(classes)
      .values({ name: className, hitDie: 6 })
      .returning({ id: classes.id });

    const spellRows = await db
      .insert(spells)
      .values([
        {
          name: 'Magic Missile',
          level: 1,
          school: 'evocation',
          castingTime: '1 action',
          rangeText: '120 feet',
          duration: 'Instantaneous',
          description: 'Test.',
        },
        {
          name: 'Shield',
          level: 1,
          school: 'abjuration',
          castingTime: '1 reaction',
          rangeText: 'Self',
          duration: '1 round',
          description: 'Test.',
        },
        {
          name: 'Fire Bolt',
          level: 0,
          school: 'evocation',
          castingTime: '1 action',
          rangeText: '120 feet',
          duration: 'Instantaneous',
          description: 'Test.',
        },
      ])
      .returning({ id: spells.id, name: spells.name });
    magicMissileUuid = spellRows.find((s) => s.name === 'Magic Missile')!.id;
    shieldUuid = spellRows.find((s) => s.name === 'Shield')!.id;
    fireBoltUuid = spellRows.find((s) => s.name === 'Fire Bolt')!.id;

    await db.insert(classSpells).values([
      { classId: wizardClassId, spellId: magicMissileUuid, spellLevel: 1 },
      { classId: wizardClassId, spellId: shieldUuid, spellLevel: 1 },
      { classId: wizardClassId, spellId: fireBoltUuid, spellLevel: 0 },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    try {
      if (characterId) await db.delete(characters).where(eq(characters.id, characterId));
    } catch {
      /* best-effort */
    }
    await closeRealDb();
  });

  it('wizard completion persists equipment, gold, and 2 prepared spells', async () => {
    // The exact body use-character-save sends: transformCharacterForStorage
    // output plus the equipment rows from the mapped inventory.
    const createBody = {
      name: testId('Wizard'),
      class: className,
      level: 1,
      gold_pieces: 50,
      prepared_spells: 'Magic Missile,Shield',
      cantrips: 'Fire Bolt',
      known_spells: 'Magic Missile,Shield',
      equipment: [
        { item_name: 'Dagger', item_type: 'weapon', quantity: 1 },
        { item_name: 'Quarterstaff', item_type: 'weapon', quantity: 1 },
        { item_name: 'Holy Symbol', item_type: 'equipment', quantity: 1 },
      ],
    };
    const { status: createStatus, json: created } = await postJson(
      '/v1/characters',
      createBody,
    );
    expect(createStatus).toBe(201);
    characterId = (created as { id: string }).id;
    expect(characterId).toBeDefined();

    // The exact body saveSpells sends: database UUIDs + prepared set.
    const { status: spellsStatus } = await postJson(`/v1/characters/${characterId}/spells`, {
      spells: [magicMissileUuid, shieldUuid, fireBoltUuid],
      className,
      prepared: [magicMissileUuid, shieldUuid],
    });
    expect(spellsStatus).toBe(200);

    // Equipment rows
    const equipmentRows = await db
      .select()
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, characterId));
    expect(equipmentRows.map((r) => r.itemName).sort()).toEqual([
      'Dagger',
      'Holy Symbol',
      'Quarterstaff',
    ]);

    // Gold
    const [char] = await db
      .select({ goldPieces: characters.goldPieces })
      .from(characters)
      .where(eq(characters.id, characterId));
    expect(char.goldPieces).toBe(50);

    // Exactly 2 prepared, 1 not
    const spellRows = await db
      .select()
      .from(characterSpells)
      .where(eq(characterSpells.characterId, characterId));
    expect(spellRows.filter((r) => r.isPrepared)).toHaveLength(2);
    expect(spellRows.filter((r) => !r.isPrepared)).toHaveLength(1);
  });

  it('omitting prepared keeps all rows prepared (no regression)', async () => {
    // #2710: when the client omits `prepared`, the service must keep
    // today's behaviour (all true). Sorcerers/bards don't prepare.
    const createBody = {
      name: testId('Sorcerer'),
      class: className,
      level: 1,
      gold_pieces: 0,
    };
    const { status: createStatus, json: created } = await postJson(
      '/v1/characters',
      createBody,
    );
    expect(createStatus).toBe(201);
    const sorcererId = (created as { id: string }).id;

    // Omit `prepared` entirely.
    const { status: spellsStatus } = await postJson(
      `/v1/characters/${sorcererId}/spells`,
      {
        spells: [magicMissileUuid, fireBoltUuid],
        className,
      },
    );
    expect(spellsStatus).toBe(200);

    const spellRows = await db
      .select()
      .from(characterSpells)
      .where(eq(characterSpells.characterId, sorcererId));
    expect(spellRows.length).toBeGreaterThan(0);
    // All true — no regression from the prepared-set feature.
    expect(spellRows.every((r) => r.isPrepared)).toBe(true);

    // Cleanup
    await db.delete(characters).where(eq(characters.id, sorcererId));
  });
  });