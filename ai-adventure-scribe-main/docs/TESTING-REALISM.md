# Testing realism policy

Production regressions must be reproduced at the boundary where they escaped. A green unit test is not sufficient when a real serializer, database client return type, or provider payload participates in the failure.

## Required realism

- HTTP route tests use `app.handle(new Request(...))` through `createRequestPipelineApp()` and assert status, content type, and parsed body. This exercises the same Elysia response serializers used in production.
- Database mocks reproduce the real client's return type. In particular, a `postgres.js` query mock must return a `RowList`-shaped `Array` subclass with query metadata, not a plain array. Values crossing an Elysia boundary must be normalized to plain arrays.
- LLM changes include at least one realistic prompt and request payload through `/v1/llm/generate`; `hello` and exact-word probes may supplement that path but cannot replace it.
- Every production incident adds its full real-HTTP reproduction to `scripts/api-smoke.ts`. That check is permanent unless the product endpoint itself is retired.
- **A `db/schema/*.ts` edit ships with its migration in the same commit.** See below.

## The schema rule

> **Editing `db/schema/*.ts` requires a matching migration in `db/migrations/` in the same commit.**

This is enforced in two places. Both run `scripts/check-schema-drift.sh`, which runs `drizzle-kit generate` against a scratch copy of the migrations directory and fails if any DDL is emitted — because emitted DDL means `db/schema/*.ts` needs something no migration provides.

1. **The `.husky/pre-commit` hook**, which blocks the commit. It only fires when `db/schema/*.ts` is actually staged, needs no database, and takes about half a second — so it costs nothing on a normal commit. This is the primary enforcement point.
2. **The `.husky/pre-push` hook**, which blocks the push. It runs the same check over the whole tree on every push, so it catches drift committed with `--no-verify` — and drift introduced by any commit, not just the one being made. If the push also changes `db/migrations/` or `supabase/migrations/`, it runs the migration replay too, provided a PostgreSQL server is reachable (`TEST_DATABASE_URL`, else `postgres://localhost:5432/postgres`); it warns and skips rather than failing when there is none.
3. **The `DB Guards` workflow** (`.github/workflows/db-guards.yml`), which cannot be skipped locally at all. It is a separate workflow from `ci.yml` with `paths:` filters, so it only consumes Actions minutes on pushes that touch the database layer.

Hooks are wired up by `bun install`, in the repo root or in `ai-adventure-scribe-main` — both `prepare` scripts run `scripts/setup-git-hooks.sh`, which points `core.hooksPath` at `.husky/` and makes the hooks executable. To check or repair by hand:

```bash
git config core.hooksPath        # must print <repo>/.husky
bash scripts/setup-git-hooks.sh  # if it printed nothing
```

**Why the rule exists.** Drizzle schema files are TypeScript. Adding a column there makes the code compile, the types check, and the tests pass — while the column does not exist in any database. Nothing fails until a real query hits real PostgreSQL. Three separate production incidents came from exactly this:

- **20260710** — `character_equipment` drifted from `db/schema/inventory.ts`.
- **20260725** — `combat_participant_status.exhaustion_level` was added to `db/schema/combat.ts` in `e10115f0` with no migration. Every `POST /v1/combat/sessions/:id/start` had 500'd since that feature shipped.
- **20260725, same investigation** — a full table-by-table diff found **eleven tables** present in `db/schema/*.ts` and absent from production: spellcasting, resting, levelling/XP and class-features writes had been silently failing since each shipped. See `17ebfd47` for the writeup.

Type-checking and unit tests cannot catch this class of bug, which is why it needs a CI gate of its own.

**Workflow.** From `ai-adventure-scribe-main/`:

```bash
# 1. edit db/schema/<file>.ts
# 2. generate the migration
bunx drizzle-kit generate --name describe_your_change
# 3. review and edit db/migrations/<n>_describe_your_change.sql by hand --
#    drizzle's DDL is a starting point. Add backfills and get NOT NULL /
#    DEFAULT ordering right for a table that already has rows.
# 4. verify
bun run db:check-drift
# 5. commit the schema edit, the .sql and the refreshed db/migrations/meta/ snapshot together
```

Hand-written migrations are fine — the guard compares against `db/migrations/meta/`, so write the SQL by hand and still run `drizzle-kit generate` to refresh the snapshot.

Never satisfy the guard by reverting the schema edit or hand-editing a snapshot to match. The snapshot is the record of what migrations have actually been written.

## Migration replay

`bun run test:migrations` (`scripts/test-migrations.sh`, the `migration-replay` job in the `DB Guards` workflow) replays the migration history into a throwaway PostgreSQL database on every push, so a migration that cannot apply fails CI instead of the production box. It ends by re-running the exact combat-start `INSERT` from the 20260725 production logs.

Its central assertion is that **every table and column `db/schema/*.ts` declares exists after replaying the committed migrations**. That check is driven by the newest snapshot in `db/migrations/meta/`, not a hand-maintained list, so it cannot go stale as the schema grows — and it is exactly the check whose absence caused the 20260725 incident. It currently passes for all 65 tables.

Some of this project's schema had never been created by any committed migration: the SQL for `0002_steady_darwin` and `0003_thin_hairball` is missing from the repo though `meta/_journal.json` references both, and several tables were made through the Supabase dashboard. `db/migrations/20251106_backfill_lost_drizzle_migrations.sql` reconstructs what could be reconstructed — nine tables and fifteen columns, derived mechanically from the drizzle snapshot, every statement idempotent so it is a no-op against production.

Six migrations still cannot replay, all because they depend on `campaign_characters`, `starter_character_templates` or `character_creation_metrics` — tables that drizzle does not model, so there is no trustworthy source for their DDL. They are listed with reasons in `db/migrations/.replay-known-gaps`, and can only be cleared by dumping the real definitions out of production (`pg_dump --schema-only -t <table>`) and committing them. **That list only ever shrinks — never add a new migration to it.** A migration not on the list that fails to replay fails the build.

Running it locally needs a PostgreSQL server; `TEST_DATABASE_URL` overrides the default of `postgres://localhost:5432/postgres`. Without pgvector some migrations cannot run, so the schema-completeness findings are downgraded to warnings rather than reporting a failure the environment caused. CI runs on `pgvector/pgvector:pg16`, where nothing is skipped.

## Permanent incident regressions

1. **postgres.js `RowList` serialization:** `GET /v1/starter-character-templates?campaign_id=the-eternal-feast` must return `200 application/json`, at least five rows, and more than 5 KB. The HTTP test supplies a `RowList`-shaped subclass and proves it cannot become `[object Object]` with `text/plain`.
2. **Realistic LLM generation:** `POST /v1/llm/generate` sends a small gameplay prompt, requires `200 application/json`, and requires non-empty `text`. This traverses the configured provider/model chain and catches delisted models or upstream passthrough failures.
3. **Schema drift (`exhaustion_level`):** `combat_participant_status.exhaustion_level` must exist after a migration replay, and the combat-start `INSERT` that names it must succeed. Both are asserted by `scripts/test-migrations.sh`; the drift that caused it is prevented going forward by `scripts/check-schema-drift.sh`.

Add the next incident as item 4 and add its check to the same smoke journey in the fixing change.
