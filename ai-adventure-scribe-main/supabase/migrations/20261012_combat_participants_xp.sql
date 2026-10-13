-- #374: Store each monster's XP at seating for exact 2014 awards.
-- Additive: adds nullable columns, no backfill, no constraints. Safe to re-run.
ALTER TABLE combat_participants
  ADD COLUMN IF NOT EXISTS xp_value integer,
  ADD COLUMN IF NOT EXISTS monster_ref text;
