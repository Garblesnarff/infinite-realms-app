-- #2218: ai_usage.session_id for DM-turn generations.
-- MANUAL APPLY AFTER MERGE: apply by hand on prod after this PR merges, and record the apply
-- (#1703). It is not applied from the issue worktree.
--
-- Joins a DM turn's model call to its game session, so "did the DM reply?" is one query instead
-- of matching ai_usage rows to sessions by user and timestamp (#2184). TEXT, not a uuid FK: the
-- route receives the id as a client string, and a cast failure would drop the usage row.
--
-- Idempotent on purpose: AIUsageService.ensureTable() also adds the column at first write, so on
-- prod the column may already exist by the time this is applied.
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_usage_session_id ON ai_usage (session_id);
