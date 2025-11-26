-- Migration: Fix remaining table permissions for WorkOS auth
-- Date: 2025-11-26
-- Purpose: Grant proper permissions to anon/authenticated roles and disable RLS
-- Required for: Application to work with WorkOS authentication (not Supabase Auth)
-- Note: Row-level filtering is handled at the application level via user_id filters

-- ============================================
-- Tables with RLS ON but NO grants
-- ============================================

-- campaign_characters
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_characters TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_characters TO authenticated;
ALTER TABLE campaign_characters DISABLE ROW LEVEL SECURITY;

-- character_creation_metrics
GRANT SELECT, INSERT, UPDATE, DELETE ON character_creation_metrics TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON character_creation_metrics TO authenticated;
ALTER TABLE character_creation_metrics DISABLE ROW LEVEL SECURITY;

-- character_voice_mappings
GRANT SELECT, INSERT, UPDATE, DELETE ON character_voice_mappings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON character_voice_mappings TO authenticated;
ALTER TABLE character_voice_mappings DISABLE ROW LEVEL SECURITY;

-- character_voice_profiles
GRANT SELECT, INSERT, UPDATE, DELETE ON character_voice_profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON character_voice_profiles TO authenticated;
ALTER TABLE character_voice_profiles DISABLE ROW LEVEL SECURITY;

-- safety_audit_trail
GRANT SELECT, INSERT, UPDATE, DELETE ON safety_audit_trail TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON safety_audit_trail TO authenticated;
ALTER TABLE safety_audit_trail DISABLE ROW LEVEL SECURITY;

-- session_config
GRANT SELECT, INSERT, UPDATE, DELETE ON session_config TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON session_config TO authenticated;
ALTER TABLE session_config DISABLE ROW LEVEL SECURITY;

-- worlds
GRANT SELECT, INSERT, UPDATE, DELETE ON worlds TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON worlds TO authenticated;
ALTER TABLE worlds DISABLE ROW LEVEL SECURITY;

-- ============================================
-- Tables with RLS OFF but NO grants
-- ============================================

-- ai_usage
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_usage TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_usage TO authenticated;

-- waitlist (only INSERT for anon, full for authenticated)
GRANT INSERT ON waitlist TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON waitlist TO authenticated;

-- ============================================
-- Ensure other commonly used tables have proper grants
-- ============================================

-- campaigns (ensure grants exist)
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO authenticated;

-- game_sessions (ensure grants exist)
GRANT SELECT, INSERT, UPDATE, DELETE ON game_sessions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON game_sessions TO authenticated;

-- session_messages (ensure grants exist)
GRANT SELECT, INSERT, UPDATE, DELETE ON session_messages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON session_messages TO authenticated;

-- locations (world-builder)
GRANT SELECT, INSERT, UPDATE, DELETE ON locations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON locations TO authenticated;

-- npcs (world-builder)
GRANT SELECT, INSERT, UPDATE, DELETE ON npcs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON npcs TO authenticated;

-- quests (world-builder)
GRANT SELECT, INSERT, UPDATE, DELETE ON quests TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON quests TO authenticated;

-- memories (AI DM memory system)
GRANT SELECT, INSERT, UPDATE, DELETE ON memories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON memories TO authenticated;
