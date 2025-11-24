-- Migration: Create waitlist table for landing page signups
-- Date: 2025-11-24
-- Description: Creates the waitlist table to store email signups from the landing page

-- Create waitlist table
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  source TEXT NOT NULL DEFAULT 'launch_page',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist(created_at);

-- Add comments
COMMENT ON TABLE waitlist IS 'Email signups from the landing page waitlist';
COMMENT ON COLUMN waitlist.id IS 'Unique identifier for each signup';
COMMENT ON COLUMN waitlist.email IS 'User email address (unique)';
COMMENT ON COLUMN waitlist.name IS 'User name (optional)';
COMMENT ON COLUMN waitlist.source IS 'Source of the signup (e.g., launch_page)';
COMMENT ON COLUMN waitlist.status IS 'Status of the signup (pending, contacted, converted)';
