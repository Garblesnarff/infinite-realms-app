ALTER TABLE combat_encounters
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
