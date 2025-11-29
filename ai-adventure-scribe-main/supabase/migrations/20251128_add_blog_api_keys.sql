-- Migration: Add blog_api_keys table for internal API authentication
-- Used by GitHub Actions and other automated processes to create release posts

CREATE TABLE IF NOT EXISTS blog_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  disabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

-- Index for fast key lookups
CREATE INDEX IF NOT EXISTS idx_blog_api_keys_key_hash ON blog_api_keys(key_hash);

-- Index for listing active keys
CREATE INDEX IF NOT EXISTS idx_blog_api_keys_active ON blog_api_keys(disabled, expires_at);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_blog_api_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_blog_api_keys_updated_at ON blog_api_keys;
CREATE TRIGGER trigger_blog_api_keys_updated_at
  BEFORE UPDATE ON blog_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_blog_api_keys_updated_at();

-- RLS: Only service role can access this table (no public access)
ALTER TABLE blog_api_keys ENABLE ROW LEVEL SECURITY;

-- No policies = only service role can access
-- This is intentional - API keys should only be managed server-side

COMMENT ON TABLE blog_api_keys IS 'API keys for internal/automated endpoints (GitHub Actions, etc.)';
COMMENT ON COLUMN blog_api_keys.key_hash IS 'SHA-256 hash of the API key - never store raw keys';
COMMENT ON COLUMN blog_api_keys.permissions IS 'Array of permission strings (e.g., create_release_post)';
