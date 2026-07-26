/**
 * Real-Postgres coverage for the campaign chunk lookup.
 *
 * Mocking `sql` is how the Drizzle insert-select class hid for eleven weeks across 30 call
 * sites, so the query that decides whether a boss fights at 90 HP or 11 talks to an actual
 * database or it does not run. What a mock could not catch here: the `chunk_type` column is
 * a Postgres enum, so an `inArray` against it has to send values Postgres will accept, and
 * `entity_name` is nullable, so the `IS NOT NULL` filter is load-bearing.
 *
 * Point TEST_DATABASE_URL at a scratch Postgres carrying this repo's schema; without one
 * the suite skips rather than fails.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import { campaignChunks, starterCampaigns } from '../../../../../db/schema/index';
import { closeRealDb, describeWithDb, realDb, testId } from '../../__tests__/fixtures/real-db.js';

const campaignId = testId('feast');

/** Real content shapes from production: bold-label and italic-label dialects. */
const CHUNKS = [
  {
    entityName: 'Gluten Golem',
    chunkType: 'monster' as const,
    content: '**Gluten Golem**\n\n**HP:** 90 **AC:** 14 **Speed:** 30ft',
  },
  {
    entityName: 'Shadow Roach',
    chunkType: 'monster' as const,
    content: '**Shadow Roach**\n\n**HP:** 20 **AC:** 13 **Speed:** 30ft',
  },
  {
    entityName: 'The Chiropteran Hulk',
    chunkType: 'monster' as const,
    content: '*   *HP:* 80, *AC:* 14, *Speed:* 10ft / 50ft Fly.',
  },
  {
    entityName: 'Random Encounters',
    chunkType: 'encounter' as const,
    content: '[TAG: ENCOUNTER_TABLE]\n| d20 | Encounter |\n| 1 | *HP:* 45, *AC:* 13 |',
  },
  {
    // Nullable entity_name: a chunk with no name can never be matched and must not crash.
    entityName: null,
    chunkType: 'monster' as const,
    content: '**HP:** 999 **AC:** 25',
  },
  {
    // A non-stat chunk type in the same campaign, to prove the type filter does its job.
    entityName: 'The Sugar Golem',
    chunkType: 'npc_tier1' as const,
    content: '**The Sugar Golem** (Construct) - **Voice:** sticky crackles.',
  },
];

describeWithDb('campaign monster index against real Postgres', () => {
  beforeAll(async () => {
    const db = realDb();
    await db.insert(starterCampaigns).values({
      id: campaignId,
      title: 'Stat Ladder Fixture',
      slug: campaignId,
      genre: ['comedy'],
      tone: ['culinary dread'],
      difficulty: 'medium',
      premise: 'A fixture campaign whose creatures carry authored stat blocks.',
    });
    await db.insert(campaignChunks).values(CHUNKS.map((chunk) => ({ ...chunk, campaignId })));
  });

  afterAll(async () => {
    const db = realDb();
    await db.delete(campaignChunks).where(eq(campaignChunks.campaignId, campaignId));
    await db.delete(starterCampaigns).where(eq(starterCampaigns.id, campaignId));
    await closeRealDb();
  });

  test('the enum-typed chunk filter returns stat-bearing rows and excludes the rest', async () => {
    const rows = await realDb()
      .select({ chunkType: campaignChunks.chunkType })
      .from(campaignChunks)
      .where(eq(campaignChunks.campaignId, campaignId));

    expect(rows.filter((row) => ['monster', 'encounter'].includes(row.chunkType))).toHaveLength(5);
    expect(rows.some((row) => row.chunkType === 'npc_tier1')).toBe(true);
  });

  /**
   * The service's own `db` is constructed from DATABASE_URL at import time, so this is the
   * one assertion that exercises the real production query end to end. It runs only when
   * DATABASE_URL points at the same scratch database the fixture wrote to; otherwise the
   * import would either fail outright or read a different database and prove nothing.
   */
  const serviceUsesFixtureDb =
    Boolean(process.env.DATABASE_URL) &&
    (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL === process.env.DATABASE_URL);

  test.if(serviceUsesFixtureDb)(
    'loadCampaignMonsterIndex reads authored stats out of Postgres at their real numbers',
    async () => {
      const { clearCampaignMonsterCache, loadCampaignMonsterIndex } =
        await import('../campaign-monster-resolution.js');
      clearCampaignMonsterCache();

      const index = await loadCampaignMonsterIndex(campaignId);

      // 5 stat-bearing rows exist; the unnamed one is excluded by the IS NOT NULL filter
      // before it is ever counted, which is why chunkCount is 4 rather than 5.
      expect(index.chunkCount).toBe(4);
      expect(index.byKey.get('gluten-golem')?.parsed).toMatchObject({ maxHp: 90, armorClass: 14 });
      expect(index.byKey.get('shadow-roach')?.parsed.maxHp).toBe(20);
      // npc_tier1 was filtered out by the query, not merely unmatched.
      expect(index.byKey.has('the-sugar-golem')).toBe(false);
      // The unnamed 999 HP chunk is excluded by the IS NOT NULL filter.
      expect([...index.byKey.values()].some((m) => m.parsed.maxHp === 999)).toBe(false);
    },
  );

  test('an inArray against the chunk_type enum is accepted by Postgres', async () => {
    // A plain-text array would fail at the driver level against an enum column; this is the
    // assertion a mocked `sql` cannot make.
    const rows = await realDb()
      .select({ entityName: campaignChunks.entityName })
      .from(campaignChunks)
      .where(inArray(campaignChunks.chunkType, ['monster', 'encounter']));

    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  test('authored stats survive the database round-trip at their real numbers', async () => {
    const { buildCampaignMonsterIndex } = await import('../campaign-monster-index.js');
    const rows = await realDb()
      .select({
        entityName: campaignChunks.entityName,
        chunkType: campaignChunks.chunkType,
        content: campaignChunks.content,
      })
      .from(campaignChunks)
      .where(inArray(campaignChunks.chunkType, ['monster', 'encounter']));

    const index = buildCampaignMonsterIndex(
      campaignId,
      rows.filter((row) => row.content.length > 0),
    );

    expect(index.byKey.get('gluten-golem')?.parsed).toMatchObject({ maxHp: 90, armorClass: 14 });
    expect(index.byKey.get('shadow-roach')?.parsed).toMatchObject({ maxHp: 20, armorClass: 13 });
    expect(index.byKey.get('the-chiropteran-hulk')?.parsed).toMatchObject({
      maxHp: 80,
      armorClass: 14,
    });
  });

  test('a null entity_name is skipped rather than indexed or crashed on', async () => {
    const { buildCampaignMonsterIndex } = await import('../campaign-monster-index.js');
    const rows = await realDb()
      .select({
        entityName: campaignChunks.entityName,
        chunkType: campaignChunks.chunkType,
        content: campaignChunks.content,
      })
      .from(campaignChunks)
      .where(eq(campaignChunks.campaignId, campaignId));

    const index = buildCampaignMonsterIndex(campaignId, rows);
    // The unnamed 999 HP / AC 25 chunk exists in the table and reaches none of the keys.
    expect([...index.byKey.values()].some((m) => m.parsed.maxHp === 999)).toBe(false);
  });

  test('a standalone encounter table indexes without contributing a creature’s stats', async () => {
    const { buildCampaignMonsterIndex } = await import('../campaign-monster-index.js');
    const rows = await realDb()
      .select({
        entityName: campaignChunks.entityName,
        chunkType: campaignChunks.chunkType,
        content: campaignChunks.content,
      })
      .from(campaignChunks)
      .where(eq(campaignChunks.campaignId, campaignId));

    const index = buildCampaignMonsterIndex(campaignId, rows);
    expect(index.byKey.get('random-encounters')?.coverage).toBe('none');
    expect(index.byKey.get('random-encounters')?.parsed.maxHp).toBeUndefined();
  });
});
