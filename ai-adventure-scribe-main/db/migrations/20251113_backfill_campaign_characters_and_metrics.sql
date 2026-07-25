-- Backfill: campaign_characters, character_creation_metrics
-- ============================================================================
-- Neither table is modeled in db/schema/*.ts, so unlike
-- 20251106_backfill_lost_drizzle_migrations.sql this cannot be sourced from a
-- drizzle snapshot -- both were created directly through the Supabase
-- dashboard and never captured as a migration at all. Per
-- db/migrations/.replay-known-gaps's own instructions, the only trustworthy
-- source is production itself:
--
--   pg_dump --schema-only -t campaign_characters -t character_creation_metrics
--
-- run against production on 2026-07-25. Every statement is idempotent
-- (IF NOT EXISTS / DROP ... IF EXISTS then CREATE), so this file is a strict
-- NO-OP against production, exactly like its sibling.
--
-- Dated 20251113: after the drizzle introspection baseline (2025-11-05) and
-- 20251106_backfill_lost_drizzle_migrations.sql (needs campaigns, characters
-- -- both baseline tables), and before this backfill's earliest dependent
-- migration, supabase/migrations/20251126_fix_remaining_table_permissions.sql
-- (grants + RLS toggle on campaign_characters).
--
-- Must ALSO precede supabase/migrations/20251114_add_character_flow_metrics.sql,
-- which independently creates character_creation_metrics -- but with a
-- completely different, obsolete schema (flow/timestamp/campaign_id columns).
-- That table was clearly redesigned through the dashboard at some point
-- (dropped/recreated or heavily ALTERed) into the character_id/
-- creation_method shape pg_dump captured above, and nothing ever migrated the
-- transformation. Production is ground truth, so this backfill's real,
-- current schema must win: it runs first, and 20251114's own
-- CREATE TABLE IF NOT EXISTS then no-ops harmlessly, but its CREATE INDEX/
-- COMMENT statements referencing flow/timestamp fail against the real schema
-- -- so that file is now a newly-discovered pre-existing gap, added to
-- db/migrations/.replay-known-gaps by this same change (it predates this
-- commit; the incompatibility was simply unreachable until
-- character_creation_metrics could replay at all).
--
-- Closes 2 of the file's then-6 remaining entries:
--   supabase/migrations/20251126_fix_remaining_table_permissions.sql
--   db/migrations/20260713_revoke_remaining_anon_access.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS "campaign_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
	"character_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
	"role" text DEFAULT 'player',
	"joined_at" timestamp with time zone DEFAULT now(),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "campaign_characters_campaign_id_character_id_key" UNIQUE("campaign_id", "character_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaign_characters_campaign" ON "campaign_characters" USING btree ("campaign_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaign_characters_character" ON "campaign_characters" USING btree ("character_id");
--> statement-breakpoint
-- Production has RLS disabled here (supabase/migrations/
-- 20251126_fix_remaining_table_permissions.sql does it explicitly); matching
-- that exactly rather than defaulting to enabled-with-a-permissive-policy.
ALTER TABLE "campaign_characters" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can manage campaign characters" ON "campaign_characters";
--> statement-breakpoint
CREATE POLICY "Users can manage campaign characters" ON "campaign_characters" USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "character_creation_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid REFERENCES "characters"("id") ON DELETE CASCADE,
	"user_id" uuid,
	"creation_method" text,
	"time_to_create_seconds" integer,
	"steps_completed" integer,
	"ai_suggestions_used" integer DEFAULT 0,
	"manual_edits" integer DEFAULT 0,
	"template_used" text,
	"completed" boolean DEFAULT false,
	"abandoned_at_step" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_character_creation_metrics_character_id" ON "character_creation_metrics" USING btree ("character_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_character_creation_metrics_created" ON "character_creation_metrics" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_character_creation_metrics_method" ON "character_creation_metrics" USING btree ("creation_method");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_character_creation_metrics_user" ON "character_creation_metrics" USING btree ("user_id");
--> statement-breakpoint
-- Production has a policy here but RLS not enabled on this table (matches
-- pg_dump output exactly -- inert until/unless RLS is turned on later).
DROP POLICY IF EXISTS "Users can manage creation metrics" ON "character_creation_metrics";
--> statement-breakpoint
CREATE POLICY "Users can manage creation metrics" ON "character_creation_metrics" USING (true) WITH CHECK (true);
