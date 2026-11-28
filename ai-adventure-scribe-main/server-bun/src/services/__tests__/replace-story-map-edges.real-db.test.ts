/**
 * #1752 follow-up: replace_story_map_edges (db/migrations/20261126_replace_story_map_edges.sql)
 * replaces one starter campaign's routes in one transaction. The ingest tool calls it through
 * the Supabase client; this suite calls the same function on the replayed schema.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import postgres from 'postgres';

import { describeWithDb, hasRealDb, realDbUrl, testId } from './fixtures/real-db.ts';

describeWithDb('#1752 replace_story_map_edges', () => {
  let sql: ReturnType<typeof postgres>;
  const starterId = testId('starter-edges');
  const edges = (rows: Array<[string, string, boolean?, string?]>) =>
    sql.json(
      rows.map(([from_key, to_key, hidden, label]) => ({
        from_key,
        to_key,
        hidden: hidden ?? false,
        label: label ?? null,
      })),
    );
  const stored = async () =>
    (
      await sql<Array<{ route: string }>>`
        SELECT from_key || '>' || to_key || CASE WHEN hidden THEN ' hidden' ELSE '' END AS route
        FROM story_map_edges WHERE campaign_id = ${starterId} ORDER BY 1`
    ).map((row) => row.route);

  beforeAll(async () => {
    sql = postgres(realDbUrl, { max: 1, connect_timeout: 10, onnotice: () => {} });
    await sql`INSERT INTO starter_campaigns (id, slug, title, genre, tone, difficulty, premise)
              VALUES (${starterId}, ${starterId}, 'Edges fixture', ${['horror']}, ${['grim']},
                      'medium', 'A fixture.')`;
  });

  afterAll(async () => {
    await sql`DELETE FROM starter_campaigns WHERE id = ${starterId}`;
    await sql.end({ timeout: 5 });
  });

  it('replaces the whole set and returns the number of rows written', async () => {
    const [first] = await sql`SELECT public.replace_story_map_edges(${starterId}, ${edges([
      ['a', 'b'],
      ['b', 'a'],
      ['b', 'c', true, 'secret stair'],
    ])}) AS n`;
    expect(first.n).toBe(3);
    expect(await stored()).toEqual(['a>b', 'b>a', 'b>c hidden']);

    const [second] = await sql`SELECT public.replace_story_map_edges(${starterId}, ${edges([
      ['a', 'c'],
    ])}) AS n`;
    expect(second.n).toBe(1);
    expect(await stored()).toEqual(['a>c']);
  });

  it('a failed insert rolls the delete back, so the old routes stay', async () => {
    const bad = sql.json([
      { from_key: 'a', to_key: 'b' },
      { from_key: null, to_key: 'c' },
    ]);
    await expect(sql`SELECT public.replace_story_map_edges(${starterId}, ${bad})`).rejects.toThrow(
      /null value/,
    );
    expect(await stored()).toEqual(['a>c']);
  });

  it('the public API role may not call it', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE anon`;
        await tx`SELECT public.replace_story_map_edges(${starterId}, '[]'::jsonb)`;
      }),
    ).rejects.toThrow(/permission denied/);
    expect(await stored()).toEqual(['a>c']);
  });
});

describe('#1752 replace_story_map_edges real-DB suite', () => {
  it('says out loud when it skipped', () => {
    if (!hasRealDb)
      console.warn('replace-story-map-edges.real-db.test.ts skipped: no TEST_DATABASE_URL');
    expect(true).toBe(true);
  });
});
