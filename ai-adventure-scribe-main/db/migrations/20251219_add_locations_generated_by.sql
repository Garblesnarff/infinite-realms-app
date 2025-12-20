-- Migration: Add generated_by column to locations table
-- Date: 2025-12-19
-- Description: Adds generated_by column to track how locations were created (dm, ai, player)

ALTER TABLE locations ADD COLUMN IF NOT EXISTS generated_by text DEFAULT 'dm';

-- Add comment for documentation
COMMENT ON COLUMN locations.generated_by IS 'How the location was generated: dm, ai, player';
