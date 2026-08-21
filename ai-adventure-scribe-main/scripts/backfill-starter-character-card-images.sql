-- Manual backfill for starter-seeded character card art (issue #1876).
--
-- Run this after applying
-- supabase/migrations/20260820_add_starter_character_card_images.sql and
-- uploading the character_card assets. Existing starter-seeded characters do
-- not retain template_key, so match through their starter session and the
-- stable template name/class pair used by the seeding flow.
--
-- This is intentionally not part of application startup or an automated
-- deploy step. It only fills NULL background_image values.

-- DRY RUN PREVIEW — run this first; verify the affected character_ids before
-- running the UPDATE below.
-- WITH starter_card_images AS (
--   SELECT DISTINCT ON (gs.character_id)
--     gs.character_id,
--     template.card_image_url
--   FROM public.game_sessions AS gs
--   JOIN public.characters AS character
--     ON character.id = gs.character_id
--   JOIN public.starter_character_templates AS template
--     ON template.starter_campaign_id = gs.starter_campaign_id
--    AND lower(template.name) = lower(character.name)
--    AND lower(template.class) = lower(coalesce(character.class, ''))
--   WHERE gs.starter_campaign_id IS NOT NULL
--     AND character.background_image IS NULL
--     AND template.card_image_url IS NOT NULL
--   ORDER BY gs.character_id, gs.created_at DESC NULLS LAST
-- )
-- SELECT character_id, card_image_url
-- FROM starter_card_images
-- ORDER BY character_id;

-- Review the preview rows and the UPDATE count before committing.
BEGIN;

WITH starter_card_images AS (
  SELECT DISTINCT ON (gs.character_id)
    gs.character_id,
    template.card_image_url
  FROM public.game_sessions AS gs
  JOIN public.characters AS character
    ON character.id = gs.character_id
  JOIN public.starter_character_templates AS template
    ON template.starter_campaign_id = gs.starter_campaign_id
   AND lower(template.name) = lower(character.name)
   AND lower(template.class) = lower(coalesce(character.class, ''))
  WHERE gs.starter_campaign_id IS NOT NULL
    AND character.background_image IS NULL
    AND template.card_image_url IS NOT NULL
  ORDER BY gs.character_id, gs.created_at DESC NULLS LAST
)
UPDATE public.characters AS character
SET background_image = starter_card_images.card_image_url
FROM starter_card_images
WHERE character.id = starter_card_images.character_id
  AND character.background_image IS NULL;

-- COMMIT;
