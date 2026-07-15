# Migration Consolidation Plan

**Status:** investigation complete; no schema or migration files were changed by this work.

**Decision:** make a repaired, freshly bootstrapped Drizzle migration stream the only executable migration stream. Preserve both current trees as historical evidence until the baseline has been verified against production and the replacement stream has passed clean-database and production-ledger checks.

This is a static investigation. It does not have production database access, so the production schema dump and migration-ledger output in [VPS verification](#vps-verification-commands-for-rob) are required gates, not optional follow-up.

## Scope and evidence

The investigation covered `db/migrations/`, `db/schema/*.ts`, `supabase/migrations/`, `supabase/config.toml`, migration/deployment scripts, PM2 configuration, tracked GitHub workflows, and the seven top-level migration documents listed below. No `.env` file was read.

### Current executors

| Path | What applies it today | Finding |
| --- | --- | --- |
| `supabase/migrations/` | `scripts/test-migrations.sh` lists this directory and runs `supabase db reset --db-url "$DB_URL"`; Supabase CLI uses `supabase/config.toml`. | This is the only all-tree reset/test path. It does **not** include `db/migrations/`. Its claimed successful output is stale: its earliest files alter `game_sessions` and `memories`, so a truly empty database still needs an untracked base schema. |
| Selected Supabase files | `scripts/apply-all-migrations.sh` calls `bunx supabase db execute --file` for exactly five November 2025 files. `scripts/deploy-blog-cms.sh` sends one blog file directly through `psql`. | These are ad-hoc, partial applies, rather than one ledger-backed deploy step. |
| `db/migrations/` | No `drizzle.config.*`, no `drizzle-kit migrate` package script, and no deployment script or active workflow invokes it. Drizzle is installed and server code imports the Drizzle schema/client. | There is no runnable, repository-owned Drizzle application path today. Recent files have therefore been applied manually/ad hoc; the 2026-07-14 combat migration is the known `psql` example. |
| `supabase-docker/` | The application documentation identifies the VPS Supabase Docker stack, but this checkout has a gitlink for `supabase-docker` with no matching `.gitmodules` entry, so its tooling is not present here. | Do not infer a migration runner from this checkout. Inspect the VPS directly before cutover. |

No tracked GitHub Actions workflow or deploy script applies either complete tree. `docs/MIGRATION_CI_CD.md` describes a proposed CI integration; it is not evidence of an active migration job. The older `docs/DEPLOYMENT.md` also describes a retired Next.js/Supabase deployment shape, not the current Bun/Hetzner path. The only current production-path evidence in the repository is the Bun PM2 configuration (`infiniterealms-bun`, `/var/www/infiniterealms/ai-adventure-scribe-main/server-bun`) and the operational documentation saying that pushing `main` deploys. Neither runs a migration command.

## Static schema reconstruction

### Drizzle tree and definitions

`db/schema/*.ts` declares **64** tables. The SQL files under `db/migrations/` create only **37** tables. In particular, there is no recorded creation of these schema-declared tables in the Drizzle SQL stream:

`ai_usage`, `campaign_chunks`, `campaign_parties`, `campaign_rules`, `character_equipment`, `character_features`, `character_hit_dice`, `character_spell_slots`, `character_spells`, `character_subclasses`, `class_features_library`, `combat_damage_log`, `combat_encounters`, `combat_participant_conditions`, `combat_participant_status`, `combat_participants`, `conditions_library`, `creature_stats`, `experience_events`, `feature_usage_log`, `level_progression`, `party_characters`, `rest_events`, `session_chronicles`, `spell_slot_usage_log`, `starter_campaigns`, and `weapon_attacks`.

Some are expected to predate the Drizzle stream, but that is precisely the issue: static SQL cannot reproduce a database from this tree. Known examples are especially significant:

- `db/migrations/20260710_align_character_equipment.sql` explicitly says the original table creation was never recorded.
- `ai_usage` is defined in `db/schema/usage.ts`, but its Drizzle migration only adds cost columns.
- `session_chronicles` is used by the Bun server and defined in `db/schema/game.ts`, but no migration in either executable-looking stream creates it.
- `users`, its WorkOS text ID, Stripe columns, A/B column, `waitlist`, `processed_stripe_events`, and `tactical_maps` are Drizzle-side additions with no corresponding Supabase migration creation.

The Drizzle schema is nevertheless the better target because it is the type-safe model consumed by the Bun server, its newest application work is being written under `db/migrations/`, and it covers the active server-side domain model. It is **not** ready to be declared authoritative until the live dump reconciles the missing definitions, non-Drizzle SQL objects, indexes, triggers, policies, and extensions.

### Supabase tree

`supabase/migrations/` has 69 SQL files and statically creates **74** tables. It creates many mechanics and support tables that the Drizzle SQL tree lacks (combat, rest, progression, class features, Lore Keeper, archive, multiplayer, and metadata tables). Conversely, its first files only alter core tables such as `game_sessions`, `memories`, `campaigns`, and `characters`; it contains no deterministic base creation for those tables. Therefore it also cannot reconstruct production from an empty database without an unknown historical baseline.

The Supabase tree contains historical state that is absent from `db/schema`, including `user_profiles`, `campaign_members`, `character_voice_*`, archive tables, world-fact tables, session/multiplayer tables, blog digest tables, and `agent_checkpoints`. These may be live and must be represented in the baseline even if they are later intentionally retired. Their status cannot be inferred from source alone.

### Direct overlap and contradictions

Both trees create these eleven table names: `blog_authors`, `blog_categories`, `blog_post_categories`, `blog_post_tags`, `blog_posts`, `blog_tags`, `classes`, `class_spells`, `consumable_usage_log`, `inventory_items`, and `spells`. They also both alter the shared core tables around campaigns, characters, sessions, dialogue history, memories, combat, and security.

The overlap is not benign:

- **Inventory:** both trees create `inventory_items` and `consumable_usage_log`. The Supabase definition includes item-type, quantity, and weight checks, two partial inventory indexes, an `updated_at` trigger, a positive `quantity_used` check, and a descending timestamp index. The later Drizzle definitions omit those checks, trigger, and partial indexes. Whichever `CREATE TABLE IF NOT EXISTS` ran first determines part of production's actual contract.
- **Blog:** both trees create the six blog tables. The Supabase definition ties `blog_authors.user_id` to `auth.users`, adds an update trigger, enables RLS, and creates policies. The Drizzle initial SQL has its own foreign-key layout and indexes but does not reproduce those policies or triggers. A baseline must include all three categories: structure, executable objects, and privileges.
- **Reference data:** both create `classes`, `spells`, and `class_spells`, making table identity and constraints dependent on application order rather than one history.
- **Core/session state:** Drizzle creates the initial `campaigns`, `characters`, `character_stats`, `game_sessions`, `dialogue_history`, `memories`, and related core tables; the Supabase files mutate them and supply their RLS/security history. Neither tree alone describes the final result.
- **WorkOS and billing:** Drizzle creates `public.users` with a text WorkOS ID and then adds Stripe fields. The Supabase tree instead creates `public.user_profiles`, keyed by email with an optional UUID `user_id`; it has no migration that creates the WorkOS `users` table or its Stripe columns. These are parallel user/billing representations, not a single versioned definition.
- **Security:** Supabase's 2026-07-06 files enable RLS/revoke privileges for campaign, character, memory, and session-message tables. Drizzle's 2026-07-13 file revokes client privileges from several of those tables. The final grants/policies depend on both histories and the order in which someone ran them.

### The duplicate `0001_` collision

`db/migrations/0001_add_session_indexes.sql` and `db/migrations/0001_parched_rictor.sql` share the same numeric prefix. This is not merely cosmetic:

1. `db/migrations/meta/_journal.json` contains `0001_parched_rictor`, but not `0001_add_session_indexes`. The journal also references `0002_steady_darwin` and `0003_thin_hairball`, whose SQL files do not exist. A standard Drizzle migration reader uses its journal entries, so the current metadata cannot describe the directory faithfully; with a config added, it is expected to fail on the missing journal files before it can be trusted.
2. An ad-hoc lexical `*.sql` runner sees `0001_add_session_indexes.sql` before `0001_parched_rictor.sql`. On a clean database that attempts indexes on `dialogue_history` and `game_sessions` before those tables have been created, so it fails.
3. The duplicate name masks a more general problem: all date-stamped Drizzle files after the original four are outside the journal. Their application state cannot be derived from the repository.

Do not rename or repair these historical files in place. Doing so would rewrite evidence and can invalidate a migration ledger. Preserve them during the cutover and begin a fresh, correctly journaled stream.

## Recommended cutover: one repaired Drizzle stream

The chosen executable tree is **Drizzle**, at `db/migrations/`, rebuilt as a new stream after the live baseline has been captured. This is a tooling decision, not a claim that the current Drizzle SQL is complete. Supabase remains the PostgreSQL platform; the change is that there will be one migration authoring, testing, and ledger path.

### Phase 0 — freeze and establish ownership

1. Freeze changes to both current migration directories. No direct `psql`, `supabase db execute`, SQL Editor paste, or ad-hoc file apply except an incident response approved in writing.
2. If an emergency DDL change is unavoidable, capture the exact SQL, UTC time, operator, target database, and verification output in the incident record, then make it the first reconciliation item before any next deployment.
3. Name one migration owner and require every application PR that needs DDL to include the one Drizzle migration and its test result.
4. Do not delete, rename, or edit applied historical SQL. Mark both old directories historical in the later implementation PR; move them outside the executable migration root only after the baseline is accepted.

### Phase 1 — capture production truth

1. Run the commands below on the Hetzner VPS and preserve their output with the cutover PR.
2. Capture a schema-only `pg_dump`, the full public column/constraint/index/policy inventory, extensions, and any migration ledger tables.
3. Compare that dump against all 64 Drizzle definitions and the static inventories above. Classify every difference as: live-and-model, live-but-unmodelled, model-but-absent, intentional legacy, or unknown.
4. Resolve all unknowns before writing a baseline. In particular, decide the fate of `user_profiles` versus `users`, `session_chronicles`, `character_equipment`, `ai_usage`, policy/RLS objects, all trigger/function objects, and Supabase-only tables.

### Phase 2 — build and prove the baseline

1. Start a clean Drizzle migration history; do not reuse the broken `meta/_journal.json`. Add a real `drizzle.config.ts` and one repository script that invokes the Drizzle migrator against `db/migrations/`. It must take connection information only from environment variable names, never committed values.
2. Translate the accepted production schema dump into `db/schema/*.ts` plus narrowly documented raw SQL for PostgreSQL/Supabase features Drizzle cannot express (extensions, vector indexes, functions, triggers, RLS policies, grants, and seed/reference data). The schema must be an honest full model, not just the tables currently used by TypeScript.
3. Generate one new, uniquely timestamped baseline migration from that accepted model. It must create a clean database equivalent to production, including constraints, indexes, policies, functions, triggers, and extensions. Do not use sequential `0001_` names.
4. Restore the production schema-only dump into an isolated disposable database and diff its catalog against a database created from the baseline migration. Repeat until only explicitly approved environmental differences remain.
5. Test the baseline from empty twice: first application succeeds; a second Drizzle run reports no pending work because the ledger recorded the first run. Also run the application migration tests against this clean database.

### Phase 3 — adopt the new ledger safely

1. Take and verify a fresh production backup immediately before the production operation.
2. On production, **do not execute a create-everything baseline over the existing schema**. First prove catalog equivalence with the accepted baseline. Then perform one reviewed, documented ledger-baselining operation so Drizzle records the baseline as already applied. The exact ledger operation must be derived from the generated migration hash and timestamp and reviewed with the dumped `drizzle.__drizzle_migrations` state; it is not safe to guess or copy a value from this plan.
3. Immediately run the canonical migration command. It must report zero pending changes. Verify the key application paths and compare the post-operation schema inventory with the pre-operation capture.
4. Enable a CI job that creates an empty disposable PostgreSQL database, applies only the new Drizzle tree, runs migration/schema assertions, and fails if a second run has pending migrations. Retire `scripts/test-migrations.sh` only after this replacement is passing.

### Phase 4 — operate one path

1. All new DDL goes to the new `db/migrations/` stream and is generated/recorded in its journal.
2. Production deployment invokes exactly one reviewed migration command before the Bun restart, and records the migration identifier in deployment output.
3. Keep the archived trees read-only for audit and disaster analysis; never replay either tree as rollback.
4. Re-run the schema-diff gate when adding SQL objects that are not expressible in Drizzle.

## Rollback rules

- A failed **new** migration is corrected by a new forward migration after restoring or repairing the affected object; never edit an already-recorded migration.
- For destructive or data-changing work, take a tested backup first and write an explicit, rehearsed rollback/restore procedure in the PR. `CREATE INDEX CONCURRENTLY` and similar operations need their own transaction treatment.
- If the production ledger-baselining step is wrong, stop deployments, restore the pre-operation schema/ledger state from the verified backup, and re-run the catalog comparison. Do not run either legacy tree to "catch up."
- The baseline is a clean-environment construction artifact. It is not a production repair script and must not be blindly replayed on the live database.

## VPS verification commands for Rob

Run these on the Hetzner VPS. They read only database metadata and emit no credential values. The commands assume the documented production container name, `supabase-db`; stop if the first command does not show that exact name.

```bash
set -euo pipefail

APP=/var/www/infiniterealms/ai-adventure-scribe-main
DB=supabase-db

docker ps --format '{{.Names}}' | grep -Fx "$DB"
cd "$APP"
git rev-parse --show-toplevel
git rev-parse HEAD
git status --short --branch

stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump=/tmp/infiniterealms-public-schema-$stamp.sql
docker exec "$DB" pg_dump -U postgres -d postgres \
  --schema-only --no-owner --no-privileges --schema=public > "$dump"
sha256sum "$dump"
printf 'Schema dump: %s\n' "$dump"
```

```bash
set -euo pipefail

DB=supabase-db
PSQL=(docker exec "$DB" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off)

"${PSQL[@]}" -c "SELECT extname, extversion FROM pg_extension ORDER BY extname;"
"${PSQL[@]}" -c "
SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;"
"${PSQL[@]}" -c "
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;"
"${PSQL[@]}" -c "
SELECT n.nspname AS schema_name, c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname = 'public'
ORDER BY c.relname;"
"${PSQL[@]}" -c "
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;"
"${PSQL[@]}" -c "
SELECT n.nspname AS schema_name, p.proname,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'drizzle', 'supabase_migrations')
ORDER BY n.nspname, p.proname;"
"${PSQL[@]}" -c "
SELECT event_object_schema, event_object_table, trigger_name, action_timing,
       event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
ORDER BY event_object_table, trigger_name;"
```

```bash
set -euo pipefail

DB=supabase-db
PSQL=(docker exec "$DB" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off)

# Discover both possible migration ledgers before querying their contents.
"${PSQL[@]}" -c "
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name IN ('__drizzle_migrations', 'schema_migrations')
ORDER BY table_schema, table_name;"

# These are expected ledger locations; each command is deliberately non-fatal
# so an absent historical ledger is recorded as evidence rather than hiding later output.
"${PSQL[@]}" -c 'TABLE drizzle.__drizzle_migrations;' || true
"${PSQL[@]}" -c 'TABLE supabase_migrations.schema_migrations;' || true

# High-risk tables: capture full psql descriptions, including constraints,
# indexes, triggers, policies, and privileges. "Did not find any relation" is
# useful evidence and should be kept in the transcript.
for table in \
  users user_profiles campaigns characters character_stats game_sessions dialogue_history \
  memories character_equipment inventory_items combat_encounters combat_participants \
  tactical_maps ai_usage processed_stripe_events session_chronicles blog_authors \
  blog_posts starter_campaigns; do
  printf '\n===== public.%s =====\n' "$table"
  "${PSQL[@]}" -c "\\d+ public.$table" || true
done
```

Send the three command transcripts and the schema-dump path/hash to the person implementing the cutover. Do not send a database URL, `.env` file, or data dump.

## Documents superseded

This plan supersedes the **current migration execution and source-of-truth guidance** in these seven stale top-level documents. They remain historical implementation/test records until a later cleanup explicitly archives them:

1. `docs/MIGRATIONS.md`
2. `docs/MIGRATION_CI_CD.md`
3. `docs/MIGRATION_TEST_ARCHITECTURE.md`
4. `docs/MIGRATION_TESTING_SUMMARY.md`
5. `docs/MIGRATION_TEST_OUTPUT.md`
6. `docs/MIGRATION_INSTRUCTIONS.md`
7. `docs/MIGRATION_GUIDE.md`

It does not supersede feature-specific historical documentation outside that list, such as the blog CMS deployment record. Those documents must be updated or archived only as part of the cutover implementation, after their live assumptions have been checked.
