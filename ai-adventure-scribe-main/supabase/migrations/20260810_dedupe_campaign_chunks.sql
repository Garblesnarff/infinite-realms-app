-- =============================================================================
-- MANUAL APPLY ONLY — do not wire this into an automated migration runner.
--
-- Per docs/MIGRATION-CONSOLIDATION-PLAN.md, neither the Supabase tree nor the
-- Drizzle tree has one ledger-backed apply path today, and Phase 0 of that
-- plan freezes ad-hoc changes except reviewed, manually-applied SQL. Apply
-- this the same way as scripts/APPLY_MIGRATIONS_MANUAL.md documents for
-- other one-off Supabase migrations: paste into the Supabase SQL Editor (or
-- `psql $DATABASE_URL -f`) after a human has reviewed the dry-run output.
--
-- TAKE A BACKUP FIRST. This file deletes rows. There is no tracked backups/
-- directory in this repo to defer to — take a schema+data backup the way
-- docs/DEPLOYMENT.md's "Backup Strategy" section describes, e.g.:
--   pg_dump $DATABASE_URL --table=campaign_chunks > \
--     campaign_chunks_backup_$(date +%Y%m%dT%H%M%SZ).sql
-- or use the Supabase dashboard's "Database > Backups" point-in-time backup
-- before proceeding, and confirm you can restore from it.
--
-- Order of operations:
--   1. Run the DRY-RUN section below (it is commented out — copy the SELECT
--      statements out and run them on their own first). Confirm the
--      "would keep" row for known art-bearing entities (e.g. Balthazar, The
--      Infinite Kitchen — see issue #1664) is the one with a non-null
--      metadata->>'image_url'.
--   2. Take the backup described above.
--   3. Run the transactional DEDUPE + UNIQUE INDEX section further down.
--   4. Re-run the missing-art audit (see PR body) to get the true gap list.
--
-- Safe to re-run: the DELETE only ever matches rows ranked below 1 within a
-- duplicate group, so once a campaign has no duplicates left it deletes
-- nothing, and `CREATE UNIQUE INDEX IF NOT EXISTS` is a no-op once the index
-- exists.
-- =============================================================================

-- =============================================================================
-- DRY RUN — copy these two SELECT statements out and run them FIRST, on their
-- own, against a read connection. Nothing in this section mutates data; it is
-- commented out so pasting this whole file does not skip straight past it.
-- =============================================================================

-- -- 1) Duplicate groups: how many extra rows exist per
-- --    (campaign_id, chunk_type, entity_name), and how many would be deleted.
-- --    Rows with a NULL entity_name (e.g. the whole-file `world_building` and
-- --    `creative_brief` chunks — see tools/lore-keeper-ingest/src/chunker.ts)
-- --    are intentionally excluded: they are not the "duplicate NPC/item/
-- --    location" bug described in #1664, and NULL is never considered equal
-- --    to NULL for this purpose.
-- SELECT
--   campaign_id,
--   chunk_type,
--   entity_name,
--   COUNT(*)         AS row_count,
--   COUNT(*) - 1      AS rows_to_delete
-- FROM campaign_chunks
-- WHERE entity_name IS NOT NULL
-- GROUP BY campaign_id, chunk_type, entity_name
-- HAVING COUNT(*) > 1
-- ORDER BY campaign_id, chunk_type, entity_name;

-- -- 2) Row-level detail: which specific row in each duplicate group would be
-- --    KEPT (keep_rank = 1) vs deleted, using the exact rule applied below —
-- --    prefer a row with metadata->>'image_url' set, tiebreak newest
-- --    created_at. Spot-check that art-bearing rows always win keep_rank = 1,
-- --    and that Balthazar / The Infinite Kitchen (#1664) show a kept row with
-- --    a non-null image_url.
-- SELECT
--   id,
--   campaign_id,
--   chunk_type,
--   entity_name,
--   metadata->>'image_url' AS image_url,
--   created_at,
--   ROW_NUMBER() OVER (
--     PARTITION BY campaign_id, chunk_type, entity_name
--     ORDER BY (metadata->>'image_url') IS NOT NULL DESC, created_at DESC
--   ) AS keep_rank
-- FROM campaign_chunks
-- WHERE entity_name IS NOT NULL
--   AND (campaign_id, chunk_type, entity_name) IN (
--     SELECT campaign_id, chunk_type, entity_name
--     FROM campaign_chunks
--     WHERE entity_name IS NOT NULL
--     GROUP BY campaign_id, chunk_type, entity_name
--     HAVING COUNT(*) > 1
--   )
-- ORDER BY campaign_id, chunk_type, entity_name, keep_rank;

-- =============================================================================
-- DEDUPE + UNIQUE INDEX
-- Idempotent, wrapped in a transaction. Only run after the dry-run above has
-- been reviewed and a backup has been taken (see header).
-- =============================================================================

BEGIN;

-- Delete every row in a duplicate (campaign_id, chunk_type, entity_name) group
-- except the one that would be kept: prefer a row that carries
-- metadata->>'image_url' (so rows with confirmed art always survive per the
-- issue's acceptance criteria), tiebreaking on the newest created_at.
--
-- campaign_chunks does not have an updated_at column (see
-- supabase/migrations/20251205_create_lore_keeper_tables.sql), so created_at
-- is the only timestamp available for the "else newest" tiebreak the issue
-- asks for.
--
-- entity_name IS NULL rows (whole-file chunks with no single entity, e.g.
-- `world_building`/`creative_brief` — see chunker.ts chunkCreativeBrief /
-- chunkWorldBuilding) are excluded from ranking: PARTITION BY treats NULLs as
-- equal to each other, which would incorrectly group unrelated whole-file
-- chunks together and risk deleting one. Those rows are not part of the
-- "duplicate NPC/item/location" bug this migration fixes.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY campaign_id, chunk_type, entity_name
      ORDER BY (metadata->>'image_url') IS NOT NULL DESC, created_at DESC
    ) AS keep_rank
  FROM campaign_chunks
  WHERE entity_name IS NOT NULL
)
DELETE FROM campaign_chunks
WHERE id IN (SELECT id FROM ranked WHERE keep_rank > 1);

-- Prevent recurrence. Deliberately a FULL (non-partial) unique index, not a
-- partial `WHERE entity_name IS NOT NULL` index, even though entity_name is
-- nullable for some chunk_types (whole-file `world_building`/`creative_brief`
-- chunks — confirmed nullable in the `campaign_chunks` CREATE TABLE in
-- 20251205_create_lore_keeper_tables.sql, which declares `entity_name TEXT`
-- with no NOT NULL constraint):
--
--   1. Postgres unique indexes already treat NULL as distinct from NULL, so
--      multiple entity_name-IS-NULL rows for the same (campaign_id,
--      chunk_type) can already coexist under a full index — a partial index
--      would not change that behavior, only make the intent more explicit.
--   2. A partial unique index changes ON CONFLICT inference: Postgres will
--      only infer a partial index for `INSERT ... ON CONFLICT (cols)` if the
--      statement also repeats the index's WHERE predicate on the conflict
--      target. PostgREST (and therefore the supabase-js `.upsert()` call
--      added to tools/lore-keeper-ingest/src/database.ts in this PR) has no
--      way to express that predicate — it only sends a bare column list. A
--      partial index here would make that upsert fail with "there is no
--      unique or exclusion constraint matching the ON CONFLICT specification"
--      for every row that does have an entity_name, i.e. almost every row.
--
-- A full index gives the same duplicate-prevention guarantee for entity-
-- bearing rows and keeps the ingest-side upsert working through the ordinary
-- Supabase client.
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_chunks_unique_entity
  ON campaign_chunks (campaign_id, chunk_type, entity_name);

COMMIT;
