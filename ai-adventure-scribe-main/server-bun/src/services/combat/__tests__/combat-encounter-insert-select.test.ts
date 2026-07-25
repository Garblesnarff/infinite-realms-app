import { describe, expect, it } from 'bun:test';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../../../../../db/schema/index';

/**
 * Root-cause guard.
 *
 * `POST /v1/combat/sessions/:id/start` returned 500 on every call because Drizzle's
 * insert-select builder validates its projection against the target table and throws
 * synchronously:
 *
 *   Insert select error: selected fields are not the same or are in a different order
 *   compared to the table definition
 *
 * The projection listed four of `combat_encounters`' thirteen columns. The throw happened
 * before any query was issued, which is why the failure took 5–15ms and why it was invisible:
 * `logger.error({ error: e })` serialized the Error as `{}`.
 *
 * This test builds the same statement and asserts the SQL, so adding a column to
 * `combat_encounters` without extending the projection fails here instead of in production.
 */
const db = drizzle({} as never, { schema });

describe('combat encounter atomic insert-select', () => {
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

  it('accepts a projection covering every column in table order', () => {
    expect(Object.keys(fullProjection)).toEqual(encounterColumns);
    const { sql: statement } = buildStatement(fullProjection).toSQL();
    expect(statement).toStartWith('insert into "combat_encounters"');
    expect(statement).toContain('select gen_random_uuid()');
  });

  it('rejects a partial projection — the exact production failure', () => {
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
});
