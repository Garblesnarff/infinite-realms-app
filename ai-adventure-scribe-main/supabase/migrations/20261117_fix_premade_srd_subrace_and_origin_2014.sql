-- Issue #52: premade templates get their 2014 SRD level-1 pick.
--
-- Rob's decision (fix the three seeds to the 2014 SRD option). Data-only UPDATEs
-- with no DDL, so the one-owner DDL rule of AGENTS.md section 7 is kept (DDL for
-- starter_character_templates stays in db/migrations). Templates only: characters
-- already created from these templates are copies and are not touched. Re-runnable:
-- each UPDATE requires subrace/subclass IS NULL, so a second run changes nothing.
-- A no-op where a row is missing (fresh replay). Updates existing production rows,
-- so it is applied only on Rob's typed line.
--
-- Draconic ancestry is not stored (no column): Gold for The Sous Chef, Brass for
-- The Lovesick, recorded in the PR, not in the DB.

-- The Gourmand (Dwarf Fighter, subrace NULL) becomes a Hill Dwarf.
-- 2014 SRD Hill Dwarf: Wisdom +1 (ability_scores stores FINAL scores with racial
-- bonuses already applied), Dwarven Toughness (+1 HP per level; HP is computed by
-- the server from subrace, not stored on templates).
UPDATE public.starter_character_templates
SET subrace = 'Hill Dwarf',
    ability_scores = ability_scores || jsonb_build_object('WIS', (ability_scores->>'WIS')::int + 1)
WHERE starter_campaign_id = 'academy-of-arcane-gastronomy'
  AND template_key = 'the-gourmand'
  AND race = 'Dwarf'
  AND class = 'Fighter'
  AND subrace IS NULL
  AND ability_scores ? 'WIS';

UPDATE public.starter_character_templates
SET subrace = 'Hill Dwarf',
    ability_scores = ability_scores || jsonb_build_object('wisdom', (ability_scores->>'wisdom')::int + 1)
WHERE starter_campaign_id = 'academy-of-arcane-gastronomy'
  AND template_key = 'the-gourmand'
  AND race = 'Dwarf'
  AND class = 'Fighter'
  AND subrace IS NULL
  AND ability_scores ? 'wisdom';

-- The Sous Chef (Tiefling Sorcerer, subclass NULL) gets subclass 'Draconic Bloodline'.
UPDATE public.starter_character_templates
SET subclass = 'Draconic Bloodline'
WHERE starter_campaign_id = 'academy-of-arcane-gastronomy'
  AND template_key = 'the-sous-chef'
  AND class = 'Sorcerer'
  AND subclass IS NULL;

-- The Lovesick (Half-Elf Sorcerer, subclass NULL) gets subclass 'Draconic Bloodline'.
UPDATE public.starter_character_templates
SET subclass = 'Draconic Bloodline'
WHERE starter_campaign_id = 'a-midsummer-nights-chaos'
  AND template_key = 'the-lovesick'
  AND class = 'Sorcerer'
  AND subclass IS NULL;

-- Fail loudly if a gourmand row exists with race 'Dwarf' and subrace still NULL
-- (its ability_scores had neither key shape), so a silent no-op cannot pass on prod.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.starter_character_templates
    WHERE starter_campaign_id = 'academy-of-arcane-gastronomy'
      AND template_key = 'the-gourmand'
      AND race = 'Dwarf'
      AND subrace IS NULL
  ) THEN
    RAISE EXCEPTION 'the-gourmand (Dwarf) still has NULL subrace after #52 fix (ability_scores had neither WIS nor wisdom key)';
  END IF;
END $$;
