-- Backfill: reconstruct DDL that was never committed as a migration
-- ============================================================================
-- Every statement here is idempotent (IF NOT EXISTS / duplicate_object guards),
-- so this file is a strict NO-OP against production. It exists to make the
-- migration history replayable from scratch, which it has not been.
--
-- What was missing and why
-- ------------------------
-- db/migrations/meta/_journal.json references two drizzle migrations,
-- 0002_steady_darwin and 0003_thin_hairball (both 2025-11-06), whose .sql
-- files are absent from the repo entirely -- only their snapshots survive.
-- Further objects were created directly through the Supabase dashboard and
-- never captured as migrations at all. The result: nine tables and fifteen
-- columns existed in production and in db/schema/*.ts, but nothing in
-- supabase/migrations/ or db/migrations/ created them, so fourteen later
-- migrations that reference them could not replay
-- (db/migrations/.replay-known-gaps).
--
-- This file is dated 20251106 because that is when the lost migrations were
-- written -- it restores them to their place in the timeline, ahead of the
-- 20251112+ migrations that ALTER these tables.
--
-- Provenance
-- ----------
-- The DDL was not hand-written. It was derived mechanically:
--   1. replayed the full history into a scratch database
--      (scripts/test-migrations.sh)
--   2. `drizzle-kit introspect` against that database
--   3. trimmed the introspected snapshot to a strict subset of
--      db/migrations/meta/0004_snapshot.json, so the diff could only be
--      additive
--   4. `drizzle-kit generate` to diff it against db/schema/*.ts
--   5. kept ONLY the statements creating the nine absent tables, their
--      indexes and foreign keys, the four enums they need, and the fifteen
--      absent columns. Discarded 461 statements of drizzle constraint- and
--      index-renaming churn, which would have been destructive against
--      production and has nothing to do with the missing objects.
--
-- 0004_snapshot.json is the right source of truth here because 17ebfd47
-- verified, table by table against live production, that db/schema/*.ts and
-- production agreed exactly at that commit.
--
-- Tables:  session_chronicles, ai_usage, character_spells, character_equipment,
--          campaign_chunks, campaign_parties, campaign_rules, party_characters,
--          starter_campaigns
-- Columns: character_stats.armor_class; characters.{subrace,
--          skill_proficiencies, tool_proficiencies,
--          saving_throw_proficiencies, languages, theme, class_levels,
--          total_level}; dialogue_history.images; game_sessions.{session_state,
--          starter_campaign_id, campaign_version, ruleset};
--          memories.emotional_tone
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "public"."chunk_type" AS ENUM('creative_brief', 'world_building', 'faction', 'npc_tier1', 'npc_tier2', 'npc_tier3', 'location', 'quest_main', 'quest_side', 'mechanic', 'item', 'handout', 'monster', 'encounter', 'session_outline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."campaign_difficulty" AS ENUM('easy', 'low-medium', 'medium', 'medium-hard', 'hard', 'deadly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."playstyle" AS ENUM('roleplay-heavy', 'combat-focused', 'balanced', 'exploration', 'puzzle-solving');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."rule_type" AS ENUM('causality', 'mechanic', 'world_law');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_chronicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"chronicle_text" text,
	"chapter_title" text,
	"previously_on" text,
	"illustration_url" text,
	"share_token" text,
	"generated_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_chronicles_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage" (
	"org_id" text,
	"user_id" text,
	"plan" text,
	"type" text,
	"units" integer NOT NULL,
	"period_start" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"provider" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 8) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_spells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"spell_id" uuid NOT NULL,
	"source_class_id" uuid NOT NULL,
	"is_prepared" boolean DEFAULT true,
	"is_always_prepared" boolean DEFAULT false,
	"source_feature" text DEFAULT 'base',
	"spell_level_learned" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"item_type" text DEFAULT 'equipment',
	"quantity" integer DEFAULT 1,
	"equipped" boolean DEFAULT false,
	"is_magic" boolean DEFAULT false,
	"magic_bonus" integer DEFAULT 0,
	-- text[] here, not text: this is the column's shape as of 2025-11-06.
	-- db/migrations/20260710_align_character_equipment.sql converts it with
	-- array_to_string(magic_properties, ', '), which only type-checks against an
	-- array. Creating it at its final text shape would break that replay. The
	-- migration converts it to text later, matching db/schema/inventory.ts.
	"magic_properties" text[],
	"requires_attunement" boolean DEFAULT false,
	"is_attuned" boolean DEFAULT false,
	"attunement_requirements" text,
	"magic_item_type" text,
	"magic_item_rarity" text DEFAULT 'common',
	"magic_effects" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" text NOT NULL,
	"chunk_type" "chunk_type" NOT NULL,
	"entity_name" text,
	"parent_entity" text,
	"content" text NOT NULL,
	"summary" text,
	"embedding" vector(768),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"source_file" text,
	"source_section" text,
	"sequence_order" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" text NOT NULL,
	"party_name" text NOT NULL,
	"party_concept" text NOT NULL,
	"party_hook" text NOT NULL,
	"playstyle" "playstyle" NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" text NOT NULL,
	"rule_type" "rule_type" NOT NULL,
	"condition" text NOT NULL,
	"effect" text NOT NULL,
	"reversible" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "party_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_id" uuid NOT NULL,
	"character_name" text NOT NULL,
	"race" text NOT NULL,
	"class" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"backstory" text NOT NULL,
	"personality" text NOT NULL,
	"campaign_hook" text NOT NULL,
	"party_relationship" text,
	"stats" jsonb NOT NULL,
	"portrait_prompt" text,
	"portrait_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "starter_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"tagline" text,
	"genre" text[] NOT NULL,
	"sub_genre" text[],
	"tone" text[] NOT NULL,
	"difficulty" "campaign_difficulty" NOT NULL,
	"level_range" text,
	"estimated_sessions" text,
	"premise" text NOT NULL,
	"creative_brief" text,
	"overview" text,
	"is_complete" boolean DEFAULT false NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"release_date" timestamp with time zone,
	"release_event" text,
	"current_version" integer DEFAULT 1 NOT NULL,
	"cover_image_url" text,
	"banner_image_url" text,
	"gallery_images" jsonb,
	"play_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "starter_campaigns_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN IF NOT EXISTS "session_state" jsonb DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN IF NOT EXISTS "starter_campaign_id" text;
--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN IF NOT EXISTS "campaign_version" integer;
--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN IF NOT EXISTS "ruleset" text DEFAULT '5e';
--> statement-breakpoint
ALTER TABLE "dialogue_history" ADD COLUMN IF NOT EXISTS "images" jsonb;
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "subrace" text;
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "skill_proficiencies" text;
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "tool_proficiencies" text;
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "saving_throw_proficiencies" text;
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "languages" text[];
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "theme" text;
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "class_levels" jsonb;
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "total_level" integer;
--> statement-breakpoint
ALTER TABLE "character_stats" ADD COLUMN IF NOT EXISTS "armor_class" integer DEFAULT 10 NOT NULL;
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "emotional_tone" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "session_chronicles" ADD CONSTRAINT "session_chronicles_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "character_spells" ADD CONSTRAINT "character_spells_spell_id_spells_id_fk" FOREIGN KEY ("spell_id") REFERENCES "public"."spells"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "character_spells" ADD CONSTRAINT "character_spells_source_class_id_classes_id_fk" FOREIGN KEY ("source_class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "character_equipment" ADD CONSTRAINT "character_equipment_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "campaign_chunks" ADD CONSTRAINT "campaign_chunks_campaign_id_starter_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."starter_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "campaign_parties" ADD CONSTRAINT "campaign_parties_campaign_id_starter_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."starter_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "campaign_rules" ADD CONSTRAINT "campaign_rules_campaign_id_starter_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."starter_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "party_characters" ADD CONSTRAINT "party_characters_party_id_campaign_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."campaign_parties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sc_session_id" ON "session_chronicles" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sc_share_token" ON "session_chronicles" USING btree ("share_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sc_user_id" ON "session_chronicles" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_usage_user_daily_cost" ON "ai_usage" USING btree ("user_id","period_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_character_spells_character_id" ON "character_spells" USING btree ("character_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_character_spells_spell_id" ON "character_spells" USING btree ("spell_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_character_equipment_character_item" ON "character_equipment" USING btree ("character_id","item_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaign_chunks_campaign_id" ON "campaign_chunks" USING btree ("campaign_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaign_chunks_type" ON "campaign_chunks" USING btree ("campaign_id","chunk_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaign_chunks_entity" ON "campaign_chunks" USING btree ("campaign_id","entity_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaign_parties_campaign_id" ON "campaign_parties" USING btree ("campaign_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaign_parties_default" ON "campaign_parties" USING btree ("campaign_id","is_default");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaign_rules_campaign_id" ON "campaign_rules" USING btree ("campaign_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaign_rules_type" ON "campaign_rules" USING btree ("campaign_id","rule_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_party_characters_party_id" ON "party_characters" USING btree ("party_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_party_characters_name" ON "party_characters" USING btree ("character_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_starter_campaigns_slug" ON "starter_campaigns" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_starter_campaigns_genre" ON "starter_campaigns" USING btree ("genre");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_starter_campaigns_difficulty" ON "starter_campaigns" USING btree ("difficulty");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_starter_campaigns_published" ON "starter_campaigns" USING btree ("is_published","is_complete");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_starter_campaigns_featured" ON "starter_campaigns" USING btree ("is_featured");
