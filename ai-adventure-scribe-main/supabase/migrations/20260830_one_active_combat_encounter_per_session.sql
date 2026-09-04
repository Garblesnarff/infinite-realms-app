-- #1907 PR2: make the entry claim unique per session.
--
-- Historical data may contain more than one row marked active for a session. Keep the newest
-- active encounter (deterministically) and close the older duplicates before adding the partial
-- unique index. Closing the rows preserves their audit trail and lets the cleanup be replayed.
WITH ranked_active AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY session_id
      ORDER BY started_at DESC, created_at DESC, id DESC
    ) AS duplicate_rank
  FROM public.combat_encounters
  WHERE status = 'active'
)
UPDATE public.combat_encounters AS encounter
SET
  status = 'completed',
  ended_at = COALESCE(encounter.ended_at, now()),
  ended_reason = COALESCE(encounter.ended_reason, 'duplicate_active_session_cleanup'),
  updated_at = now()
FROM ranked_active
WHERE encounter.id = ranked_active.id
  AND ranked_active.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_combat_encounters_one_active_session
  ON public.combat_encounters (session_id)
  WHERE status = 'active';
