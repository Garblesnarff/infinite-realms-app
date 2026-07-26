/**
 * Real-Postgres test harness.
 *
 * Every unit test in this repo mocks `db`. That is exactly how the Drizzle
 * insert-select class survived for eleven weeks across 30 call sites: the failure
 * is a synchronous throw inside Drizzle's *statement builder*, so a mocked `db`
 * never executes the code that breaks, and a test asserting "insert was called"
 * passes against a write that could never have run. The same blind spot hid an
 * earlier bug for six rounds of fixes, because the `sql` mock returned plain
 * arrays where postgres.js returns a RowList (an Array subclass).
 *
 * So: the tests that matter here talk to a real database, or they do not run.
 *
 * Point TEST_DATABASE_URL (or DATABASE_URL) at a scratch Postgres carrying this
 * repo's schema and the suites light up. Provision one with:
 *
 *     createdb infinite_realms_test
 *     DATABASE_URL=postgres://localhost/infinite_realms_test \
 *       bunx drizzle-kit push --force
 *
 * Without one, `describeWithDb` degrades to `describe.skip` rather than failing,
 * so a developer or CI runner with no Postgres still gets a green, honest run --
 * and `hasRealDb` is exported so a suite can say out loud that it skipped.
 */
import { describe } from 'bun:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../../../../../db/schema/index';

export const realDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '';
export const hasRealDb = Boolean(realDbUrl);

/** `describe` that skips the whole block when no test database is configured. */
export const describeWithDb: typeof describe = hasRealDb ? describe : describe.skip;

let client: ReturnType<typeof postgres> | null = null;

export function realDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!hasRealDb) throw new Error('realDb() called without TEST_DATABASE_URL/DATABASE_URL');
  client ??= postgres(realDbUrl, { max: 2, connect_timeout: 10, onnotice: () => {} });
  return drizzle(client, { schema });
}

export async function closeRealDb(): Promise<void> {
  await client?.end({ timeout: 5 });
  client = null;
}

/** Unique-per-run id so parallel suites and repeat runs never collide. */
let counter = 0;
export function testId(prefix: string): string {
  counter += 1;
  return `${prefix}-${process.pid}-${counter}`;
}
