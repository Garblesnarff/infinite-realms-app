ALTER TABLE character_stats
  ADD COLUMN IF NOT EXISTS max_hit_points integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS current_hit_points integer NOT NULL DEFAULT 10;

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS pact_slots jsonb;

ALTER TABLE character_stats
  DROP CONSTRAINT IF EXISTS character_stats_hit_points_valid;

ALTER TABLE character_stats
  ADD CONSTRAINT character_stats_hit_points_valid
  CHECK (max_hit_points >= 1 AND current_hit_points >= 0 AND current_hit_points <= max_hit_points);
