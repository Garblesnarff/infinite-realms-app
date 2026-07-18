ALTER TYPE chunk_type ADD VALUE IF NOT EXISTS 'monster';
ALTER TYPE chunk_type ADD VALUE IF NOT EXISTS 'handout';

CREATE TABLE IF NOT EXISTS campaign_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('handout')),
  handout_mode text CHECK (handout_mode IN ('authored', 'improvised')),
  handout_key text,
  title text NOT NULL,
  body text,
  giver text,
  asset_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (entry_type <> 'handout') OR
    (handout_mode = 'authored' AND handout_key IS NOT NULL AND asset_path IS NOT NULL) OR
    (handout_mode = 'improvised' AND handout_key IS NULL AND body IS NOT NULL AND asset_path IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_campaign_journal_entries_campaign_created
  ON campaign_journal_entries(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_journal_entries_session_created
  ON campaign_journal_entries(session_id, created_at DESC);

ALTER TABLE campaign_journal_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.campaign_journal_entries FROM anon, authenticated;
