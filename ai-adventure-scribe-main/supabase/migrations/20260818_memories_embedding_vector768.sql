-- =============================================================================
-- MANUAL APPLY ONLY — do not wire this into an automated migration runner.
--
-- Per docs/MIGRATION-CONSOLIDATION-PLAN.md, neither the Supabase tree nor the
-- Drizzle tree has one ledger-backed apply path today, and Phase 0 of that
-- plan freezes ad-hoc changes except reviewed, manually-applied SQL. Apply
-- this the same way scripts/APPLY_MIGRATIONS_MANUAL.md documents for other
-- one-off Supabase migrations: paste into the Supabase SQL Editor (or
-- `psql $DATABASE_URL -f`) after a human has reviewed the pre-flight output
-- described below.
--
-- Note that the local guard cannot tell you whether this file is correct:
-- scripts/test-migrations.sh SKIPS every migration that mentions `vector(`
-- when pgvector is not installed, so on a plain PostgreSQL this file is never
-- executed at all. CI runs on the pgvector/pgvector image, where it is.
--
-- -----------------------------------------------------------------------------
-- PRE-FLIGHT — run these FOUR queries first, post the output to issue #1822,
-- and only then apply this file. This migration is written to be correct
-- whether `memories.embedding` is currently `text` (what the drizzle
-- introspection baseline db/migrations/0001_parched_rictor.sql recorded from
-- production) or `vector(1536)` (what 20250920_add_memory_embeddings.sql
-- declared). Nobody has confirmed which of the two production actually has,
-- and the answer changes nothing here — but it must be on the record before a
-- destructive column rewrite runs.
--
--   -- 1) The real column type, as PostgreSQL reports it.
--   SELECT format_type(a.atttypid, a.atttypmod) AS column_type
--   FROM pg_attribute a
--   JOIN pg_class c ON c.oid = a.attrelid
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname = 'memories'
--     AND a.attname = 'embedding'
--     AND NOT a.attisdropped;
--
--   -- 2) Index state on the column (does idx_memories_embedding exist, and is
--   --    it really ivfflat?).
--   SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE schemaname = 'public' AND tablename = 'memories';
--
--   -- 3) The match_memories signature(s) currently installed.
--   SELECT p.oid::regprocedure AS signature, pg_get_functiondef(p.oid) AS definition
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'match_memories';
--
--   -- 4) Non-null embedding count. #1822 measured 0 of 4530. If this is not
--   --    still 0, STOP: the "no values to preserve" premise below is false and
--   --    this migration would destroy data.
--   SELECT count(*) AS total, count(embedding) AS non_null FROM public.memories;
--
-- -----------------------------------------------------------------------------
-- What this does (PR1 of 4 from the #1822 plan):
--   Makes the declared schema and the database agree on one dimension for
--   memory embeddings — gemini-embedding-001 @ 768, normalized, the same
--   corpus standard campaign_chunks.embedding already uses — so memories and
--   lore are comparable vectors. Nothing reads or writes the column
--   meaningfully yet (the write path is flag-gated off and has been since
--   before the first memory row), so applying this is behavior-neutral.
--
-- Idempotent: the DROPs are IF EXISTS, the function is CREATE OR REPLACE, and
-- the destructive column rewrite is guarded on the column not already being
-- vector(768) — so re-running this after a backfill cannot wipe the backfill.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- 1. Drop the old RPC.
--
-- It is declared at vector(1536) by 20250920_add_memory_embeddings.sql and has
-- to go before the column type changes under it. Type modifiers are not part
-- of a function's identity in PostgreSQL, so the bare `vector` in this
-- signature matches the 1536-dim function (and any 768-dim one from a previous
-- run of this file) — this is the same signature spelling
-- 20260706_secure_memories.sql revokes against.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.match_memories(vector, uuid, double precision, integer);

-- -----------------------------------------------------------------------------
-- 2. Hard-replace the column type: whatever it is now -> vector(768).
--
-- GUARD / WHY THIS DOES NOT CAST:
--   `USING NULL::vector(768)` deliberately discards the column's current
--   contents instead of casting them. #1822 measured 0 non-null embeddings out
--   of 4530 rows across the entire life of the table (2025-11-26 → 2026-08-15),
--   so there is nothing to preserve, and a real cast would have to work from a
--   type nobody has confirmed. Discarding makes the rewrite total: it succeeds
--   identically whether the live type is `text` or `vector(1536)`, neither of
--   which casts to vector(768) automatically.
--
--   This is only safe while that count is 0. Pre-flight query 4 above exists to
--   prove it still is. The whole block is skipped once the column is already
--   vector(768), so a re-run after PR3's backfill is a no-op rather than a
--   data-loss event.
--
--   The legacy ivfflat index is dropped inside the same guard because an index
--   on the column has to go before the column can be rewritten, and because
--   dropping it unconditionally would delete the *new* index the post-backfill
--   runbook creates if that runbook reuses the name.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'memories'
      AND a.attname = 'embedding'
      AND NOT a.attisdropped
      AND format_type(a.atttypid, a.atttypmod) = 'vector(768)'
  ) THEN
    DROP INDEX IF EXISTS public.idx_memories_embedding;

    ALTER TABLE public.memories
      ALTER COLUMN embedding TYPE vector(768) USING NULL::vector(768);
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 3. NO ivfflat index is created here. This is deliberate.
--
-- Building an ivfflat index over an empty (all-NULL) column produces a
-- degenerate index whose lists are trained on no data, and it would then have
-- to be rebuilt anyway once rows carry vectors. #1816's reindex lesson is that
-- the reindex belongs with the backfill, as one reviewed operation, not
-- scattered across the migration that happens to touch the column first.
--
-- Index creation is therefore deferred to the post-backfill runbook (PR4 of the
-- #1822 plan), which knows the final row count and can size `lists`
-- accordingly. Until then match_memories does an exact scan, which is correct —
-- just not fast — and is scoped to one session's rows regardless.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 4. Recreate the RPC at vector(768).
--
-- Structure mirrors search_campaign_lore in
-- 20251205_create_lore_keeper_tables.sql: LANGUAGE sql STABLE, cosine distance
-- via <=>, a NULL-embedding filter, a similarity floor, ordered by distance and
-- limited. The signature shape and the returned column list are unchanged from
-- 20250920_add_memory_embeddings.sql, because
-- server-bun/src/services/memory-service.ts calls this as
-- `SELECT * FROM match_memories(...)` and consumes whatever it returns.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_memories(
  query_embedding vector(768),
  session_id uuid,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  session_id uuid,
  type text,
  content text,
  importance integer,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  narrative_weight integer,
  emotional_tone text,
  story_arc text,
  prose_quality boolean,
  chapter_marker boolean,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.id,
    m.session_id,
    m.type,
    m.content,
    m.importance,
    m.metadata,
    m.created_at,
    m.updated_at,
    m.narrative_weight,
    m.emotional_tone,
    m.story_arc,
    m.prose_quality,
    m.chapter_marker,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM public.memories m
  WHERE m.session_id = match_memories.session_id
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION public.match_memories IS
  'Semantic search for session-scoped memories using cosine similarity (gemini-embedding-001, 768 dimensions). Server-only.';
COMMENT ON COLUMN public.memories.embedding IS
  'gemini-embedding-001 vector (768 dimensions, normalized) — same corpus standard as campaign_chunks.embedding';

-- -----------------------------------------------------------------------------
-- 5. Server-only, per the 20260706_secure_memories.sql precedent.
--
-- That migration revoked all privileges on the memories table from anon and
-- authenticated and revoked EXECUTE on the old match_memories. Recreating the
-- function resets its ACL to the default (EXECUTE to PUBLIC), so the revoke has
-- to be reapplied here or this migration would silently re-open semantic memory
-- search to every client.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.match_memories(vector, uuid, double precision, integer)
  FROM PUBLIC, anon, authenticated;

COMMIT;
