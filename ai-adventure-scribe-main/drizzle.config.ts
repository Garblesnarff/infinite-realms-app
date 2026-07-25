/**
 * Drizzle Kit configuration.
 *
 * Points drizzle-kit at the modular schema under db/schema/*.ts and the
 * migration history under db/migrations/ (plus its meta/ snapshots).
 *
 * The primary consumer is the schema-drift guard (scripts/check-schema-drift.sh,
 * run in CI): `drizzle-kit generate` diffs db/schema/*.ts against the newest
 * snapshot in db/migrations/meta/ and emits a migration if they disagree. A
 * non-empty emission means a schema.ts edit shipped without a migration --
 * exactly the class of bug that caused the 20260725 drift incident, where
 * combat_participant_status.exhaustion_level lived in schema.ts for months
 * with no migration and 500'd every combat start.
 *
 * `dbCredentials` is only consulted by commands that touch a live database
 * (push/pull/studio); generate/check are offline and work without DATABASE_URL.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/*.ts',
  out: './db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  // Keep generated SQL statement-per-breakpoint, matching the existing
  // migrations in db/migrations/ (see meta/_journal.json "breakpoints": true).
  breakpoints: true,
  verbose: false,
  strict: false,
});
