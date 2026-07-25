-- Backfill: starter_character_templates
-- ============================================================================
-- Not modeled in db/schema/*.ts, created directly through the Supabase
-- dashboard, never captured as a migration. Sourced the only trustworthy way
-- per db/migrations/.replay-known-gaps's own instructions:
--
--   pg_dump --schema-only -t starter_character_templates
--
-- run against production on 2026-07-25. Idempotent (IF NOT EXISTS / DROP ...
-- IF EXISTS then CREATE), so this file is a strict NO-OP against production.
--
-- Split from the sibling campaign_characters/character_creation_metrics
-- backfill and dated separately because this table FKs to starter_campaigns,
-- created by supabase/migrations/20251205_create_lore_keeper_tables.sql --
-- later than campaign_characters' earliest dependent migration (2025-11-26).
-- Dated 20251210: after starter_campaigns exists, before this backfill's
-- earliest dependent migration, supabase/migrations/
-- 20260103_seed_starter_character_templates.sql.
--
-- Closes the file's remaining 4 entries:
--   db/migrations/20251214_add_missing_fk_indexes.sql
--   supabase/migrations/20260103_seed_starter_character_templates.sql
--   supabase/migrations/20260117_update_eternal_feast_characters.sql
--   db/migrations/20260710_create_inventory_tables.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION update_starter_character_templates_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "starter_character_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"starter_campaign_id" text NOT NULL REFERENCES "starter_campaigns"("id") ON DELETE CASCADE,
	"template_key" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"race" text NOT NULL,
	"subrace" text,
	"class" text NOT NULL,
	"background" text,
	"level" integer DEFAULT 1,
	"ability_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"personality" jsonb DEFAULT '{}'::jsonb,
	"skills" jsonb DEFAULT '[]'::jsonb,
	"languages" jsonb DEFAULT '[]'::jsonb,
	"equipment" jsonb DEFAULT '[]'::jsonb,
	"adapted_backstory" text,
	"campaign_hook" text,
	"portrait_url" text,
	"portrait_prompt" text,
	"display_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "unique_template_per_campaign" UNIQUE("starter_campaign_id", "template_key")
);
--> statement-breakpoint
COMMENT ON TABLE "starter_character_templates" IS 'Pre-built character templates for starter campaigns';
--> statement-breakpoint
COMMENT ON COLUMN "starter_character_templates"."template_key" IS 'Identifier for the base template (e.g., the-veteran)';
--> statement-breakpoint
COMMENT ON COLUMN "starter_character_templates"."adapted_backstory" IS 'Campaign-specific backstory adaptation';
--> statement-breakpoint
COMMENT ON COLUMN "starter_character_templates"."campaign_hook" IS 'Why this character is involved in this campaign';
--> statement-breakpoint
COMMENT ON COLUMN "starter_character_templates"."portrait_prompt" IS 'AI prompt for generating character portrait';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_starter_character_templates_campaign" ON "starter_character_templates" USING btree ("starter_campaign_id");
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trigger_update_starter_character_templates_updated_at" ON "starter_character_templates";
--> statement-breakpoint
CREATE TRIGGER "trigger_update_starter_character_templates_updated_at"
  BEFORE UPDATE ON "starter_character_templates"
  FOR EACH ROW EXECUTE FUNCTION update_starter_character_templates_updated_at();
--> statement-breakpoint
ALTER TABLE "starter_character_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "Anyone can read starter character templates" ON "starter_character_templates";
--> statement-breakpoint
CREATE POLICY "Anyone can read starter character templates" ON "starter_character_templates" FOR SELECT USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS "Service role can modify starter character templates" ON "starter_character_templates";
--> statement-breakpoint
CREATE POLICY "Service role can modify starter character templates" ON "starter_character_templates" TO service_role USING (true) WITH CHECK (true);
