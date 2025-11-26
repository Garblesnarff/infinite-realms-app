-- Migration: Fix character_equipment table permissions
-- Date: 2025-11-26
-- Purpose: Grant proper permissions to anon/authenticated roles and disable RLS
-- Required for: Character sheet loading to work with WorkOS authentication

-- Grant permissions to Supabase roles
GRANT SELECT, INSERT, UPDATE, DELETE ON character_equipment TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON character_equipment TO authenticated;

-- Disable RLS since we're using WorkOS auth (not Supabase auth)
-- Row-level filtering is handled at the application level
ALTER TABLE character_equipment DISABLE ROW LEVEL SECURITY;

-- Also ensure other character-related tables have proper grants
GRANT SELECT, INSERT, UPDATE, DELETE ON characters TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON characters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON character_stats TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON character_stats TO authenticated;

-- Disable RLS on character tables (app handles auth via WorkOS)
ALTER TABLE characters DISABLE ROW LEVEL SECURITY;
ALTER TABLE character_stats DISABLE ROW LEVEL SECURITY;
