-- Migration: Add missing sequence number trigger for dialogue_history
-- Date: 2025-11-27
-- Purpose: The trigger was missing from the local Supabase setup, causing
--          all messages to have NULL sequence_number and broken ordering.
--
-- Root cause: Migration 20251126_fix_schema_mismatches.sql added the column
-- but did NOT create the trigger function or trigger that auto-assigns
-- sequence numbers on INSERT.

-- Create the trigger function (if not exists)
CREATE OR REPLACE FUNCTION assign_message_sequence_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_seq integer;
  lock_key bigint;
  clean_uuid text;
BEGIN
  -- Only assign if sequence_number is not already set
  IF NEW.sequence_number IS NULL THEN
    -- Create a unique lock key from the session_id UUID
    -- Remove dashes from UUID before converting to hex (dashes are not valid hex digits)
    clean_uuid := replace(NEW.session_id::text, '-', '');
    lock_key := ('x' || substring(clean_uuid, 1, 16))::bit(64)::bigint;

    -- Acquire advisory lock for this session
    PERFORM pg_advisory_xact_lock(lock_key);

    -- Get the next sequence number for this session
    SELECT COALESCE(MAX(sequence_number), 0) + 1
    INTO next_seq
    FROM dialogue_history
    WHERE session_id = NEW.session_id;

    -- Assign the sequence number
    NEW.sequence_number := next_seq;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger (drop first in case it exists but was incomplete)
DROP TRIGGER IF EXISTS trg_assign_message_sequence ON dialogue_history;

CREATE TRIGGER trg_assign_message_sequence
  BEFORE INSERT ON dialogue_history
  FOR EACH ROW
  EXECUTE FUNCTION assign_message_sequence_number();

-- Backfill existing NULL sequence numbers based on timestamp order
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY timestamp ASC, created_at ASC, id ASC) as rn
  FROM dialogue_history
  WHERE sequence_number IS NULL
)
UPDATE dialogue_history
SET sequence_number = numbered.rn
FROM numbered
WHERE dialogue_history.id = numbered.id;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
