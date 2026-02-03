-- Add A/B pricing test variant column to users table
-- Migration: 20260203_add_ab_variant

-- Add ab_variant column (nullable - assigned on first checkout attempt)
ALTER TABLE users ADD COLUMN IF NOT EXISTS ab_variant TEXT CHECK (ab_variant IN ('A', 'B'));

-- Create index for analytics queries
CREATE INDEX IF NOT EXISTS idx_users_ab_variant ON users(ab_variant);

-- Comment for documentation
COMMENT ON COLUMN users.ab_variant IS 'A/B pricing test variant: A or B';

-- Update existing pro users to A (control group baseline)
-- UPDATE users SET ab_variant = 'A' WHERE plan = 'pro';
-- Note: Uncomment after confirming no data loss