-- Campaign-level starter provenance for user-owned campaigns (#1938).
--
-- Explore-created campaigns carry the starter_campaigns id here so starter
-- character templates remain discoverable even before a session exists. The
-- column is intentionally nullable: custom campaigns are not starter playthroughs.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS starter_campaign_id text;

CREATE INDEX IF NOT EXISTS idx_campaigns_starter_campaign
  ON public.campaigns (starter_campaign_id);
