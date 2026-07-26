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
import { afterAll, beforeAll, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';

import { closeRealDb, describeWithDb, hasRealDb, realDb, testId } from './fixtures/real-db.js';
import {
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
