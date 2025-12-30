-- Add Stripe subscription columns to users table
-- Migration: 20251230_add_stripe_columns

-- Add stripe_customer_id column (nullable - users without subscriptions won't have this)
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Add stripe_subscription_id column (nullable - only set when actively subscribed)
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- Add subscription_status column (nullable - tracks subscription state)
-- Values: active, past_due, canceled, none
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT;

-- Create index on stripe_customer_id for webhook lookups
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

-- Comment on columns for documentation
COMMENT ON COLUMN users.stripe_customer_id IS 'Stripe customer ID for billing';
COMMENT ON COLUMN users.stripe_subscription_id IS 'Active Stripe subscription ID';
COMMENT ON COLUMN users.subscription_status IS 'Subscription status: active, past_due, canceled, none';
