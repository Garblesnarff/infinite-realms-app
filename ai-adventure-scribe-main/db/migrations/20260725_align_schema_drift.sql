-- Comprehensive schema-drift alignment: full diff of every table in db/schema/*.ts
-- against live prod (information_schema.columns / pg_tables), run 2026-07-25 after
-- the CLI playtest hit "column combat_participant_status.exhaustion_level does not
-- exist". This is the third schema-drift incident (after character_equipment,
-- 20260710_align_character_equipment.sql) -- fixing the whole class this time, not
-- just the one column. See PR description / commit message for the full drift
-- report (missing tables, missing columns, type mismatches, extra columns).
--
-- Root cause pattern in every case below: a schema.ts change was made without ever
-- writing (or applying) the matching SQL migration. There is no CI or pre-merge
-- check that would have caught this (see report).

-- =============================================================================
-- PART 1 -- combat-path critical fix (the reported playtest bug)
-- =============================================================================
-- exhaustionLevel was added to db/schema/combat.ts in commit e10115f0
-- ("feat(combat): D&D 5E exhaustion system with 6 cumulative levels") but no
-- migration was ever written for it -- the original combat migration
-- (supabase/migrations/20251112_01_add_combat_system_unified.sql) predates the
-- exhaustion feature and never had this column. Every combat-start insert into
-- combat_participant_status has been failing in prod since that feature shipped.
ALTER TABLE combat_participant_status
  ADD COLUMN IF NOT EXISTS exhaustion_level integer NOT NULL DEFAULT 0;

-- =============================================================================
-- PART 2 -- other additive/type drift found on existing tables
-- =============================================================================

-- characters.class_levels: schema.ts declares jsonb (db/schema/game.ts), prod has
-- text. All 94 existing rows have class_levels = NULL, so this is a zero-risk
-- type change -- snapshotted anyway per established procedure.
CREATE TABLE IF NOT EXISTS _drift_backup_20260725_characters AS
  SELECT id, class_levels FROM characters;

ALTER TABLE characters
  ALTER COLUMN class_levels TYPE jsonb USING class_levels::jsonb;

-- tokens.created_by: schema.ts declares uuid + notNull (db/schema/tokens.ts), prod
-- has text and allows NULL. Table has 0 rows in prod -- zero-risk, snapshotted
-- anyway per established procedure. NOT NULL added to match schema.ts; safe
-- because the table is empty.
CREATE TABLE IF NOT EXISTS _drift_backup_20260725_tokens AS
  SELECT id, created_by FROM tokens;

ALTER TABLE tokens
  ALTER COLUMN created_by TYPE uuid USING created_by::uuid,
  ALTER COLUMN created_by SET NOT NULL;

-- =============================================================================
-- PART 3 -- entirely missing tables (schema.ts defines them, prod has never had
-- them at all). These back live, reachable feature code (spell slots, class
-- features/subclasses, XP/leveling, rest mechanics) in server-bun/src/services/*
-- -- every write path against these tables has been failing since each feature
-- shipped. DDL below is hand-derived directly from db/schema/{class-features,
-- progression,rest,spell-slots,reference}.ts to exactly match column names,
-- types, defaults, FKs, indexes, and check constraints. Ordered for FK
-- dependencies (class_features_library before character_features/
-- feature_usage_log; characters/game_sessions/spells/classes already exist).
-- =============================================================================

-- --- class-features.ts -------------------------------------------------------

CREATE TABLE IF NOT EXISTS class_features_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_name text NOT NULL,
  subclass_name text,
  feature_name text NOT NULL,
  level_acquired integer NOT NULL,
  description text NOT NULL,
  mechanical_effects text,
  usage_type text,
  uses_per_rest text,
  uses_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_class_features_class ON class_features_library (class_name, level_acquired);
CREATE INDEX IF NOT EXISTS idx_class_features_subclass ON class_features_library (subclass_name);

CREATE TABLE IF NOT EXISTS character_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES class_features_library(id) ON DELETE CASCADE,
  uses_remaining integer,
  is_active boolean NOT NULL DEFAULT true,
  acquired_at_level integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_character_features_character ON character_features (character_id);
CREATE INDEX IF NOT EXISTS idx_character_features_feature ON character_features (feature_id);

CREATE TABLE IF NOT EXISTS character_subclasses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  class_name text NOT NULL,
  subclass_name text NOT NULL,
  chosen_at_level integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_character_subclasses_character ON character_subclasses (character_id);

CREATE TABLE IF NOT EXISTS feature_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES class_features_library(id) ON DELETE CASCADE,
  session_id uuid REFERENCES game_sessions(id) ON DELETE SET NULL,
  used_at timestamptz NOT NULL DEFAULT now(),
  context text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feature_usage_character ON feature_usage_log (character_id);
CREATE INDEX IF NOT EXISTS idx_feature_usage_feature ON feature_usage_log (feature_id);
CREATE INDEX IF NOT EXISTS idx_feature_usage_session ON feature_usage_log (session_id);

-- --- progression.ts -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS experience_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  session_id uuid REFERENCES game_sessions(id) ON DELETE SET NULL,
  xp_gained integer NOT NULL,
  source text NOT NULL,
  description text,
  "timestamp" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_xp_events_character ON experience_events (character_id);
CREATE INDEX IF NOT EXISTS idx_xp_events_session ON experience_events (session_id);
CREATE INDEX IF NOT EXISTS idx_xp_events_source ON experience_events (source);
CREATE INDEX IF NOT EXISTS idx_xp_events_timestamp ON experience_events ("timestamp");

CREATE TABLE IF NOT EXISTS level_progression (
  character_id uuid PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  current_level integer NOT NULL DEFAULT 1,
  current_xp integer NOT NULL DEFAULT 0,
  xp_to_next_level integer NOT NULL,
  total_xp integer NOT NULL DEFAULT 0,
  last_level_up timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_level_progression_level ON level_progression (current_level);
CREATE INDEX IF NOT EXISTS idx_level_progression_updated ON level_progression (updated_at);

-- --- rest.ts -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  session_id uuid REFERENCES game_sessions(id) ON DELETE SET NULL,
  rest_type text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  hp_restored integer,
  hit_dice_spent integer,
  resources_restored text,
  interrupted boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rest_events_character ON rest_events (character_id);
CREATE INDEX IF NOT EXISTS idx_rest_events_session ON rest_events (session_id);
CREATE INDEX IF NOT EXISTS idx_rest_events_type ON rest_events (rest_type);
CREATE INDEX IF NOT EXISTS idx_rest_events_completed ON rest_events (completed_at);

CREATE TABLE IF NOT EXISTS character_hit_dice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  class_name text NOT NULL,
  die_type text NOT NULL,
  total_dice integer NOT NULL,
  used_dice integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hit_dice_character ON character_hit_dice (character_id);
CREATE INDEX IF NOT EXISTS idx_hit_dice_class ON character_hit_dice (class_name);

-- --- spell-slots.ts -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS character_spell_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  spell_level integer NOT NULL,
  total_slots integer NOT NULL DEFAULT 0,
  used_slots integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_character_spell_level UNIQUE (character_id, spell_level),
  CONSTRAINT spell_level_check CHECK (spell_level BETWEEN 1 AND 9),
  CONSTRAINT valid_slot_usage CHECK (used_slots <= total_slots)
);
CREATE INDEX IF NOT EXISTS idx_spell_slots_character ON character_spell_slots (character_id);
CREATE INDEX IF NOT EXISTS idx_spell_slots_character_level ON character_spell_slots (character_id, spell_level);

CREATE TABLE IF NOT EXISTS spell_slot_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  session_id uuid REFERENCES game_sessions(id) ON DELETE CASCADE,
  spell_name text NOT NULL,
  spell_level integer NOT NULL,
  slot_level_used integer NOT NULL,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_spell_level CHECK (spell_level BETWEEN 0 AND 9),
  CONSTRAINT valid_slot_level CHECK (slot_level_used BETWEEN 1 AND 9)
);
CREATE INDEX IF NOT EXISTS idx_spell_usage_log_character ON spell_slot_usage_log (character_id);
CREATE INDEX IF NOT EXISTS idx_spell_usage_log_session ON spell_slot_usage_log (session_id);
CREATE INDEX IF NOT EXISTS idx_spell_usage_log_character_session ON spell_slot_usage_log (character_id, session_id);
CREATE INDEX IF NOT EXISTS idx_spell_usage_log_timestamp ON spell_slot_usage_log ("timestamp");

-- --- reference.ts ----------------------------------------------------------------
-- Note: character_id intentionally has no FK here, matching db/schema/reference.ts's
-- explicit comment ("not enforced in Drizzle to avoid circular dependency").

CREATE TABLE IF NOT EXISTS character_spells (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL,
  spell_id uuid NOT NULL REFERENCES spells(id) ON DELETE CASCADE,
  source_class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  is_prepared boolean DEFAULT true,
  is_always_prepared boolean DEFAULT false,
  source_feature text DEFAULT 'base',
  spell_level_learned integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_character_spells_character_id ON character_spells (character_id);
CREATE INDEX IF NOT EXISTS idx_character_spells_spell_id ON character_spells (spell_id);
