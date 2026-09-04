-- Combat declarations may wait for the declared player's next legal turn.
-- Manual apply after the PR merges; the matching numbered Drizzle migration is
-- intentionally inert and exists only to advance the snapshot chain.
ALTER TABLE public.combat_encounters
  ADD COLUMN IF NOT EXISTS pending_intent jsonb;

COMMENT ON COLUMN public.combat_encounters.pending_intent IS
  'Server-owned player combat declaration waiting for its actor turn.';
