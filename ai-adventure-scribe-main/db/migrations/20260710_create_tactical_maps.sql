CREATE TABLE IF NOT EXISTS tactical_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tactical_maps_session_id ON tactical_maps(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS tactical_maps_one_active_session
  ON tactical_maps(session_id) WHERE active = true;
