CREATE TABLE "combat_intent_idempotency" (
	"encounter_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "combat_intent_idempotency_encounter_id_request_id_pk" PRIMARY KEY("encounter_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "combat_intent_idempotency" ADD CONSTRAINT "combat_intent_idempotency_encounter_id_combat_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."combat_encounters"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- #51: server-only cache table (read/written by the intent route with the
-- privileged server role, never by the browser). Same REVOKE the combat
-- tables carry (20260814_revoke_combat_anon_access.sql).
REVOKE ALL ON "combat_intent_idempotency" FROM anon, authenticated;
