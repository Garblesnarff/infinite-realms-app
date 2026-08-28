-- session_companions for the WebMCP companion party surface (#1926).
-- MANUAL APPLY AFTER MERGE: this migration is intentionally not applied from
-- the issue worktree or by the Drizzle migration runner.

CREATE TABLE session_companions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  controller text NOT NULL DEFAULT 'webmcp',      -- 'webmcp' | 'ai' | 'user'
  status text NOT NULL DEFAULT 'active',           -- 'active' | 'left'
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, character_id)
);
