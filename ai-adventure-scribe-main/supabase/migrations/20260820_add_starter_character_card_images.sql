-- Starter character card art (issue #1876).
--
-- The uploader stores character-card assets on the template row so newly
-- seeded characters can copy the URL into characters.background_image.
-- MANUAL APPLY AFTER MERGE: do not run this against production from the
-- development workflow. After this PR is merged and deployed, apply it with
-- the owner's approval and record the manual application in
-- public.schema_migrations per house convention.

ALTER TABLE public.starter_character_templates
  ADD COLUMN IF NOT EXISTS card_image_url text;

COMMENT ON COLUMN public.starter_character_templates.card_image_url IS
  'URL of the generated roster card artwork copied to seeded characters';

-- Run scripts/backfill-starter-character-card-images.sql after the card assets
-- have been uploaded. At migration time card_image_url is normally still NULL.
