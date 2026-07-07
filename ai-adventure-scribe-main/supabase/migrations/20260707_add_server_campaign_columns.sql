-- Align campaign storage with the fields queried by server-bun.
-- Existing campaigns remain private, non-template rows.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS template boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS template_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_visibility_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_visibility_check
  CHECK (visibility IN ('private', 'public'));

CREATE INDEX IF NOT EXISTS idx_campaigns_public_templates
  ON public.campaigns (visibility, template, published_at DESC, template_version DESC);
