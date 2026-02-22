-- Migration: Add session_id to quests table
-- Date: 2026-02-22
-- Purpose: Fix PGRST204 error - session_id column missing from quests

ALTER TABLE quests
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES game_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quests_session_id ON quests(session_id);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
