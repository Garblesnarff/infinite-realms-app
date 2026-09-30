-- #2283: move memories.importance rows written on the old 1-5 scale onto the 1-10 scale.
-- MANUAL APPLY AFTER THIS PR DEPLOYS, on Rob's line, and record the apply (#1703). Data only: no DDL.
--
-- Mapping, explicit and order-preserving: 1->1, 2->3, 3->5, 4->7, 5->9 (2n-1).
-- It is the inverse of the halving the client used to apply, Math.round(x / 2), taken at the
-- low end of each pair, so 1 stays the floor and 10 is left for rows the new schedule scores
-- above every old row. The writers in the same PR that carried 1-5 constants use this table too
-- (summary 5->9, XML 4->7, initial-greeting 5/4/4/3 -> 9/7/7/5), so a new row and a migrated
-- row of the same kind rank the same.
--
-- Rows on the 1-5 scale:
--   * every row created before this PR's deploy, except
--   * metadata.source = 'llm_extraction' rows created at or after 2026-09-29 04:30:44Z, when
--     #2329 (33b3de9c) went live in deploy 0f71569b (auto-deploy.log "Deploy complete"). Those
--     are already 1-10. The pm2 restart falls between 04:30:02 and 04:30:44; prod had no
--     llm_extraction row in 04:30-04:31.
-- From this PR's deploy on, every writer emits 1-10.
--
-- This PR's deploy time is not known when this file is written, so the apply passes it. Use the
-- "Deploy complete" timestamp of the deploy that ships this PR (UTC):
--   PGOPTIONS='-c ir.importance_rescale_before=2026-10-01T12:34:56Z' \
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- Without the setting the file refuses to run while any unmarked row exists, so it cannot
-- silently rescale rows the new code wrote. On an empty table (migration replay) it is a no-op.
--
-- Idempotent: each rescaled row gets metadata.importance_before_2283 = its old value, and rows
-- carrying that key are never selected again. The key is also the way back.
-- The dry-run count query is in the PR description.

DO $$
DECLARE
  cutoff timestamptz := NULLIF(current_setting('ir.importance_rescale_before', true), '')::timestamptz;
  llm_on_1_10_since CONSTANT timestamptz := '2026-09-29 04:30:44+00';
  unmarked bigint;
  out_of_range bigint;
  rescaled bigint;
BEGIN
  IF cutoff IS NULL THEN
    SELECT count(*) INTO unmarked
    FROM memories
    WHERE NOT (COALESCE(metadata, '{}'::jsonb) ? 'importance_before_2283');
    IF unmarked > 0 THEN
      RAISE EXCEPTION 'ir.importance_rescale_before is not set and % rows are unmarked; pass this PR''s deploy time (see header)', unmarked;
    END IF;
    RAISE NOTICE 'importance rescale: memories has no unmarked rows, nothing to do';
    RETURN;
  END IF;

  IF cutoff > now() THEN
    RAISE EXCEPTION 'ir.importance_rescale_before (%) is in the future', cutoff;
  END IF;

  CREATE TEMP TABLE importance_rescale_2283 ON COMMIT DROP AS
  SELECT id, importance
  FROM memories
  WHERE created_at < cutoff
    AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'importance_before_2283')
    AND NOT (metadata->>'source' IS NOT DISTINCT FROM 'llm_extraction'
             AND created_at >= llm_on_1_10_since);

  SELECT count(*) INTO out_of_range
  FROM importance_rescale_2283
  WHERE importance IS NULL OR importance NOT BETWEEN 1 AND 5;
  IF out_of_range > 0 THEN
    RAISE EXCEPTION '% rows in scope are not on the 1-5 scale; the mapping is only defined for 1-5', out_of_range;
  END IF;

  UPDATE memories m
  SET importance = CASE r.importance
        WHEN 1 THEN 1
        WHEN 2 THEN 3
        WHEN 3 THEN 5
        WHEN 4 THEN 7
        WHEN 5 THEN 9
      END,
      metadata = COALESCE(m.metadata, '{}'::jsonb) || jsonb_build_object('importance_before_2283', r.importance)
  FROM importance_rescale_2283 r
  WHERE m.id = r.id;
  GET DIAGNOSTICS rescaled = ROW_COUNT;

  RAISE NOTICE 'importance rescale: % rows moved from 1-5 to 1-10 (created before %)', rescaled, cutoff;
END $$;
