import { describe, expect, it } from 'bun:test';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../../../../../db/schema/index';

/**
 * Root-cause guard for the Drizzle insert-select class.
 *
 * `POST /v1/combat/sessions/:id/start` returned 500 on every call because Drizzle's
 * insert-select builder validates its projection against the target table and throws
 * synchronously:
 *
 *   Insert select error: selected fields are not the same or are in a different order
 *   compared to the table definition
 *
 * The projection listed four of `combat_encounters`' thirteen columns. The throw happened
 * before any query was issued, which is why the failure took 5-15ms and why it was invisible:
 * `logger.error({ error: e })` serialized the Error as `{}`.
 *
 * 33537a67 repaired that one call site by extending its projection to all thirteen columns.
 * A later sweep found the pattern at 34 call sites, 30 of them broken the same way, so it is
 * now banned outright (`no-restricted-syntax` in eslint.config.js) and every call site has
 * been converted to an authorization query plus `insert().values()`.
 *
 * This file no longer guards a live call site -- there are none left. It pins down the
 * behaviour that made the pattern indefensible, so the reasoning behind the ban stays
 * verifiable rather than folkloric: the validation is build-time, total, and order-sensitive,
 * which is exactly why a mismatch can only ever be discovered in production.
 */
const db = drizzle({} as never, { schema });

describe('why drizzle insert-select is banned', () => {
  const encounterColumns = Object.keys(getTableColumns(schema.combatEncounters));

  const buildStatement = (projection: Record<string, unknown>) =>
    db
      .insert(schema.combatEncounters)
      .select(
        db
          .select(projection as never)
          .from(schema.gameSessions)
          .where(eq(schema.gameSessions.id, 'session-1'))
          .limit(1),
      )
      .returning();

  const fullProjection = {
    id: sql`gen_random_uuid()`,
    sessionId: schema.gameSessions.id,
    status: sql`${'active'}`,
    currentRound: sql`1`,
    currentTurnOrder: sql`0`,
    version: sql`1`,
    location: sql`null::text`,
    difficulty: sql`null::text`,
    experienceAwarded: sql`null::integer`,
    startedAt: sql`now()`,
    endedAt: sql`null::timestamptz`,
    createdAt: sql`now()`,
    updatedAt: sql`now()`,
  };

  it('accepts only a projection covering every column in table order', () => {
    expect(Object.keys(fullProjection)).toEqual(encounterColumns);
    const { sql: statement } = buildStatement(fullProjection).toSQL();
    expect(statement).toStartWith('insert into "combat_encounters"');
  });

  it('rejects a partial projection -- the exact production failure', () => {
    expect(() =>
      buildStatement({
        sessionId: schema.gameSessions.id,
        status: sql`${'active'}`,
        currentRound: sql`1`,
        currentTurnOrder: sql`0`,
      }),
    ).toThrow(/selected fields are not the same or are in a different order/);
  });

  it('rejects a complete projection in the wrong order', () => {
    const reordered = Object.fromEntries(
      Object.entries(fullProjection).reverse(),
    ) as typeof fullProjection;
    expect(() => buildStatement(reordered)).toThrow(/different order/);
  });

  it('throws when the statement is built, before any database call', () => {
    // This is why nothing in CI caught it for eleven weeks: there is no query to
    // intercept and no database to assert against. A test that mocks `db` never
    // reaches this code path at all, and the throw is synchronous, so it happens
    // whether or not the caller ever awaits the statement.
    expect(() =>
      db
        .insert(schema.combatEncounters)
        .select(db.select({ id: schema.gameSessions.id }).from(schema.gameSessions)),
    ).toThrow(/Insert select error/);
  });

  it('has no remaining insert-select call sites in server-bun', async () => {
    // The ban lives in eslint.config.js and catches new occurrences at commit time.
    // This asserts the current state independently of whether eslint ran.
    const { Glob } = await import('bun');
    const root = new URL('../../../../', import.meta.url).pathname;
    const offenders: string[] = [];

    for await (const file of new Glob('**/*.ts').scan(root)) {
      if (file.includes('__tests__') || file.endsWith('.test.ts')) continue;
      const source = await Bun.file(`${root}${file}`).text();
      // A `.from(...)` earlier in the chain means the Supabase client, a different API.
      for (const match of source.matchAll(
        /(\.from\([^)]*\))?\s*\.insert\([^;]*?\)\s*\.select\(/gs,
      )) {
        if (!match[1]) offenders.push(`${file}: ${match[0].trim().slice(0, 60)}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
