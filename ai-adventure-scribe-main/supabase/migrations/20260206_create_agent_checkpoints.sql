-- Migration: Create agent_checkpoints table for LangGraph persistence
-- Date: 2026-02-06
-- Purpose: Persist LangGraph checkpoints (Supabase checkpointer)

CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id text NOT NULL,
  checkpoint_id text NOT NULL,
  parent_checkpoint_id text,
  state jsonb NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_checkpoints_thread_checkpoint_idx
  ON agent_checkpoints(thread_id, checkpoint_id);

CREATE INDEX IF NOT EXISTS agent_checkpoints_thread_created_idx
  ON agent_checkpoints(thread_id, created_at DESC);

-- WorkOS auth: disable RLS and grant access to anon/authenticated roles
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_checkpoints TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_checkpoints TO authenticated;
ALTER TABLE agent_checkpoints DISABLE ROW LEVEL SECURITY;
