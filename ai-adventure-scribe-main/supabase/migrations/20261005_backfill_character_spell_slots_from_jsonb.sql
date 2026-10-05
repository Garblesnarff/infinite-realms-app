-- Backfill character_spell_slots rows from the legacy characters.spell_slots
-- JSONB (#2598). The engine's character_spell_slots table is the single source
-- of truth for spell slots; this seeds rows for characters that still carry
-- their slot state only in the JSONB, preserving what each character had
-- recorded -- including slots already spent -- so the table's first read of a
-- legacy character matches the sheet's last JSONB read instead of resetting
-- the character to full slots.
--
-- NOT APPLIED by the PR that ships this file. The prod apply is a separate,
-- recorded step (see issue #1703). Safe to re-run: rows that already exist
-- are never overwritten (ON CONFLICT DO NOTHING).
--
-- Malformed values are skipped one pair at a time, never aborting the whole
-- backfill: the double-encoded string form is parsed inside an EXCEPTION-
-- guarded helper (a pg_temp function -- pg_input_is_valid needs PostgreSQL 16
-- and prod is 15.8), digit strings are capped at three characters so a corrupt
-- value cannot overflow integer, and the int casts live inside CASE so
-- PostgreSQL cannot evaluate them before the regex guards.

-- Parse one (character, spell level) pair out of the legacy JSONB.
-- Returns zero rows when the value is absent or malformed.
CREATE OR REPLACE FUNCTION pg_temp.spell_slot_backfill_pair(slots jsonb, lvl int)
RETURNS TABLE (max_slots int, current_slots int)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized jsonb;
  pair jsonb;
  max_text text;
  current_text text;
  max_val int;
  current_val int;
BEGIN
  -- Normalize the object form and the double-encoded string form. A string
  -- whose content is not JSON raises inside the block and is skipped instead
  -- of aborting the INSERT.
  IF jsonb_typeof(slots) = 'object' THEN
    normalized := slots;
  ELSIF jsonb_typeof(slots) = 'string' THEN
    BEGIN
      normalized := (slots #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RETURN;
    END;
    IF jsonb_typeof(normalized) <> 'object' THEN
      RETURN;
    END IF;
  ELSE
    RETURN;
  END IF;

  pair := normalized -> lvl::text;
  IF jsonb_typeof(pair) <> 'object' THEN
    RETURN;
  END IF;

  -- The casts live inside CASE so PostgreSQL cannot evaluate them before the
  -- regex guards (AND terms may be reordered). Three digits max: anything
  -- larger is data corruption, not a spellcaster.
  max_text := pair ->> 'max';
  current_text := pair ->> 'current';
  max_val := CASE WHEN max_text ~ '^[0-9]{1,3}$' THEN max_text::int END;
  current_val := CASE WHEN current_text ~ '^[0-9]{1,3}$' THEN current_text::int END;

  IF max_val IS NULL OR current_val IS NULL THEN
    RETURN;
  END IF;
  IF max_val < 1 OR current_val < 0 OR current_val > max_val THEN
    RETURN;
  END IF;

  max_slots := max_val;
  current_slots := current_val;
  RETURN NEXT;
END;
$$;

INSERT INTO public.character_spell_slots (character_id, spell_level, total_slots, used_slots)
SELECT
  c.id,
  lvl,
  pair.max_slots,
  pair.max_slots - pair.current_slots
FROM public.characters c
CROSS JOIN generate_series(1, 9) AS lvl
CROSS JOIN LATERAL pg_temp.spell_slot_backfill_pair(c.spell_slots, lvl) AS pair
ON CONFLICT (character_id, spell_level) DO NOTHING;

DROP FUNCTION IF EXISTS pg_temp.spell_slot_backfill_pair(jsonb, int);
