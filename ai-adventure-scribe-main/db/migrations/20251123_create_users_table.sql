-- Migration: Create users table for WorkOS AuthKit
-- Date: 2025-11-23
-- Description: Creates the users table to store WorkOS user data

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);

-- Add comment
COMMENT ON TABLE users IS 'User accounts managed by WorkOS AuthKit';
COMMENT ON COLUMN users.id IS 'WorkOS user ID';
COMMENT ON COLUMN users.email IS 'User email address';
COMMENT ON COLUMN users.first_name IS 'User first name';
COMMENT ON COLUMN users.last_name IS 'User last name';
COMMENT ON COLUMN users.plan IS 'Subscription plan (free, pro, enterprise)';
