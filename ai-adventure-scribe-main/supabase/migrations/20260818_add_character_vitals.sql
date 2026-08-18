-- Character-scoped vitals (issue #1826, C0.5 PR1).
--
-- Consciousness, death saves and conditions currently live on
-- `combat_participant_status` / `combat_participant_conditions`, both keyed to
-- `combat_participants`. Outside an encounter no participant row exists, so a character
-- who reaches 0 hit points on a failed out-of-combat check simply keeps playing: the
-- state that would stop them is unrepresentable. These columns move that state onto the
-- character itself, where it exists whether or not a fight is running.
--
-- All changes are additive. No backfill is needed: an existing character is conscious,
-- standing, and has taken no death saves, which is exactly what the defaults say.

ALTER TABLE public.character_stats
  ADD COLUMN IF NOT EXISTS is_conscious boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS death_saves_successes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS death_saves_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vital_state text NOT NULL DEFAULT 'standing',
  ADD COLUMN IF NOT EXISTS died_at timestamptz;

-- `vital_state` is the single word that says where in the dying/dead progression a
-- character is. `is_conscious` alone cannot distinguish "unconscious and rolling death
-- saves" from "unconscious but stable" from "dead", and those three states have to be
-- told apart before death-save progression (PR3) can be written against them.
DO $$
BEGIN
  ALTER TABLE public.character_stats
    ADD CONSTRAINT character_stats_vital_state_check
    CHECK (vital_state IN ('standing', 'dying', 'stabilized', 'dead'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Character-scoped conditions. Mirrors `combat_participant_conditions` but keyed to the
-- character, so a condition narrated outside combat has somewhere to land. Duration is
-- wall-clock/expiry based rather than round based: outside an encounter there are no
-- rounds to count.
--
-- Written by nothing yet. The conditions CRUD that fills this table is PR3; this
-- migration only gives it a home so the schema change and the code change are not in the
-- same reviewable unit.
CREATE TABLE IF NOT EXISTS character_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  condition_id uuid NOT NULL REFERENCES conditions_library(id) ON DELETE CASCADE,
  duration_type text,
  duration_value integer,
  applied_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  source_description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_character_conditions_character
  ON character_conditions(character_id);
CREATE INDEX IF NOT EXISTS idx_character_conditions_active
  ON character_conditions(is_active);

ALTER TABLE character_conditions ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.character_conditions FROM anon, authenticated;
