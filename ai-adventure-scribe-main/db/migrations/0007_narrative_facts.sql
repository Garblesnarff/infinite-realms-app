-- Narrative fact ledger — the SINGLE source of truth for this table's DDL.
--
-- There was briefly a second, equivalent copy at
-- supabase/migrations/20260728000000_narrative_facts.sql. It is deleted: scripts/
-- test-migrations.sh replays the UNION of both trees, so two equivalent files collide
-- on replay, and any exclusion that silences the collision just lets the excluded copy
-- rot out of sync unnoticed. Plain app tables live in the Drizzle tree, where the
-- schema-drift guard anchors (v2 §6 guardrail 7).
--
-- Target architecture: docs/memory-system-design-v2.md §3.1. Pre-Phase-1 slice: keyed by
-- session_id, subject_name as identity -- NOT the playthrough_id + entity_id target.
-- Re-key is #1670 Phase 1.
--
-- The DDL down to the RLS block is drizzle-kit's own output, left byte-identical to what
-- `generate` emits so it keeps matching meta/0007_snapshot.json. Everything below it is
-- hand-added: drizzle's schema DSL does not express row-level security or comments, so
-- generate alone would produce a table that is structurally right and unprotected.
CREATE TYPE "public"."fact_subject_type" AS ENUM('npc', 'location', 'item', 'quest', 'faction', 'party', 'world', 'thread');--> statement-breakpoint
CREATE TABLE "narrative_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"campaign_id" uuid,
	"subject_type" "fact_subject_type" NOT NULL,
	"subject_name" text NOT NULL,
	"predicate" text NOT NULL,
	"value" jsonb NOT NULL,
	"known_by" jsonb DEFAULT '["dm"]'::jsonb NOT NULL,
	"is_belief" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"turn_index" integer,
	"message_id" uuid,
	"needs_review" boolean DEFAULT false NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalidated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "narrative_facts" ADD CONSTRAINT "narrative_facts_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_facts" ADD CONSTRAINT "narrative_facts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_facts_current" ON "narrative_facts" USING btree ("session_id","subject_type","subject_name","predicate") WHERE invalidated_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_facts_session" ON "narrative_facts" USING btree ("session_id","subject_type");--> statement-breakpoint

-- Row Level Security
-- VERIFY-ON-DEVICE: the `memories` table's policies were not visible when this was
-- written. Confirm the naming/predicate style below matches them (especially whether
-- campaigns.user_id is compared against auth.uid()::text or a uuid) BEFORE applying,
-- and align if it differs. Keep the two trees' copies identical when you do.
ALTER TABLE "narrative_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Owners of the parent session may read their own ledger (Journal UI:
-- memory-system-design-v2.md §3.6).
CREATE POLICY "narrative_facts_select_own"
  ON "narrative_facts"
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM game_sessions gs
      JOIN campaigns c ON c.id = gs.campaign_id
      WHERE gs.id = narrative_facts.session_id
        AND c.user_id = auth.uid()::text
    )
  );--> statement-breakpoint

-- Writes are server-authoritative: the Bun server writes with the service role,
-- which bypasses RLS. No INSERT/UPDATE/DELETE policy is granted to
-- `authenticated` on purpose - player corrections go through
-- POST /v1/narrative-facts, not direct table access.

COMMENT ON TABLE "narrative_facts" IS
  'Bi-temporal narrative fact ledger. Supersede, never overwrite: a new assertion sets the prior row''s invalidated_at/invalidated_by in the same transaction.';--> statement-breakpoint
COMMENT ON COLUMN "narrative_facts"."source" IS 'engine | dm_delta | player_correction. dm_delta may not supersede an engine or player_correction fact.';--> statement-breakpoint
COMMENT ON COLUMN "narrative_facts"."needs_review" IS 'Staged fact: never injected into a prompt until reviewed.';
