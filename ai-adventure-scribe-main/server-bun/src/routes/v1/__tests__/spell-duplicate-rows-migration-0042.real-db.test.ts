/**
 * Real-DB test for #1803: migration 0042 removes the two retired duplicate
 * spell rows and their class_spells links, and leaves the canonical rows and
 * links intact.
 *
 * Retired: Tasha's Hideous Laughter (2f531b61…) and Tenser's Floating Disk
 * (ce62cea7…). Canonical: Hideous Laughter (49679c17…) and Floating Disk
 * (14bccb17…).
 *
 * The migration runs inside a transaction that is rolled back, so the shared
 * test database is left untouched: the deletes are asserted inside the
 * transaction, and the rows are asserted present again after the rollback.
 * Replay-order correctness (0042 runs after the 20261021 seed re-inserts the
 * rows) is covered by CI itself — scripts/test-migrations.sh pins 0042 last.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, it } from 'bun:test';
import { and, eq, inArray, sql, TransactionRollbackError } from 'drizzle-orm';

import { classes, classSpells, spells } from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  realDb,
} from '../../../services/__tests__/fixtures/real-db.ts';

const RETIRED_TASHAS_ID = '2f531b61-5626-5b7b-a9f9-bf935e580864';
const RETIRED_TENSERS_ID = 'ce62cea7-640b-5439-a175-10289409f59b';
const HIDEOUS_LAUGHTER_ID = '49679c17-4b59-5e1b-b9a2-8ed2f53f209e';
const FLOATING_DISK_ID = '14bccb17-1728-5095-ab6a-35b28812c6b7';

const RETIRED_IDS = [RETIRED_TASHAS_ID, RETIRED_TENSERS_ID];
const CANONICAL_IDS = [HIDEOUS_LAUGHTER_ID, FLOATING_DISK_ID];

// Seed values from db/migrations/20261021_seed_spell_catalog.sql.
const SPELL_ROWS = [
  {
    id: RETIRED_TASHAS_ID,
    name: "Tasha's Hideous Laughter",
    level: 1,
    school: 'Enchantment',
    castingTime: '1 action',
    rangeText: '30 feet',
    duration: 'Concentration, up to 1 minute',
    description:
      'A creature of your choice that you can see within range perceives everything as hilariously funny and falls into fits of laughter if this spell affects it.',
  },
  {
    id: RETIRED_TENSERS_ID,
    name: "Tenser's Floating Disk",
    level: 1,
    school: 'Conjuration',
    castingTime: '1 action',
    rangeText: '30 feet',
    duration: '1 hour',
    description:
      'This spell creates a circular, horizontal plane of force, 3 feet in diameter and 1 inch thick, that floats 3 feet above the ground in an unoccupied space of your choice that you can see within range.',
  },
  {
    id: HIDEOUS_LAUGHTER_ID,
    name: 'Hideous Laughter',
    level: 1,
    school: 'Enchantment',
    castingTime: '1 action',
    rangeText: '30 feet',
    duration: 'Up to 1 minute',
    description: `A creature of your choice that you can see within range perceives everything as hilariously funny and falls into fits of laughter if this spell affects it. The target must succeed on a wisdom saving throw or fall prone, becoming incapacitated and unable to stand up for the duration. A creature with an Intelligence score of 4 or less isn't affected.

At the end of each of its turns, and each time it takes damage, the target can make another wisdom saving throw. The target had advantage on the saving throw if it's triggered by damage. On a success, the spell ends.`,
  },
  {
    id: FLOATING_DISK_ID,
    name: 'Floating Disk',
    level: 1,
    school: 'Conjuration',
    castingTime: '1 action',
    rangeText: '30 feet',
    duration: '1 hour',
    description: `This spell creates a circular, horizontal plane of force, 3 feet in diameter and 1 inch thick, that floats 3 feet above the ground in an unoccupied space of your choice that you can see within range. The disk remains for the duration, and can hold up to 500 pounds. If more weight is placed on it, the spell ends, and everything on the disk falls to the ground.

The disk is immobile while you are within 20 feet of it. If you move more than 20 feet away from it, the disk follows you so that it remains within 20 feet of you. If can move across uneven terrain, up or down stairs, slopes and the like, but it can't cross an elevation change of 10 feet or more. For example, the disk can't move across a 10-foot-deep pit, nor could it leave such a pit if it was created at the bottom.

If you move more than 100 feet away from the disk (typically because it can't move around an obstacle to follow you), the spell ends.`,
  },
];

const TEST_CLASS_NAME = 'TestBard1803';

describeWithDb('migration 0042_remove_duplicate_spell_rows (#1803)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let testClassId = '';

  beforeAll(async () => {
    // Test class holding links to all four spell rows, so the link assertions
    // are scoped to rows this test owns.
    await db
      .insert(classes)
      .values({
        name: TEST_CLASS_NAME,
        hitDie: 8,
        spellcastingAbility: 'CHA',
        casterType: 'full',
      })
      .onConflictDoNothing();
    const [testClass] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(eq(classes.name, TEST_CLASS_NAME))
      .limit(1);
    // Fail loudly here (not as a cryptic TypeError below) if the class
    // insert did not land.
    expect(testClass).toBeDefined();
    testClassId = testClass.id;

    // Upsert the four spell rows (idempotent; the seed suite may already have
    // created them) and their links to the test class.
    await db.insert(spells).values(SPELL_ROWS).onConflictDoNothing();
    for (const s of SPELL_ROWS) {
      await db
        .insert(classSpells)
        .values({ classId: testClassId, spellId: s.id, spellLevel: s.level })
        .onConflictDoNothing();
    }
  });

  afterAll(async () => {
    if (testClassId) {
      await db.delete(classSpells).where(eq(classSpells.classId, testClassId));
      await db.delete(classes).where(eq(classes.id, testClassId));
    }
    // The spell rows stay: they are shared seed data, not test-owned rows.
    await closeRealDb();
  });

  it('deletes the retired rows + links and keeps the canonical rows + links', async () => {
    const migrationPath = fileURLToPath(
      new URL('../../../../../db/migrations/0042_remove_duplicate_spell_rows.sql', import.meta.url),
    );
    const migrationSql = await readFile(migrationPath, 'utf8');
    expect(migrationSql).toContain(RETIRED_TASHAS_ID);
    expect(migrationSql).toContain(RETIRED_TENSERS_ID);

    // tx.rollback() throws TransactionRollbackError, which this drizzle
    // version does not swallow: postgres.js rolls the transaction back on
    // the thrown error, and the error propagates out of db.transaction().
    // Catch it here and assert it is the rollback, not a real failure.
    let rollbackError: unknown;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(migrationSql));

        const remainingRetired = await tx
          .select({ id: spells.id })
          .from(spells)
          .where(inArray(spells.id, RETIRED_IDS));
        expect(remainingRetired).toHaveLength(0);

        const remainingRetiredLinks = await tx
          .select({ id: classSpells.id })
          .from(classSpells)
          .where(
            and(eq(classSpells.classId, testClassId), inArray(classSpells.spellId, RETIRED_IDS)),
          );
        expect(remainingRetiredLinks).toHaveLength(0);

        const remainingCanonical = await tx
          .select({ id: spells.id })
          .from(spells)
          .where(inArray(spells.id, CANONICAL_IDS));
        expect(remainingCanonical.map((r) => r.id).sort()).toEqual([...CANONICAL_IDS].sort());

        const remainingCanonicalLinks = await tx
          .select({ id: classSpells.id })
          .from(classSpells)
          .where(
            and(eq(classSpells.classId, testClassId), inArray(classSpells.spellId, CANONICAL_IDS)),
          );
        expect(remainingCanonicalLinks).toHaveLength(2);

        // Roll back: the shared database keeps the retired rows until Hetzner
        // applies the migration on Rob's typed line.
        tx.rollback();
      });
    } catch (e) {
      rollbackError = e;
    }
    expect(rollbackError).toBeInstanceOf(TransactionRollbackError);

    // The rollback left the shared rows untouched.
    const retiredAfter = await db
      .select({ id: spells.id })
      .from(spells)
      .where(inArray(spells.id, RETIRED_IDS));
    expect(retiredAfter.map((r) => r.id).sort()).toEqual([...RETIRED_IDS].sort());
    const retiredLinksAfter = await db
      .select({ id: classSpells.id })
      .from(classSpells)
      .where(and(eq(classSpells.classId, testClassId), inArray(classSpells.spellId, RETIRED_IDS)));
    expect(retiredLinksAfter).toHaveLength(2);
  });
});
