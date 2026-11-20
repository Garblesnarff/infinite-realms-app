-- Issue #52: 2014 SRD Draconic Bloodline grants the Draconic language.
--
-- Follows Rob's #52 decision (the 2014 SRD option for these seeds); strategist queue
-- on #357, 11-17 15:24Z. Data-only
-- UPDATEs with no DDL, so the one-owner DDL rule of AGENTS.md section 7 is kept
-- (DDL for starter_character_templates stays in db/migrations). Templates only:
-- characters already created from these templates are copies and are not touched.
-- Re-runnable: each UPDATE requires subclass = 'Draconic Bloodline' and skips
-- rows that already list Draconic (case-insensitive), so a second run changes
-- nothing. A no-op where a row is missing (fresh replay). Updates existing
-- production rows, so it is applied only on Rob's typed line.
--
-- Must run after 20261117_fix_premade_srd_subrace_and_origin_2014.sql: its guard
-- requires the subclass that file sets.

-- Guard: any target row already marked Draconic Bloodline must carry a JSON array
-- of strings for languages. Fail loudly rather than silently corrupting prod.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.starter_character_templates
    WHERE starter_campaign_id = 'academy-of-arcane-gastronomy'
      AND template_key = 'the-sous-chef'
      AND class = 'Sorcerer'
      AND subclass = 'Draconic Bloodline'
      -- CASE, not OR: Postgres does not promise OR order, and the element scan fails on a non-array.
      AND CASE
            WHEN jsonb_typeof(languages) = 'array'
              THEN EXISTS (SELECT 1 FROM jsonb_array_elements(languages) e WHERE jsonb_typeof(e) <> 'string')
            ELSE true
          END
  ) THEN
    RAISE EXCEPTION '#52: the-sous-chef languages is not a JSON array of strings';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.starter_character_templates
    WHERE starter_campaign_id = 'a-midsummer-nights-chaos'
      AND template_key = 'the-lovesick'
      AND class = 'Sorcerer'
      AND subclass = 'Draconic Bloodline'
      -- CASE, not OR: Postgres does not promise OR order, and the element scan fails on a non-array.
      AND CASE
            WHEN jsonb_typeof(languages) = 'array'
              THEN EXISTS (SELECT 1 FROM jsonb_array_elements(languages) e WHERE jsonb_typeof(e) <> 'string')
            ELSE true
          END
  ) THEN
    RAISE EXCEPTION '#52: the-lovesick languages is not a JSON array of strings';
  END IF;
END $$;

-- The Sous Chef (Tiefling Sorcerer, Draconic Bloodline) gains Draconic.
UPDATE public.starter_character_templates
SET languages = languages || '["Draconic"]'::jsonb
WHERE starter_campaign_id = 'academy-of-arcane-gastronomy'
  AND template_key = 'the-sous-chef'
  AND class = 'Sorcerer'
  AND subclass = 'Draconic Bloodline'
  AND CASE
        WHEN jsonb_typeof(languages) = 'array'
          THEN NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(languages) AS l(name)
            WHERE lower(l.name) = 'draconic'
          )
        ELSE false
      END;

-- The Lovesick (Half-Elf Sorcerer, Draconic Bloodline) gains Draconic.
UPDATE public.starter_character_templates
SET languages = languages || '["Draconic"]'::jsonb
WHERE starter_campaign_id = 'a-midsummer-nights-chaos'
  AND template_key = 'the-lovesick'
  AND class = 'Sorcerer'
  AND subclass = 'Draconic Bloodline'
  AND CASE
        WHEN jsonb_typeof(languages) = 'array'
          THEN NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(languages) AS l(name)
            WHERE lower(l.name) = 'draconic'
          )
        ELSE false
      END;
