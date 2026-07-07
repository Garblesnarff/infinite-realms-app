-- Align production character storage with the fields accepted by server-bun.
-- All changes are additive and preserve existing rows through defaults/nulls.

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS session_notes text,
  ADD COLUMN IF NOT EXISTS spell_slots jsonb,
  ADD COLUMN IF NOT EXISTS active_concentration text,
  ADD COLUMN IF NOT EXISTS class_features jsonb,
  ADD COLUMN IF NOT EXISTS fighting_styles jsonb,
  ADD COLUMN IF NOT EXISTS copper_pieces integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS silver_pieces integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS electrum_pieces integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gold_pieces integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platinum_pieces integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damage_resistances jsonb,
  ADD COLUMN IF NOT EXISTS damage_immunities jsonb,
  ADD COLUMN IF NOT EXISTS damage_vulnerabilities jsonb,
  ADD COLUMN IF NOT EXISTS stealth_check_bonus integer DEFAULT 0;

ALTER TABLE public.character_stats
  ADD COLUMN IF NOT EXISTS temporary_hit_points integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS initiative_bonus integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS speed integer DEFAULT 30;
