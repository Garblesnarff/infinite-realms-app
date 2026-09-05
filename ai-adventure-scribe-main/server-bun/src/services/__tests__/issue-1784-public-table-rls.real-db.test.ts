/**
 * Issue #1784: verify the database boundary for every table that previously granted public
 * anon-key access. The test applies the migration in a transaction, inserts owner and foreign
 * fixtures, probes as the anon role, then verifies the owner rows as authenticated. The
 * transaction is always rolled back, so the dedicated database is never left with fixtures.
 */
import { fileURLToPath } from 'node:url';

import { afterAll, expect, test } from 'bun:test';
import postgres from 'postgres';

import { describeWithDb, hasRealDb, realDbUrl } from './fixtures/real-db.js';

const DEDICATED_REAL_DB_HOST = '127.0.0.1';
const DEDICATED_REAL_DB_PORT = '55432';
const MIGRATION_PATH = '../../../../db/migrations/20260903_lockdown_issue_1784_public_tables.sql';
const TABLES = [
  'safety_audit_trail',
  'character_equipment',
  'character_creation_metrics',
  'character_voice_mappings',
  'character_voice_profiles',
  'session_config',
] as const;

/** Refuse fixture writes against anything except the dedicated local Postgres. */
export function assertSafeIssue1784Database(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[issue-1784] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
    );
  }

  const isPostgres = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  if (
    !isPostgres ||
    parsed.hostname !== DEDICATED_REAL_DB_HOST ||
    parsed.port !== DEDICATED_REAL_DB_PORT
  ) {
    const target = parsed.hostname ? `${parsed.hostname}:${parsed.port || '(default)'}` : 'unknown';
    throw new Error(
      `[issue-1784] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

if (hasRealDb) assertSafeIssue1784Database(realDbUrl);

const migrationPath = fileURLToPath(new URL(MIGRATION_PATH, import.meta.url));
const database = hasRealDb
  ? postgres(realDbUrl, { max: 1, connect_timeout: 10, onnotice: () => {} })
  : null;

if (!hasRealDb) {
  console.warn(
    '[issue-1784] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run this real-DB proof.',
  );
}

class RollbackAfterAssertions extends Error {}

test('refuses a non-dedicated database target before opening a connection', () => {
  expect(() => assertSafeIssue1784Database('postgres://prod.example.test:5432/postgres')).toThrow(
    'refusing real-DB fixtures',
  );
});

test('accepts the dedicated CI database target', () => {
  expect(() =>
    assertSafeIssue1784Database('postgres://postgres:postgres@127.0.0.1:55432/postgres'),
  ).not.toThrow();
});

describeWithDb('issue #1784 public table RLS', () => {
  test('denies anon reads while preserving owner reads on all six tables', async () => {
    if (!database) throw new Error('real database is not configured');

    try {
      await database.begin(async (tx) => {
        await tx.file(migrationPath);

        const ownerId = '00000000-0000-0000-0000-000000000178';
        const foreignOwnerId = '00000000-0000-0000-0000-000000000179';
        const ownerCampaignId = '00000000-0000-0000-0000-000000001784';
        const foreignCampaignId = '00000000-0000-0000-0000-000000001785';
        const ownerCharacterId = '00000000-0000-0000-0000-000000017840';
        const foreignCharacterId = '00000000-0000-0000-0000-000000017841';
        const ownerSessionId = '00000000-0000-0000-0000-000001784000';
        const foreignSessionId = '00000000-0000-0000-0000-000001784001';

        await tx`
          INSERT INTO public.campaigns (id, user_id, name)
          VALUES
            (${ownerCampaignId}, ${ownerId}, 'Issue 1784 owner campaign'),
            (${foreignCampaignId}, ${foreignOwnerId}, 'Issue 1784 foreign campaign')
        `;
        await tx`
          INSERT INTO public.characters (id, user_id, owner_id, campaign_id, name)
          VALUES
            (${ownerCharacterId}, ${ownerId}, ${ownerId}, ${ownerCampaignId}, 'Issue 1784 owner character'),
            (${foreignCharacterId}, ${foreignOwnerId}, ${foreignOwnerId}, ${foreignCampaignId}, 'Issue 1784 foreign character')
        `;
        await tx`
          INSERT INTO public.game_sessions (id, campaign_id, character_id, status)
          VALUES
            (${ownerSessionId}, ${ownerCampaignId}, ${ownerCharacterId}, 'active'),
            (${foreignSessionId}, ${foreignCampaignId}, ${foreignCharacterId}, 'active')
        `;

        await tx`
          INSERT INTO public.safety_audit_trail (id, session_id, user_id, action_type)
          VALUES
            ('00000000-0000-0000-0000-000001784010', ${ownerSessionId}, ${ownerId}, 'pause'),
            ('00000000-0000-0000-0000-000001784011', ${foreignSessionId}, ${foreignOwnerId}, 'pause')
        `;
        await tx`
          INSERT INTO public.character_equipment (id, character_id, item_name)
          VALUES
            ('00000000-0000-0000-0000-000001784020', ${ownerCharacterId}, 'Issue 1784 owner item'),
            ('00000000-0000-0000-0000-000001784021', ${foreignCharacterId}, 'Issue 1784 foreign item')
        `;
        await tx`
          INSERT INTO public.character_creation_metrics (id, character_id, user_id, creation_method)
          VALUES
            ('00000000-0000-0000-0000-000001784030', ${ownerCharacterId}, ${ownerId}, 'issue-1784-owner'),
            ('00000000-0000-0000-0000-000001784031', ${foreignCharacterId}, ${foreignOwnerId}, 'issue-1784-foreign')
        `;
        await tx`
          INSERT INTO public.character_voice_mappings (id, session_id, character_name, voice_id)
          VALUES
            ('00000000-0000-0000-0000-000001784040', ${ownerSessionId}, 'Issue 1784 owner', 'owner-voice'),
            ('00000000-0000-0000-0000-000001784041', ${foreignSessionId}, 'Issue 1784 foreign', 'foreign-voice')
        `;
        await tx`
          INSERT INTO public.character_voice_profiles (id, character_id, voice_style)
          VALUES
            ('00000000-0000-0000-0000-000001784050', ${ownerCharacterId}, 'owner-style'),
            ('00000000-0000-0000-0000-000001784051', ${foreignCharacterId}, 'foreign-style')
        `;
        await tx`
          INSERT INTO public.session_config (id, session_id, config_key, config_value)
          VALUES
            ('00000000-0000-0000-0000-000001784060', ${ownerSessionId}, 'issue-1784-owner', '{}'::jsonb),
            ('00000000-0000-0000-0000-000001784061', ${foreignSessionId}, 'issue-1784-foreign', '{}'::jsonb)
        `;

        await tx`SELECT set_config(
          'request.jwt.claims',
          ${JSON.stringify({ role: 'authenticated', sub: ownerId })},
          true
        )`;

        await tx`SET LOCAL ROLE anon`;
        for (const [index, table] of TABLES.entries()) {
          const savepoint = `issue_1784_anon_${index}`;
          await tx`SAVEPOINT ${tx(savepoint)}`;
          let deniedError: unknown;
          try {
            await tx`SELECT id FROM public.${tx(table)} LIMIT 1`;
          } catch (error) {
            deniedError = error;
          }
          await tx`ROLLBACK TO SAVEPOINT ${tx(savepoint)}`;

          expect(deniedError).toBeDefined();
          expect((deniedError as { code?: string }).code).toBe('42501');
        }

        await tx`RESET ROLE`;
        await tx`SET LOCAL ROLE authenticated`;
        for (const table of TABLES) {
          const rows = await tx<Array<{ count: number }>>`
            SELECT count(*)::int AS count FROM public.${tx(table)}
          `;
          expect(Number(rows[0]?.count)).toBe(1);
        }

        throw new RollbackAfterAssertions();
      });
    } catch (error) {
      if (!(error instanceof RollbackAfterAssertions)) throw error;
    }
  });
});

afterAll(async () => {
  await database?.end({ timeout: 5 });
});
