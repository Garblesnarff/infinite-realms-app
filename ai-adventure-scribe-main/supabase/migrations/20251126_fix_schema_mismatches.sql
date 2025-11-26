-- Migration: Fix schema mismatches between code and database
-- Date: 2025-11-26
-- Purpose: Add missing columns that the application code expects

-- ============================================
-- Fix dialogue_history table
-- ============================================

-- Add sequence_number column for ordering messages
ALTER TABLE dialogue_history ADD COLUMN IF NOT EXISTS sequence_number INTEGER;

-- Create index for sequence_number ordering
CREATE INDEX IF NOT EXISTS idx_dialogue_history_sequence_number
ON dialogue_history(session_id, sequence_number DESC);

-- Update existing rows to have sequential numbers based on timestamp
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY timestamp ASC) as rn
  FROM dialogue_history
)
UPDATE dialogue_history
SET sequence_number = numbered.rn
FROM numbered
WHERE dialogue_history.id = numbered.id AND dialogue_history.sequence_number IS NULL;

-- ============================================
-- Fix memories table
-- ============================================

-- Add 'type' column (code expects 'type', DB has 'memory_type')
-- We'll add both and keep them in sync, or rename
ALTER TABLE memories ADD COLUMN IF NOT EXISTS type TEXT;

-- Add 'subcategory' column
ALTER TABLE memories ADD COLUMN IF NOT EXISTS subcategory TEXT;

-- Add 'metadata' column (code expects 'metadata', DB has 'context')
ALTER TABLE memories ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Copy data from memory_type to type if type is null
UPDATE memories SET type = memory_type WHERE type IS NULL AND memory_type IS NOT NULL;

-- Copy data from context to metadata if metadata is null
UPDATE memories SET metadata = context WHERE metadata IS NULL AND context IS NOT NULL;

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_subcategory ON memories(subcategory);

-- ============================================
-- Refresh PostgREST schema cache
-- ============================================
NOTIFY pgrst, 'reload schema';
