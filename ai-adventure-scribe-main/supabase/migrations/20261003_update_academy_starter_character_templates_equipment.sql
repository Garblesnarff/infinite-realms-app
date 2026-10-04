-- Seed the missing SRD starting kits for the five Academy of Arcane Gastronomy premades.
-- The canonical weapon ids preserve the campaign flavour: dagger = chef's knife and handaxe = cleaver.
-- The empty-array guard makes this safe to replay without overwriting a later manual edit.

DO $$
BEGIN
  IF (
    SELECT count(DISTINCT template_key)
    FROM public.starter_character_templates
    WHERE starter_campaign_id = 'academy-of-arcane-gastronomy'
      AND template_key IN (
        'the-apprentice',
        'the-kitchen-hand',
        'the-gourmand',
        'the-herbalist',
        'the-sous-chef'
      )
  ) NOT IN (0, 5) THEN
    RAISE EXCEPTION 'Expected either all five or none of the Academy premade templates to exist';
  END IF;
END $$;

UPDATE public.starter_character_templates
SET equipment = '["quarterstaff", "dagger", "component pouch", "scholar''s pack", "spellbook", "bottle of black ink", "quill"]'
WHERE starter_campaign_id = 'academy-of-arcane-gastronomy'
  AND template_key = 'the-apprentice'
  AND equipment = '[]'::jsonb;

UPDATE public.starter_character_templates
SET equipment = '["leather armor", "dagger", "dagger", "dagger", "shortbow", "quiver with 20 arrows", "shortsword", "thieves'' tools", "dungeoneer''s pack", "map of your home city", "pet mouse", "common clothes"]'
WHERE starter_campaign_id = 'academy-of-arcane-gastronomy'
  AND template_key = 'the-kitchen-hand'
  AND equipment = '[]'::jsonb;

UPDATE public.starter_character_templates
SET equipment = '["handaxe", "chain mail", "longsword", "shield", "light crossbow", "crossbow bolts (20)", "dungeoneer''s pack", "artisan''s tools", "shovel", "artisan''s clothes", "belt pouch"]'
WHERE starter_campaign_id = 'academy-of-arcane-gastronomy'
  AND template_key = 'the-gourmand'
  AND equipment = '[]'::jsonb;

UPDATE public.starter_character_templates
SET equipment = '["leather armor", "shield", "scimitar", "druidic focus", "explorer''s pack", "herbalism kit", "dagger", "scroll case with spiritual writings", "winter blanket", "traveler''s clothes"]'
WHERE starter_campaign_id = 'academy-of-arcane-gastronomy'
  AND template_key = 'the-herbalist'
  AND equipment = '[]'::jsonb;

UPDATE public.starter_character_templates
SET equipment = '["dagger", "dagger", "dagger", "light crossbow", "crossbow bolts (20)", "arcane focus", "explorer''s pack", "musical instrument", "costume", "disguise kit", "traveler''s clothes"]'
WHERE starter_campaign_id = 'academy-of-arcane-gastronomy'
  AND template_key = 'the-sous-chef'
  AND equipment = '[]'::jsonb;
