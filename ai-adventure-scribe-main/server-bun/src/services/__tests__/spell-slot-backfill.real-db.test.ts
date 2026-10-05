/**
 * #2598 backfill migration, against a real database.
 *
 * The migration file ships unapplied, so CI's migration replay only proves it
 * compiles. This suite proves the data mapping: it seeds characters through
 * the real `characters` insert with the legacy JSONB shapes production
 * carries (object form, double-encoded string form, malformed strings, an
 * overflowing integer), runs the migration file's SQL verbatim, and asserts
 * the rows that land in `character_spell_slots`.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Client } from 'pg';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  realDb,
  realDbUrl,
  testId,
} from './fixtures/real-db.js';
import { campaigns, characters, characterSpellSlots } from '../../../../db/schema/index';

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
// The route module's import graph reaches middleware/auth.ts, which reads
// validated env at import time, and services/workos.ts, which constructs its
// client at import time. None of these are exercised by this suite (no auth or
// HTTP paths run); the dummies only satisfy the import-time guards so the
// overlay can be imported in CI, where these vars are not set.
if (hasRealDb) {
  process.env.PORT ??= '3100';
  process.env.CORS_ORIGIN ??= 'http://localhost:3100';
  process.env.WORKOS_API_KEY ??= 'test-dummy-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-dummy-client-id';
}
const routeExports = hasRealDb ? await import('../../routes/v1/characters.js') : undefined;
const overlayEngineSpellSlots = routeExports?.overlayEngineSpellSlots;

if (!hasRealDb) {
  console.warn(
    '[spell-slot-backfill] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

const MIGRATION_SQL = hasRealDb
  ? readFileSync(
      new URL(
        '../../../../supabase/migrations/20261005_backfill_character_spell_slots_from_jsonb.sql',
        import.meta.url,
      ),
      'utf8',
    )
  : '';

/**
 * Run the migration file's SQL verbatim. node-postgres uses the simple query
 * protocol, so the file's multiple statements (helper function, INSERT, DROP)
 * execute in one call, the way a migration runner applies them.
 */
async function runBackfill(): Promise<void> {
  const client = new Client({ connectionString: realDbUrl });
  await client.connect();
  try {
    await client.query(MIGRATION_SQL);
  } finally {
    await client.end();
  }
}

describeWithDb('spell-slot backfill migration (#2598)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('backfill-user');

  let campaignId: string;
  let objectId: string;
  let encodedId: string;
  let existingId: string;
  let malformedStringId: string;
  let malformedTruncatedId: string;
  let overflowId: string;
  let neighborId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    const seed = async (name: string, spellSlots: unknown): Promise<string> => {
      const [row] = await db
        .insert(characters)
        .values({
          userId,
          campaignId,
          name,
          class: 'Wizard',
          level: 1,
          spellSlots: spellSlots as never,
        })
        .returning({ id: characters.id });
      return row.id;
    };

    // Object form: 2 slots, both spent.
    objectId = await seed('backfill-object', { '1': { max: 2, current: 0 } });
    // Double-encoded string form, levels 1-2.
    encodedId = await seed(
      'backfill-encoded',
      '{"1":{"max":4,"current":1},"2":{"max":2,"current":2}}',
    );
    // An engine row already exists: the backfill must not overwrite it, even
    // though the JSONB disagrees (used 1 vs max - current = 2).
    existingId = await seed('backfill-existing', { '1': { max: 4, current: 2 } });
    await db
      .insert(characterSpellSlots)
      .values({ characterId: existingId, spellLevel: 1, totalSlots: 4, usedSlots: 1 });
    // Malformed seeds: JSON strings whose content is not parseable JSON, and
    // an integer that overflows the int cast. Each must yield no rows and no
    // error.
    malformedStringId = await seed('backfill-malformed-string', '{oops');
    malformedTruncatedId = await seed('backfill-malformed-truncated', '{"1":{"max":2');
    overflowId = await seed('backfill-overflow', { '1': { max: 99999999999, current: 0 } });
    // A good row beside the malformed ones: the malformed values must not
    // abort the statement.
    neighborId = await seed('backfill-neighbor', { '1': { max: 3, current: 3 } });

    await runBackfill();
  });

  afterAll(async () => {
    await closeRealDb();
  });

  async function slotRows(characterId: string) {
    return db
      .select()
      .from(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, characterId));
  }

  it('maps the object JSONB form to table rows', async () => {
    const rows = await slotRows(objectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spellLevel).toBe(1);
    expect(rows[0]!.totalSlots).toBe(2);
    // used = max - current = 2 - 0: the spent state survives the backfill.
    expect(rows[0]!.usedSlots).toBe(2);
  });

  it('maps the double-encoded string form, every level present', async () => {
    const rows = await slotRows(encodedId);
    expect(rows).toHaveLength(2);
    const byLevel = new Map(rows.map((r) => [r.spellLevel, r]));
    expect([byLevel.get(1)!.totalSlots, byLevel.get(1)!.usedSlots]).toEqual([4, 3]);
    expect([byLevel.get(2)!.totalSlots, byLevel.get(2)!.usedSlots]).toEqual([2, 0]);
  });

  it('leaves an existing engine row untouched', async () => {
    const rows = await slotRows(existingId);
    expect(rows).toHaveLength(1);
    // ON CONFLICT DO NOTHING: the engine's used=1 stands, not the JSONB's
    // max - current = 2.
    expect(rows[0]!.usedSlots).toBe(1);
    expect(rows[0]!.totalSlots).toBe(4);
  });

  it('skips malformed values without aborting the backfill', async () => {
    for (const id of [malformedStringId, malformedTruncatedId, overflowId]) {
      expect(await slotRows(id)).toHaveLength(0);
    }
    // The good neighbor beside the malformed rows was still inserted.
    const rows = await slotRows(neighborId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalSlots).toBe(3);
    expect(rows[0]!.usedSlots).toBe(0);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const before = await db.select({ id: characterSpellSlots.id }).from(characterSpellSlots);
    await runBackfill();
    const after = await db.select({ id: characterSpellSlots.id }).from(characterSpellSlots);
    expect(after).toHaveLength(before.length);
  });

  it('reads back through the engine and the sheet overlay', async () => {
    const state = await SpellSlotsService!.getCharacterSpellSlots(objectId, userId);
    expect(state.slots).toHaveLength(1);
    expect(state.slots[0]!.totalSlots).toBe(2);
    expect(state.slots[0]!.usedSlots).toBe(2);

    const overlaid = (await overlayEngineSpellSlots!({ id: objectId }, objectId, userId)) as Record<
      string,
      unknown
    > | null;
    // The sheet sees max 2 / current 0: the backfilled spent state.
    expect(overlaid?.spell_slots).toEqual({ '1': { max: 2, current: 0 } });
  });
});
